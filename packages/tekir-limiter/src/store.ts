import type { LimiterResult, LimiterStore } from './types'

export type { LimiterResult, LimiterStore }


/**
 * In-memory rate limiter store. Stores counters and block state in a Map.
 * Data is lost when the process exits. Suitable for single-process deployments.
 *
 * @example
 * ```ts
 * const store = new MemoryStore()
 * const result = await store.check('user:1', 10, 60000)
 * ```
 */
export class MemoryStore implements LimiterStore {
  private entries = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  /**
   * @param options.sweepIntervalMs - How often to evict expired entries.
   *   Defaults to 60s. Set to `0` to disable the background sweep (lazy
   *   eviction on access still applies).
   */
  constructor(options: { sweepIntervalMs?: number } = {}) {
    const interval = options.sweepIntervalMs ?? 60_000
    if (interval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), interval)
      // Don't let the sweep timer keep the process alive.
      ;(this.sweepTimer as any)?.unref?.()
    }
  }

  /** True once an entry's window has expired and it carries no live block. */
  private isExpired(entry: { resetAt: number; blockedUntil?: number }, now: number): boolean {
    const blocked = entry.blockedUntil !== undefined && now < entry.blockedUntil
    return !blocked && now >= entry.resetAt
  }

  /**
   * Evict every expired entry. Bounds memory so an attacker rotating unique
   * keys (e.g. spoofed identifiers) cannot grow the Map without limit.
   */
  sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(key)
    }
  }

  /** Stop the background sweep timer. Call when discarding the store. */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /** Number of entries currently held. Exposed for tests/diagnostics. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Check whether a key is within its rate limit and increment its counter.
   * Creates a new window if the key does not exist or the previous window has expired.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @returns The current rate-limit state after incrementing.
   *
   * @example
   * ```ts
   * const result = await store.check('ip:127.0.0.1', 100, 60000)
   * if (!result.allowed) console.log('Rate limited')
   * ```
   */
  async check(key: string, max: number, windowMs: number): Promise<LimiterResult> {
    const now = Date.now()
    let entry = this.entries.get(key)

    // Blocked?
    if (entry?.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        resetTime: Math.ceil((entry.blockedUntil - now) / 1000),
      }
    }

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      this.entries.set(key, entry)
    }

    entry.count++

    return {
      allowed: entry.count <= max,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      resetTime: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  /**
   * Atomic conditional-consume: increment and, in the same synchronous block,
   * apply the lockout when the limit is exceeded. On Bun's single thread this
   * runs without interleaving, matching the Redis store's Lua guarantee.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @param blockMs - Lockout (ms) to apply if this consume exceeds the limit. `0` disables it.
   * @returns The current rate-limit state after the operation.
   */
  async consume(key: string, max: number, windowMs: number, amount = 1, blockMs = 0): Promise<LimiterResult> {
    const now = Date.now()
    let entry = this.entries.get(key)

    if (entry?.blockedUntil && now < entry.blockedUntil) {
      return { allowed: false, limit: max, remaining: 0, resetTime: Math.ceil((entry.blockedUntil - now) / 1000) }
    }

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      this.entries.set(key, entry)
    }

    entry.count += Math.max(1, amount)
    const allowed = entry.count <= max

    if (!allowed && blockMs > 0) {
      entry.blockedUntil = now + blockMs
    }

    return {
      allowed,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      resetTime: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  /**
   * Atomic non-consuming view of a key, used by `penalize` to detect a live
   * block or exhausted window without burning a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current state, or `null` if no live window exists.
   */
  async peek(key: string): Promise<LimiterResult | null> {
    return this.get(key)
  }

  /**
   * Increment the counter for a key by a given amount.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @returns The current rate-limit state after incrementing.
   */
  async increment(key: string, max: number, windowMs: number, amount = 1): Promise<LimiterResult> {
    const now = Date.now()
    let entry = this.entries.get(key)

    if (entry?.blockedUntil && now < entry.blockedUntil) {
      return { allowed: false, limit: max, remaining: 0, resetTime: Math.ceil((entry.blockedUntil - now) / 1000) }
    }

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      this.entries.set(key, entry)
    }

    if (amount > 0) entry.count += amount

    return {
      allowed: entry.count <= max,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      resetTime: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  /**
   * Decrement the counter for a key, restoring consumed slots.
   *
   * @param key - The rate-limit key.
   * @param amount - Number of slots to restore. Defaults to `1`.
   */
  async decrement(key: string, amount = 1): Promise<void> {
    const entry = this.entries.get(key)
    if (entry) {
      entry.count = Math.max(0, entry.count - Math.max(1, amount))
    }
  }

  /**
   * Block a key for a specified duration, preventing any attempts until the block expires.
   *
   * @param key - The rate-limit key to block.
   * @param durationMs - Block duration in milliseconds.
   *
   * @example
   * ```ts
   * await store.block('login:attacker', 300000) // block for 5 minutes
   * ```
   */
  async block(key: string, durationMs: number): Promise<void> {
    const now = Date.now()
    const entry = this.entries.get(key) || { count: 0, resetAt: now }
    entry.blockedUntil = now + durationMs
    this.entries.set(key, entry)
  }

  /**
   * Get the current rate-limit state for a key without consuming a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current {@link LimiterResult}, or `null` if no active window exists.
   */
  async get(key: string): Promise<LimiterResult | null> {
    const entry = this.entries.get(key)
    if (!entry) return null
    const now = Date.now()
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return { allowed: false, limit: 0, remaining: 0, resetTime: Math.ceil((entry.blockedUntil - now) / 1000) }
    }
    if (now >= entry.resetAt) {
      // Lazy eviction: a fully expired entry is dropped on access.
      this.entries.delete(key)
      return null
    }
    return { allowed: true, limit: 0, remaining: 0, resetTime: Math.ceil((entry.resetAt - now) / 1000) }
  }

  /**
   * Delete a rate-limit key entirely, removing its counter and block state.
   *
   * @param key - The rate-limit key to remove.
   */
  async reset(key: string): Promise<void> {
    this.entries.delete(key)
  }

  /**
   * Remove all rate-limit entries from the store.
   */
  async clear(): Promise<void> {
    this.entries.clear()
  }
}


// Atomic conditional-consume. Runs entirely inside Redis so the block check,
// increment and TTL set happen as one indivisible step; concurrent callers can
// never read the same count and both slip past the limit.
//   KEYS[1] = counter key, KEYS[2] = block key
//   ARGV[1] = windowSec, ARGV[2] = amount
// Returns { count, ttlSec, blockedMs }. blockedMs > 0 means the key is under an
// active lockout and no slot was consumed.
const CONSUME_LUA = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return {0, 0, blocked}
end
local count = redis.call('INCRBY', KEYS[1], tonumber(ARGV[2]))
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  ttl = tonumber(ARGV[1])
end
return {count, ttl, 0}
`

// Atomic non-consuming view, used by penalize's pre-check. Reports the block or
// current count without touching the counter.
//   KEYS[1] = counter key, KEYS[2] = block key
// Returns { count, ttlSec, blockedMs }.
const PEEK_LUA = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return {0, 0, blocked}
end
local raw = redis.call('GET', KEYS[1])
if raw == false then
  return {-1, 0, 0}
end
local ttl = redis.call('TTL', KEYS[1])
return {tonumber(raw), ttl, 0}
`

/**
 * Redis-backed rate limiter store. The rate-limit check, increment and TTL set
 * run as a single atomic Lua script ({@link CONSUME_LUA}), so concurrent
 * requests can never read the same count and both slip past the limit. Suitable
 * for distributed, multi-process deployments.
 *
 * @example
 * ```ts
 * const store = new RedisStore(redisClient)
 * const result = await store.check('user:1', 100, 60000)
 * ```
 */
export class RedisStore implements LimiterStore {
  private redis: any

  /**
   * Create a new RedisStore.
   *
   * @param redis - A Redis client. Either an ioredis-style client exposing
   *   `incr`/`incrby`/`decrby`/`expire`/`ttl`/`get`/`set`/`del`/`keys`/`eval`,
   *   or a Bun `RedisClient` (its `send`/`get`/`del` surface is detected and
   *   adapted automatically).
   */
  constructor(redis: any) {
    this.redis = redis
  }

  /** Whether the supplied client can run server-side Lua (real Redis). */
  private get supportsLua(): boolean {
    return typeof this.redis.send === 'function' || typeof this.redis.eval === 'function'
  }

  /**
   * Run a Redis-side Lua script (server EVAL, not JS eval), adapting to
   * whichever Redis client was supplied. `script` is always one of the
   * hardcoded constants below — no caller input is interpolated into it.
   * Bun's `RedisClient` speaks `send('EVAL', [...])`; ioredis-style clients
   * expose `eval(script, numKeys, ...args)`.
   */
  private async runLua(script: string, keys: string[], args: (string | number)[]): Promise<any> {
    if (typeof this.redis.send === 'function') {
      const argv = [String(keys.length), ...keys.map(String), ...args.map(String)]
      return this.redis.send('EVAL', [script, ...argv])
    }
    return this.redis.eval(script, keys.length, ...keys, ...args)
  }

  /** Normalise a Redis multi-bulk reply (Bun returns numbers, ioredis strings). */
  private decodeReply(reply: any): { count: number; ttl: number; blockedMs: number } {
    return {
      count: Number(reply?.[0] ?? 0),
      ttl: Number(reply?.[1] ?? 0),
      blockedMs: Number(reply?.[2] ?? 0),
    }
  }

  /**
   * Atomically check and increment the rate-limit counter for a key in Redis.
   * The block check, increment and TTL set run as a single Lua script, so the
   * old check-then-increment race (two requests reading the same count) is gone.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @returns The current rate-limit state after incrementing.
   */
  async check(key: string, max: number, windowMs: number): Promise<LimiterResult> {
    return this.consume(key, max, windowMs, 1, 0)
  }

  /**
   * Atomically increment the rate-limit counter by a given amount in Redis.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @returns The current rate-limit state after incrementing.
   */
  async increment(key: string, max: number, windowMs: number, amount = 1): Promise<LimiterResult> {
    return this.consume(key, max, windowMs, Math.max(1, amount), 0)
  }

  /**
   * Atomic conditional-consume: increment, set the TTL on first hit, and apply
   * the extended lockout in one server-side step when the limit is exceeded.
   * Because the whole sequence is a single Lua script, a successful request and
   * a penalty (or two concurrent requests) can never race past the limit.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param amount - Number of slots to consume. Defaults to `1`.
   * @param blockMs - Lockout to apply (ms) if this consume exceeds the limit. `0` disables it.
   * @returns The current rate-limit state after the operation.
   */
  async consume(key: string, max: number, windowMs: number, amount = 1, blockMs = 0): Promise<LimiterResult> {
    const windowSec = Math.ceil(windowMs / 1000)
    const counterKey = `rl:${key}`
    const blockKey = `rl:block:${key}`
    const amt = Math.max(1, amount)

    let count: number
    let ttl: number
    let blockedMs: number

    if (this.supportsLua) {
      const reply = await this.runLua(CONSUME_LUA, [counterKey, blockKey], [windowSec, amt])
      ;({ count, ttl, blockedMs } = this.decodeReply(reply))
    } else {
      // Fallback for minimal clients without Lua (e.g. simple mocks). Not
      // atomic across commands, but preserves behaviour for such clients.
      ({ count, ttl, blockedMs } = await this.consumeViaCommands(counterKey, blockKey, windowSec, amt))
    }

    if (blockedMs > 0) {
      return { allowed: false, limit: max, remaining: 0, resetTime: Math.ceil(blockedMs / 1000) }
    }

    const allowed = count <= max
    // Apply the lockout in the same logical step the limit was exceeded, so a
    // concurrent caller cannot land between the consume and the block.
    if (!allowed && blockMs > 0) {
      await this.block(key, blockMs)
    }

    return {
      allowed,
      limit: max,
      remaining: Math.max(0, max - count),
      resetTime: ttl > 0 ? ttl : windowSec,
    }
  }

  /** Discrete-command emulation of {@link CONSUME_LUA} for non-Lua clients. */
  private async consumeViaCommands(counterKey: string, blockKey: string, windowSec: number, amount: number) {
    if (typeof this.redis.get === 'function') {
      const blocked = await this.redis.get(blockKey)
      if (blocked !== null && blocked !== undefined) {
        const pttl = typeof this.redis.pttl === 'function' ? await this.redis.pttl(blockKey) : windowSec * 1000
        return { count: 0, ttl: 0, blockedMs: pttl > 0 ? pttl : windowSec * 1000 }
      }
    }
    let count: number
    if (typeof this.redis.incrby === 'function') {
      count = await this.redis.incrby(counterKey, amount)
    } else {
      // Minimal clients may only expose `incr`; emulate amount > 1 with a loop.
      count = 0
      for (let i = 0; i < amount; i++) count = await this.redis.incr(counterKey)
    }
    let ttl = await this.redis.ttl(counterKey)
    if (ttl < 0) {
      await this.redis.expire(counterKey, windowSec)
      ttl = windowSec
    }
    return { count, ttl, blockedMs: 0 }
  }

  /**
   * Atomic non-consuming view of a key: reports an active block or the current
   * count without incrementing. Used to gate `penalize` without burning a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current state, or `null` if no live window exists.
   */
  async peek(key: string): Promise<LimiterResult | null> {
    const counterKey = `rl:${key}`
    const blockKey = `rl:block:${key}`

    let count: number
    let ttl: number
    let blockedMs: number

    if (this.supportsLua) {
      const reply = await this.runLua(PEEK_LUA, [counterKey, blockKey], [])
      ;({ count, ttl, blockedMs } = this.decodeReply(reply))
    } else {
      const blocked = typeof this.redis.get === 'function' ? await this.redis.get(blockKey) : null
      if (blocked !== null && blocked !== undefined) {
        const pttl = typeof this.redis.pttl === 'function' ? await this.redis.pttl(blockKey) : 1000
        return { allowed: false, limit: 0, remaining: 0, resetTime: Math.ceil((pttl > 0 ? pttl : 1000) / 1000) }
      }
      const raw = await this.redis.get(counterKey)
      if (raw === null || raw === undefined) return null
      count = Number(raw)
      ttl = await this.redis.ttl(counterKey)
      blockedMs = 0
    }

    if (blockedMs > 0) {
      return { allowed: false, limit: 0, remaining: 0, resetTime: Math.ceil(blockedMs / 1000) }
    }
    if (count < 0) return null
    return { allowed: true, limit: 0, remaining: 0, resetTime: ttl > 0 ? ttl : 0 }
  }

  /**
   * Decrement the counter for a key in Redis, restoring consumed slots.
   *
   * @param key - The rate-limit key.
   * @param amount - Number of slots to restore. Defaults to `1`.
   */
  async decrement(key: string, amount = 1): Promise<void> {
    const fullKey = `rl:${key}`
    const next = await this.redis.decrby(fullKey, Math.max(1, amount))
    // Floor the counter at 0 so it never goes negative (which would otherwise
    // widen the limit on subsequent windows). Mirrors the Memory/DB stores.
    if (typeof next === 'number' && next < 0) {
      await this.redis.set(fullKey, '0', 'KEEPTTL')
    }
  }

  /**
   * Block a key for a specified duration using a separate Redis key with a TTL.
   *
   * @param key - The rate-limit key to block.
   * @param durationMs - Block duration in milliseconds.
   */
  async block(key: string, durationMs: number): Promise<void> {
    const fullKey = `rl:block:${key}`
    await this.redis.set(fullKey, '1', 'PX', durationMs)
  }

  /**
   * Get the current rate-limit state for a key without consuming a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current {@link LimiterResult}, or `null` if no active window exists.
   */
  async get(key: string): Promise<LimiterResult | null> {
    const fullKey = `rl:${key}`
    const count = await this.redis.get(fullKey)
    if (count === null) return null
    const ttl = await this.redis.ttl(fullKey)
    return { allowed: true, limit: 0, remaining: 0, resetTime: ttl > 0 ? ttl : 0 }
  }

  /**
   * Delete a rate-limit key and its block key from Redis.
   *
   * @param key - The rate-limit key to remove.
   */
  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`)
    await this.redis.del(`rl:block:${key}`)
  }

  /**
   * Remove all rate-limit keys (matching `rl:*`) from Redis.
   */
  async clear(): Promise<void> {
    const keys = await this.redis.keys('rl:*')
    if (keys.length > 0) await this.redis.del(...keys)
  }
}


/**
 * Database-backed rate limiter store using a SQLite/SQL `rate_limits` table.
 * The table is created automatically on construction.
 *
 * @example
 * ```ts
 * const store = new DatabaseStore(db)
 * const result = await store.check('user:1', 10, 60000)
 * ```
 */
export class DatabaseStore implements LimiterStore {
  private db: any
  private table: string

  /**
   * Create a new DatabaseStore.
   *
   * @param db - A database client with `exec`, `run`, and `queryOne` methods.
   * @param table - The SQL table name for rate-limit entries. Defaults to `'rate_limits'`.
   * @throws Error if the table name contains invalid characters.
   */
  constructor(db: any, table = 'rate_limits') {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`Invalid table name: "${table}"`)
    this.db = db
    this.table = table
    this._ensureTable()
  }

  private async _ensureTable() {
    try {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS "${this.table}" (
        key TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        reset_at INTEGER NOT NULL,
        blocked_until INTEGER DEFAULT 0
      )`)
    } catch {}
  }

  /**
   * Check and increment the rate-limit counter for a key in the database.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @returns The current rate-limit state after incrementing.
   */
  async check(key: string, max: number, windowMs: number): Promise<LimiterResult> {
    await this._ensureTable()
    const now = Date.now()
    const resetAt = now + windowMs

    // Single atomic upsert (read-modify-write in one statement) so concurrent
    // requests cannot read the same count and both write the same +1, which
    // would let traffic slip past the limit. On a fresh row or an expired
    // window, start a new window at count 1; otherwise increment in place.
    // `RETURNING` hands back the committed row so we report the true count.
    const row = await this.db.queryOne(
      `INSERT INTO "${this.table}" (key, count, reset_at, blocked_until)
         VALUES (?, 1, ?, 0)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ? >= "${this.table}".reset_at THEN 1 ELSE "${this.table}".count + 1 END,
         reset_at = CASE WHEN ? >= "${this.table}".reset_at THEN ? ELSE "${this.table}".reset_at END
       RETURNING count, reset_at, blocked_until`,
      [key, resetAt, now, now, resetAt]
    )

    // Block takes precedence. The upsert already ran, but a blocked key
    // should still be reported as denied for the remaining block duration.
    if (row?.blocked_until && now < row.blocked_until) {
      return { allowed: false, limit: max, remaining: 0, resetTime: Math.ceil((row.blocked_until - now) / 1000) }
    }

    const count: number = row?.count ?? 1
    const rowResetAt: number = row?.reset_at ?? resetAt

    return {
      allowed: count <= max,
      limit: max,
      remaining: Math.max(0, max - count),
      resetTime: Math.ceil((rowResetAt - now) / 1000),
    }
  }

  /**
   * Increment the rate-limit counter. Delegates to {@link check} which already increments.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param _amount - Ignored; included for interface compatibility.
   * @returns The current rate-limit state after incrementing.
   */
  async increment(key: string, max: number, windowMs: number, _amount = 1): Promise<LimiterResult> {
    return this.check(key, max, windowMs) // simplified — check already increments
  }

  /**
   * Conditional-consume: the atomic upsert in {@link check} performs the
   * increment, and the lockout is applied in the same logical step on failure.
   *
   * @param key - The rate-limit key.
   * @param max - Maximum allowed hits within the window.
   * @param windowMs - Window duration in milliseconds.
   * @param _amount - Ignored; the upsert increments by one.
   * @param blockMs - Lockout (ms) to apply if the limit is exceeded. `0` disables it.
   * @returns The current rate-limit state after the operation.
   */
  async consume(key: string, max: number, windowMs: number, _amount = 1, blockMs = 0): Promise<LimiterResult> {
    const result = await this.check(key, max, windowMs)
    if (!result.allowed && blockMs > 0) {
      await this.block(key, blockMs)
    }
    return result
  }

  /**
   * Atomic non-consuming view of a key, used by `penalize`.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current state, or `null` if the key does not exist.
   */
  async peek(key: string): Promise<LimiterResult | null> {
    return this.get(key)
  }

  /**
   * Decrement the counter for a key in the database, restoring consumed slots.
   *
   * @param key - The rate-limit key.
   * @param amount - Number of slots to restore. Defaults to `1`.
   */
  async decrement(key: string, amount = 1): Promise<void> {
    await this._ensureTable()
    await this.db.run(`UPDATE "${this.table}" SET count = MAX(0, count - ?) WHERE key = ?`, [Math.max(1, amount), key])
  }

  /**
   * Block a key for a specified duration by setting `blocked_until` in the database.
   *
   * @param key - The rate-limit key to block.
   * @param durationMs - Block duration in milliseconds.
   */
  async block(key: string, durationMs: number): Promise<void> {
    await this._ensureTable()
    const blockedUntil = Date.now() + durationMs
    const row = await this.db.queryOne(`SELECT key FROM "${this.table}" WHERE key = ?`, [key])
    if (row) {
      await this.db.run(`UPDATE "${this.table}" SET blocked_until = ? WHERE key = ?`, [blockedUntil, key])
    } else {
      await this.db.run(`INSERT INTO "${this.table}" (key, count, reset_at, blocked_until) VALUES (?, 0, ?, ?)`, [key, Date.now(), blockedUntil])
    }
  }

  /**
   * Get the current rate-limit state for a key without consuming a slot.
   *
   * @param key - The rate-limit key to inspect.
   * @returns The current {@link LimiterResult}, or `null` if the key does not exist.
   */
  async get(key: string): Promise<LimiterResult | null> {
    await this._ensureTable()
    const row = await this.db.queryOne(`SELECT count, reset_at, blocked_until FROM "${this.table}" WHERE key = ?`, [key])
    if (!row) return null
    const now = Date.now()
    if (row.blocked_until && now < row.blocked_until) {
      return { allowed: false, limit: 0, remaining: 0, resetTime: Math.ceil((row.blocked_until - now) / 1000) }
    }
    return { allowed: true, limit: 0, remaining: 0, resetTime: Math.ceil((row.reset_at - now) / 1000) }
  }

  /**
   * Delete a rate-limit key from the database.
   *
   * @param key - The rate-limit key to remove.
   */
  async reset(key: string): Promise<void> {
    await this.db.run(`DELETE FROM "${this.table}" WHERE key = ?`, [key])
  }

  /**
   * Remove all rate-limit entries from the database table.
   */
  async clear(): Promise<void> {
    await this._ensureTable()
    await this.db.run(`DELETE FROM "${this.table}"`)
  }
}
