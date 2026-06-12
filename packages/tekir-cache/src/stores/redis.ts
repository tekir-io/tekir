import type { CacheStore } from '../types'

// Lean shape: only the calls the cache store actually makes. `send` is
// intentionally absent because raw command shapes vary across clients
// (`@tekir/redis` typed string-only, ioredis any[], node-redis unknown[]).
// `flush()` invokes it through a structural cast so any client works.
interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
  // Accept both `Promise<boolean>` (@tekir/redis) and `Promise<number>`
  // (node-redis, ioredis). Normalised at the call site.
  exists(key: string): Promise<boolean | number>
  del(key: string): Promise<unknown>
}

interface RawSendable {
  send(command: string, args?: unknown[]): Promise<unknown>
}

/**
 * Redis-backed cache store with key prefixing and optional TTL.
 * Delegates all operations to a Redis client and prefixes keys to avoid collisions.
 *
 * @example
 * ```ts
 * const store = new RedisCacheStore(redisClient, 'app:cache:')
 * await store.set('user:1', { name: 'Alice' }, 300)
 * const user = await store.get<{ name: string }>('user:1')
 * ```
 */
export class RedisCacheStore implements CacheStore {
  private redis: RedisClient
  private prefix: string

  /**
   * Create a new RedisCacheStore.
   *
   * @param redis - A Redis client implementing the {@link RedisClient} interface.
   * @param prefix - A string prepended to every cache key. Defaults to `'cache:'`.
   */
  constructor(redis: RedisClient, prefix = 'cache:') {
    this.redis = redis
    this.prefix = prefix
  }

  /**
   * Retrieve a cached value by key. Returns `null` if the key does not exist.
   * The stored JSON string is parsed back into the original type.
   *
   * @param key - The cache key (without prefix).
   * @returns The stored value cast to `T`, or `null` if not found.
   *
   * @example
   * ```ts
   * const value = await store.get<string>('greeting') // 'hello' or null
   * ```
   */
  async get<T = any>(key: string): Promise<T | null> {
    const val = await this.redis.get(this.prefix + key)
    if (val === null) return null
    try { return JSON.parse(val) as T } catch { return val as unknown as T }
  }

  /**
   * Store a value under the given key with an optional TTL.
   * The value is serialized to JSON before being sent to Redis.
   *
   * @param key - The cache key (without prefix).
   * @param value - The value to cache (serialized to JSON).
   * @param ttlSeconds - Time-to-live in seconds. Omit for no expiration.
   *
   * @example
   * ```ts
   * await store.set('token', 'abc123', 3600) // expires in 1 hour
   * ```
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const val = JSON.stringify(value)
    const fullKey = this.prefix + key
    if (ttlSeconds) {
      const sendable = this.redis as unknown as Partial<RawSendable>
      if (typeof sendable.send === "function") {
        // Atomic SET ... EX so a crash between SET and EXPIRE can never leave a
        // permanent (TTL-less) key behind.
        await sendable.send("SET", [fullKey, val, "EX", String(Math.floor(ttlSeconds))])
      } else {
        // Fallback for clients without a raw `send`: best-effort two-step.
        await this.redis.set(fullKey, val)
        await this.redis.expire(fullKey, ttlSeconds)
      }
    } else {
      await this.redis.set(fullKey, val)
    }
  }

  /**
   * Check whether a key exists in Redis.
   *
   * @param key - The cache key (without prefix).
   * @returns `true` if the key exists.
   *
   * @example
   * ```ts
   * if (await store.has('session:abc')) { ... }
   * ```
   */
  async has(key: string): Promise<boolean> {
    // Coerces both shapes: @tekir/redis returns boolean, node-redis/ioredis
    // return number. `!!0` → false, `!!1` → true, `!!true` → true.
    return !!(await this.redis.exists(this.prefix + key))
  }

  /**
   * Delete a key from Redis.
   *
   * @param key - The cache key (without prefix) to remove.
   * @returns Always returns `true`.
   *
   * @example
   * ```ts
   * await store.delete('expired-token')
   * ```
   */
  async delete(key: string): Promise<boolean> {
    await this.redis.del(this.prefix + key)
    return true
  }

  /**
   * Remove only this store's keys (those under its prefix) using a non-blocking
   * SCAN + DEL. This no longer flushes the entire Redis database, so data owned
   * by other stores sharing the same database (sessions, queues, ...) is left
   * intact.
   *
   * If the prefix is empty (which would match every key) this throws rather than
   * risk wiping unrelated data; configure a non-empty prefix to use flush.
   *
   * @example
   * ```ts
   * await store.flush()
   * ```
   */
  async flush(): Promise<void> {
    if (!this.prefix) {
      throw new Error(
        '[@tekir/cache] RedisCacheStore.flush() refused: an empty prefix would delete every key in the database. Configure a non-empty prefix.'
      )
    }
    // Structural cast: callers may pass clients with varying `send` arg
    // types. We only need it to accept a string command and an array.
    const client = this.redis as unknown as RawSendable
    const pattern = `${this.prefix}*`
    let cursor = '0'
    do {
      const reply = (await client.send('SCAN', [cursor, 'MATCH', pattern, 'COUNT', '100'])) as [string, string[]]
      const [next, batch] = reply
      cursor = next
      if (batch && batch.length) await client.send('DEL', batch)
    } while (cursor !== '0')
  }
}
