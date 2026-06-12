import type { HttpContext, MiddlewareFunction } from '@tekir/core'
import { TooManyRequestsException } from '@tekir/core'
import { MemoryStore } from './store'
import type { LimiterOptions, LimiterStore, LimiterResult } from './types'

export type { LimiterOptions }

const defaultStore = new MemoryStore()

/**
 * Resolve the client IP. The `X-Forwarded-For` header is attacker-controlled
 * and must not be trusted unless the app sits behind a configured trusted
 * proxy. Without `trustProxy`, only the socket IP (`ctx.request.ip`) is used,
 * so an attacker cannot mint unlimited rate-limit buckets by rotating the
 * header.
 */
function resolveIp(ctx: HttpContext, trustProxy: boolean | number | undefined): string {
  const socketIp = ctx.request.ip || ''

  if (trustProxy) {
    const xff = ctx.request.header('x-forwarded-for')
    if (xff) {
      const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
      if (parts.length > 0) {
        // `true` -> single trusted proxy: take the left-most (original client).
        // `number` -> count of trusted proxies: pick the entry that many hops
        // from the right (the last untrusted address the proxies received).
        let ip: string | undefined
        if (trustProxy === true) {
          ip = parts[0]
        } else {
          const idx = parts.length - trustProxy
          ip = idx >= 0 ? parts[idx] : parts[0]
        }
        if (ip) return ip
      }
    }
  }

  return socketIp || 'unknown'
}

function getIdentifier(ctx: HttpContext, by: LimiterOptions['by'], trustProxy: boolean | number | undefined): string {
  if (typeof by === 'function') return by(ctx)
  if (by === 'user') {
    const auth = ctx.auth as { user?: { id?: string | number } } | undefined
    return auth?.user?.id?.toString() || resolveIp(ctx, trustProxy)
  }
  // Default: ip
  return resolveIp(ctx, trustProxy)
}

/**
 * Create a rate limiter middleware that enforces request limits per client.
 * Attaches `X-RateLimit-*` and `Retry-After` headers to every response and
 * throws {@link TooManyRequestsException} when the limit is exceeded.
 *
 * @param options - Rate limiter configuration including max requests, window size, and optional block duration.
 * @returns An HTTP middleware function.
 *
 * @example
 * ```ts
 * router.get('/api/data', limiter({ max: 100, window: 60 }), handler)
 * ```
 */
export function limiter(options: LimiterOptions): MiddlewareFunction {
  const store = (options.store || defaultStore) as MemoryStore
  const keyPrefix = options.keyPrefix || 'rl'

  return async (ctx: HttpContext, next: () => Promise<void>) => {
    const identifier = getIdentifier(ctx, options.by || 'ip', options.trustProxy)
    // Encode the identifier so a value containing the `:` separator (e.g. an
    // IPv6 address or a custom `by` return) cannot collide with another
    // route/prefix bucket.
    const key = `${keyPrefix}:${ctx.route.pattern}:${encodeURIComponent(identifier)}`

    const blockMs = options.blockFor ? options.blockFor * 1000 : 0
    // Atomic conditional-consume: the check, increment and lockout-on-exceed
    // run as a single store operation, so concurrent requests cannot slip past
    // the limit between the check and the block.
    const result = store.consume
      ? await store.consume(key, options.max, options.window * 1000, 1, blockMs)
      : await store.check(key, options.max, options.window * 1000)

    ctx.response.header('X-RateLimit-Limit', String(result.limit))
    ctx.response.header('X-RateLimit-Remaining', String(result.remaining))
    ctx.response.header('X-RateLimit-Reset', String(result.resetTime))

    if (!result.allowed) {
      // Retry-After only makes sense once the limit is actually exceeded.
      ctx.response.header('Retry-After', String(result.resetTime))

      // blockFor: extended lockout (only needed when consume didn't apply it).
      if (blockMs && !store.consume && store.block) {
        await store.block(key, blockMs)
      }

      // limitExceeded hook
      if (options.limitExceeded) {
        const err = {
          status: 429,
          message: 'Too Many Requests',
          retryAfter: result.resetTime,
          setStatus(s: number) { this.status = s },
          setMessage(m: string) { this.message = m },
        }
        options.limitExceeded(err)
        const exc = new TooManyRequestsException(err.message, result.resetTime)
        // Honor a status override from the hook instead of silently ignoring it.
        if (err.status !== 429) exc.statusCode = err.status
        throw exc
      }

      throw new TooManyRequestsException('Too Many Requests', result.resetTime)
    }

    await next()
  }
}


/**
 * Programmatic rate limiter for use outside of HTTP middleware contexts.
 * Supports attempt gating, penalty-on-failure, slot consumption, and manual blocking.
 *
 * @example
 * ```ts
 * const limiter = new Limiter({ max: 5, window: 60, blockFor: 300 })
 * const result = await limiter.attempt('user:123', () => doWork())
 * if (result === undefined) console.log('Rate limited!')
 * ```
 */
export class Limiter {
  private store: MemoryStore
  private max: number
  private windowMs: number
  private blockDurationMs: number

  /**
   * Create a new Limiter instance.
   *
   * @param options - Configuration for the limiter.
   * @param options.max - Maximum number of allowed attempts within the window.
   * @param options.window - Time window in seconds.
   * @param options.blockFor - Optional extended lockout duration in seconds when the limit is exceeded.
   * @param options.store - Optional backing store. Defaults to an in-memory store.
   */
  constructor(options: { max: number; window: number; blockFor?: number; store?: LimiterStore }) {
    this.store = (options.store || defaultStore) as MemoryStore
    this.max = options.max
    this.windowMs = options.window * 1000
    this.blockDurationMs = (options.blockFor || 0) * 1000
  }

  /**
   * Execute a function if the rate limit allows. Returns the function result,
   * or `undefined` if the key is rate-limited.
   *
   * @param key - A unique identifier for the rate-limited resource (e.g. `'login:user@example.com'`).
   * @param fn - The function to execute when the limit is not exceeded.
   * @returns The return value of `fn`, or `undefined` if blocked.
   *
   * @example
   * ```ts
   * const result = await limiter.attempt('api:user:1', () => fetchData())
   * ```
   */
  async attempt<T>(key: string, fn: () => T | Promise<T>): Promise<T | undefined> {
    // Atomic consume folds the check and the block into one store operation.
    const result = this.store.consume
      ? await this.store.consume(key, this.max, this.windowMs, 1, this.blockDurationMs)
      : await this.consumeFallback(key)
    if (!result.allowed) return undefined
    return await fn()
  }

  /**
   * Execute a function and consume a rate-limit slot only if it throws.
   * Ideal for login protection where successful attempts should not count.
   *
   * @param key - A unique identifier for the rate-limited resource.
   * @param fn - The function to execute.
   * @returns A tuple: `[null, result]` on success, or `[{ retryAfter }, null]` on failure or when blocked.
   *
   * @example
   * ```ts
   * const [err, user] = await limiter.penalize('login:user@example.com', () => auth.verify(credentials))
   * if (err) return res.status(429).json({ retryAfter: err.retryAfter })
   * ```
   */
  async penalize<T>(key: string, fn: () => T | Promise<T>): Promise<[null, T] | [{ retryAfter: number }, null]> {
    // Pre-check via the store's atomic, non-consuming view. `peek` reports a
    // live block or exhausted window in a single store operation, so an expired
    // window can't be mistaken for "no entry" the way a stale read could.
    const pre = await (this.store.peek ? this.store.peek(key) : this.store.get(key))
    if (pre && !pre.allowed) {
      return [{ retryAfter: pre.resetTime }, null]
    }

    try {
      const result = await fn()
      return [null, result]
    } catch {
      // Only consume on failure. The atomic conditional-consume folds the
      // increment and the lockout into one store operation, so a successful
      // request and a penalty (or two concurrent penalties) cannot race past
      // the limit between a separate check and block.
      const check = this.store.consume
        ? await this.store.consume(key, this.max, this.windowMs, 1, this.blockDurationMs)
        : await this.consumeFallback(key)
      return [{ retryAfter: check.resetTime }, null]
    }
  }

  /** Legacy non-atomic consume path for stores without `consume`. */
  private async consumeFallback(key: string): Promise<LimiterResult> {
    const check = await this.store.check(key, this.max, this.windowMs)
    if (!check.allowed && this.blockDurationMs) {
      await this.store.block(key, this.blockDurationMs)
    }
    return check
  }

  /**
   * Atomically consume one or more rate-limit slots. Throws
   * {@link TooManyRequestsException} if the limit is exceeded.
   *
   * @param key - A unique identifier for the rate-limited resource.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @returns The current {@link LimiterResult} after consumption.
   * @throws TooManyRequestsException if the limit is exceeded.
   *
   * @example
   * ```ts
   * await limiter.consume('uploads:user:1', 2)
   * ```
   */
  async consume(key: string, amount = 1): Promise<LimiterResult> {
    // Atomic conditional-consume: increment and lockout-on-exceed in one step.
    const result = this.store.consume
      ? await this.store.consume(key, this.max, this.windowMs, amount, this.blockDurationMs)
      : await this.store.increment(key, this.max, this.windowMs, amount)
    if (!result.allowed) {
      if (!this.store.consume && this.blockDurationMs) await this.store.block(key, this.blockDurationMs)
      throw new TooManyRequestsException('Too Many Requests', result.resetTime)
    }
    return result
  }

  /**
   * Consume slots without throwing on limit exceeded. Returns the result
   * for manual inspection.
   *
   * @param key - A unique identifier for the rate-limited resource.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @returns The current {@link LimiterResult} after incrementing.
   *
   * @example
   * ```ts
   * const result = await limiter.increment('api:user:1')
   * if (!result.allowed) { /* handle rate limit *\/ }
   * ```
   */
  async increment(key: string, amount = 1): Promise<LimiterResult> {
    return this.store.increment(key, this.max, this.windowMs, amount)
  }

  /**
   * Restore consumed slots, for example after a job completes or a request is cancelled.
   *
   * @param key - The rate-limit key to decrement.
   * @param amount - Number of slots to restore. Defaults to `1`.
   *
   * @example
   * ```ts
   * await limiter.decrement('jobs:user:1')
   * ```
   */
  async decrement(key: string, amount = 1): Promise<void> {
    return this.store.decrement(key, amount)
  }

  /**
   * Manually block a key for a specified duration, preventing any attempts.
   *
   * @param key - The rate-limit key to block.
   * @param duration - Block duration in seconds.
   *
   * @example
   * ```ts
   * await limiter.block('login:attacker-ip', 3600) // block for 1 hour
   * ```
   */
  async block(key: string, duration: number): Promise<void> {
    return this.store.block(key, duration * 1000)
  }

  /**
   * Get the current rate-limit state for a key without consuming a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current {@link LimiterResult}, or `null` if the key has no active window.
   *
   * @example
   * ```ts
   * const info = await limiter.get('api:user:1')
   * console.log(info?.remaining)
   * ```
   */
  async get(key: string): Promise<LimiterResult | null> {
    return this.store.get(key)
  }

  /**
   * Get the number of seconds until the key's current window resets.
   *
   * @param key - The rate-limit key to check.
   * @returns Seconds until the key is available again, or `0` if already available.
   *
   * @example
   * ```ts
   * const seconds = await limiter.availableIn('api:user:1')
   * ```
   */
  async availableIn(key: string): Promise<number> {
    const result = await this.store.get(key)
    return result?.resetTime || 0
  }

  /**
   * Delete a rate-limit key entirely, resetting its counter and unblocking it.
   *
   * @param key - The rate-limit key to remove.
   *
   * @example
   * ```ts
   * await limiter.delete('login:user@example.com')
   * ```
   */
  async delete(key: string): Promise<void> {
    return this.store.reset(key)
  }

  /**
   * Flush all rate-limit keys from the backing store.
   *
   * @example
   * ```ts
   * await limiter.clear()
   * ```
   */
  async clear(): Promise<void> {
    return this.store.clear()
  }
}

/**
 * Define a reusable, named throttle middleware whose options are resolved
 * per-request from the HTTP context.
 *
 * @param name - A unique name used as the default key prefix.
 * @param fn - A function that receives the HTTP context and returns limiter options.
 * @returns An HTTP middleware function.
 *
 * @example
 * ```ts
 * const apiThrottle = define('api', (ctx) => ({
 *   max: ctx.auth?.user ? 1000 : 60,
 *   window: 60,
 * }))
 * router.use(apiThrottle)
 * ```
 */
export function define(name: string, fn: (ctx: HttpContext) => LimiterOptions): MiddlewareFunction {
  return async (ctx: HttpContext, next: () => Promise<void>) => {
    const options = fn(ctx)
    const mw = limiter({ ...options, keyPrefix: options.keyPrefix || name })
    return mw(ctx, next)
  }
}
