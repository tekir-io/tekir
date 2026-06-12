import type { RedisConnectionConfig } from './types'

/**
 * Redis client wrapper around Bun's native RedisClient.
 *
 * Provides a high-level API for string, hash, set, and pub/sub operations,
 * plus JSON helpers and a cache-aside `remember` method.
 *
 * @example
 * ```ts
 * const redis = new Redis({ url: 'redis://localhost:6379', prefix: 'app:' })
 * await redis.set('greeting', 'hello')
 * const val = await redis.get('greeting') // 'hello'
 * ```
 */
export class Redis {
  private client: any
  private prefix: string
  private config: RedisConnectionConfig

  /**
   * @param config - Redis connection configuration.
   */
  constructor(config: RedisConnectionConfig = {}) {
    this.config = config
    this.prefix = config.prefix || ''

    const { RedisClient } = Bun as any
    const url = config.url || process.env.REDIS_URL || 'redis://localhost:6379'

    // Encourage TLS in production: a plaintext redis:// connection exposes
    // credentials and data to network observers. Warn once instead of throwing
    // to stay backward compatible with local/dev setups.
    const isTls = config.tls != null || url.startsWith('rediss://')
    if (!isTls && process.env.NODE_ENV === 'production') {
      console.warn(
        `[@tekir/redis] Connecting to ${Redis.maskUrl(url)} without TLS in production. ` +
        `Use a rediss:// URL or set tls to encrypt credentials and data in transit.`
      )
    }

    this.client = new RedisClient(url, {
      connectionTimeout: config.connectionTimeout,
      idleTimeout: config.idleTimeout,
      autoReconnect: config.autoReconnect ?? true,
      maxRetries: config.maxRetries ?? 10,
      enableAutoPipelining: config.enableAutoPipelining ?? true,
      tls: config.tls,
    })
  }

  private key(k: string): string {
    return this.prefix ? `${this.prefix}:${k}` : k
  }

  /**
   * Strip any credentials embedded in a Redis URL so it is safe to log.
   *
   * @param url - The connection URL, possibly containing `user:pass@host`.
   * @returns The URL with the userinfo component masked.
   */
  private static maskUrl(url: string): string {
    return url.replace(/(\w+:\/\/)([^@/]+)@/, '$1***@')
  }

  // ─── Connection ────────────────────────────────────────

  /**
   * Open the connection to the Redis server.
   *
   * @returns A promise that resolves once the connection is established.
   *
   * @example
   * ```ts
   * await redis.connect()
   * ```
   */
  async connect(): Promise<void> { await this.client.connect() }

  /**
   * Close the connection to the Redis server.
   */
  close(): void { this.client.close() }

  /**
   * Whether the client is currently connected to Redis.
   *
   * @returns `true` if the connection is active.
   */
  get connected(): boolean { return this.client.connected }

  // ─── String operations ────────────────────────────────

  /**
   * Get the value of a key.
   *
   * @param key - The key to retrieve.
   * @returns The string value, or `null` if the key does not exist.
   *
   * @example
   * ```ts
   * const val = await redis.get('name') // 'Alice' | null
   * ```
   */
  async get(key: string): Promise<string | null> { return this.client.get(this.key(key)) }

  /**
   * Set the value of a key.
   *
   * @param key - The key to set.
   * @param value - The string or numeric value to store.
   *
   * @example
   * ```ts
   * await redis.set('counter', 42)
   * ```
   */
  async set(key: string, value: string | number): Promise<void> { await this.client.set(this.key(key), String(value)) }

  /**
   * Delete one or more keys.
   *
   * @param keys - The keys to delete.
   *
   * @example
   * ```ts
   * await redis.del('key1', 'key2')
   * ```
   */
  async del(...keys: string[]): Promise<void> { await this.client.del(...keys.map(k => this.key(k))) }

  /**
   * Check whether a key exists.
   *
   * @param key - The key to check.
   * @returns `true` if the key exists.
   */
  async exists(key: string): Promise<boolean> { return this.client.exists(this.key(key)) }

  /**
   * Increment the integer value of a key by one.
   *
   * @param key - The key to increment.
   * @returns The new value after incrementing.
   */
  async incr(key: string): Promise<number> { return this.client.incr(this.key(key)) }

  /**
   * Decrement the integer value of a key by one.
   *
   * @param key - The key to decrement.
   * @returns The new value after decrementing.
   */
  async decr(key: string): Promise<number> { return this.client.decr(this.key(key)) }

  /**
   * Set a timeout on a key (in seconds).
   *
   * @param key - The key to set the expiry on.
   * @param seconds - Time-to-live in seconds.
   */
  async expire(key: string, seconds: number): Promise<void> { await this.client.expire(this.key(key), seconds) }

  /**
   * Get the remaining time-to-live of a key in seconds.
   *
   * @param key - The key to query.
   * @returns Remaining TTL in seconds, `-1` if no expiry is set, `-2` if the key does not exist.
   */
  async ttl(key: string): Promise<number> { return this.client.ttl(this.key(key)) }

  // ─── Hash operations ──────────────────────────────────

  /**
   * Get the value of a single field in a hash.
   *
   * @param key - The hash key.
   * @param field - The field name within the hash.
   * @returns The field value, or `null` if the field or key does not exist.
   */
  async hget(key: string, field: string): Promise<string | null> { return this.client.hget(this.key(key), field) }

  /**
   * Set multiple field-value pairs in a hash.
   *
   * @param key - The hash key.
   * @param fields - An array of alternating field names and values (e.g. `['f1', 'v1', 'f2', 'v2']`).
   */
  async hmset(key: string, fields: string[]): Promise<void> { await this.client.hmset(this.key(key), fields) }

  /**
   * Get the values of multiple fields in a hash.
   *
   * @param key - The hash key.
   * @param fields - An array of field names to retrieve.
   * @returns An array of values corresponding to the requested fields (`null` for missing fields).
   */
  async hmget(key: string, fields: string[]): Promise<(string | null)[]> { return this.client.hmget(this.key(key), fields) }

  /**
   * Increment a numeric field in a hash by a given amount.
   *
   * @param key - The hash key.
   * @param field - The field name to increment.
   * @param increment - The integer amount to add.
   * @returns The new value of the field after incrementing.
   */
  async hincrby(key: string, field: string, increment: number): Promise<number> { return this.client.hincrby(this.key(key), field, increment) }

  // ─── Set operations ───────────────────────────────────

  /**
   * Add one or more members to a set.
   *
   * @param key - The set key.
   * @param members - The members to add.
   * @returns The number of members that were added (excluding already-present members).
   */
  async sadd(key: string, ...members: string[]): Promise<number> { return this.client.sadd(this.key(key), ...members) }

  /**
   * Remove one or more members from a set.
   *
   * @param key - The set key.
   * @param members - The members to remove.
   * @returns The number of members that were removed.
   */
  async srem(key: string, ...members: string[]): Promise<number> { return this.client.srem(this.key(key), ...members) }

  /**
   * Check whether a value is a member of a set.
   *
   * @param key - The set key.
   * @param member - The value to check for.
   * @returns `true` if the member exists in the set.
   */
  async sismember(key: string, member: string): Promise<boolean> { return this.client.sismember(this.key(key), member) }

  /**
   * Get all members of a set.
   *
   * @param key - The set key.
   * @returns An array of all members in the set.
   */
  async smembers(key: string): Promise<string[]> { return this.client.smembers(this.key(key)) }

  // ─── Pub/Sub ──────────────────────────────────────────

  /**
   * Publish a message to a channel.
   *
   * @param channel - The channel name.
   * @param message - The message string to publish.
   */
  async publish(channel: string, message: string): Promise<void> { await this.client.publish(channel, message) }

  /**
   * Subscribe to a channel and receive messages via a callback.
   *
   * The message passed to the callback is the raw string received from Redis and
   * is NOT deserialized by this wrapper. Treat it as untrusted input: validate
   * it and never `eval` it. If you `JSON.parse` it, wrap the parse in a
   * try/catch to guard against poisoned payloads.
   *
   * @param channel - The channel name to subscribe to.
   * @param callback - Invoked for each message received on the channel.
   *
   * @example
   * ```ts
   * await redis.subscribe('events', (msg, ch) => {
   *   console.log(`Received on ${ch}: ${msg}`)
   * })
   * ```
   */
  async subscribe(channel: string, callback: (message: string, channel: string) => void): Promise<void> {
    await this.client.subscribe(channel, callback)
  }

  /**
   * Unsubscribe from a channel, or from all channels if none is specified.
   *
   * @param channel - The channel to unsubscribe from. Omit to unsubscribe from all.
   */
  async unsubscribe(channel?: string): Promise<void> { await this.client.unsubscribe(channel) }

  // ─── Raw command ──────────────────────────────────────

  /**
   * Send a raw Redis command. ADVANCED / INTERNAL escape hatch.
   *
   * This bypasses the key prefix and every higher-level safeguard. The `command`
   * and `args` are passed straight to Redis, so they MUST be trusted, statically
   * known values. Never build a command name or its arguments from user input:
   * doing so allows execution of dangerous commands (`FLUSHALL`, `CONFIG`,
   * `EVAL`, `KEYS *`, ...) and lets callers escape the prefix namespace.
   *
   * @param command - A trusted, statically-known Redis command (e.g. `'PING'`, `'INFO'`).
   * @param args - Arguments for the command. Must not contain untrusted input.
   * @returns The raw response from Redis.
   *
   * @example
   * ```ts
   * const pong = await redis.send('PING') // 'PONG'
   * ```
   */
  async send(command: string, args: string[] = []): Promise<any> { return this.client.send(command, args) }

  // ─── JSON helpers ─────────────────────────────────────

  /**
   * Get a value from Redis and parse it as JSON.
   *
   * @param key - The key to retrieve.
   * @returns The parsed object, or `null` if the key does not exist or parsing fails.
   *
   * @example
   * ```ts
   * const user = await redis.getJSON<{ name: string }>('user:1')
   * ```
   */
  async getJSON<T = any>(key: string): Promise<T | null> {
    const val = await this.get(key)
    if (val === null) return null
    try {
      return JSON.parse(val)
    } catch (e) {
      // Surface corrupt/poisoned payloads instead of silently masking them as a
      // cache miss. Returning null still preserves the previous behaviour for
      // callers, but the warning makes the problem diagnosable.
      console.warn(`[@tekir/redis] Failed to parse JSON for key "${key}": ${(e as Error).message}`)
      return null
    }
  }

  /**
   * Serialize a value as JSON and store it in Redis, with an optional TTL.
   *
   * @param key - The key to store the value under.
   * @param value - The value to JSON-serialize and store.
   * @param expireSeconds - Optional time-to-live in seconds.
   *
   * @example
   * ```ts
   * await redis.setJSON('user:1', { name: 'Alice' }, 3600)
   * ```
   */
  async setJSON(key: string, value: any, expireSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value)
    if (expireSeconds && expireSeconds > 0) {
      // Atomic SET ... EX so a crash between writing the value and setting the
      // TTL can never leave a permanent (TTL-less) key behind.
      await this.client.send('SET', [this.key(key), payload, 'EX', String(Math.floor(expireSeconds))])
    } else {
      await this.client.set(this.key(key), payload)
    }
  }

  /**
   * Cache-aside helper: return the cached value if it exists, otherwise execute
   * the callback, store the result in Redis with a TTL, and return it.
   *
   * @param key - The cache key.
   * @param seconds - Time-to-live in seconds for the cached value.
   * @param callback - Async function invoked to compute the value on a cache miss.
   * @returns The cached or freshly computed value.
   *
   * On a cache miss this acquires a short-lived `SET NX` lock so that, under
   * concurrent misses, only one caller runs `callback()` while the others wait
   * for the freshly-populated value. This protects the backend from a stampede
   * (thundering herd) when a hot key expires.
   *
   * @example
   * ```ts
   * const users = await redis.remember('all-users', 60, async () => {
   *   return db.query('SELECT * FROM users')
   * })
   * ```
   */
  async remember<T>(key: string, seconds: number, callback: () => Promise<T>): Promise<T> {
    const cached = await this.getJSON<T>(key)
    if (cached !== null) return cached

    const lockKey = this.key(`${key}:__lock`)
    // Try to become the single flight that computes the value. SET NX EX gives
    // a self-expiring lock so a crashed holder cannot deadlock other callers.
    const acquired = await this.client.send('SET', [lockKey, '1', 'NX', 'EX', '10'])

    if (acquired == null) {
      // Another caller is computing it. Briefly poll for the populated value
      // before falling back to computing it ourselves (lock may have expired).
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 100))
        const waited = await this.getJSON<T>(key)
        if (waited !== null) return waited
      }
    }

    try {
      // Re-check after acquiring the lock: a racing holder may have populated it.
      const fresh = await this.getJSON<T>(key)
      if (fresh !== null) return fresh
      const value = await callback()
      await this.setJSON(key, value, seconds)
      return value
    } finally {
      await this.del(`${key}:__lock`).catch(() => {})
    }
  }

  /**
   * Delete every key under this connection's prefix using a non-blocking SCAN.
   *
   * Unlike {@link Redis.flushdb}, this is scoped: it only removes keys that
   * belong to this logical store (`<prefix>:*`), leaving other stores that
   * share the same Redis database (sessions, queues, ...) untouched. If no
   * prefix is configured this deletes nothing and returns `0`, to avoid
   * accidentally wiping the whole database.
   *
   * @returns The number of keys deleted.
   */
  async clearPrefix(): Promise<number> {
    if (!this.prefix) return 0
    const pattern = `${this.prefix}:*`
    let cursor = '0'
    let deleted = 0
    do {
      const [next, batch]: [string, string[]] = await this.client.send('SCAN', [cursor, 'MATCH', pattern, 'COUNT', '100'])
      cursor = next
      if (batch.length) {
        await this.client.send('DEL', batch)
        deleted += batch.length
      }
    } while (cursor !== '0')
    return deleted
  }

  /**
   * Delete ALL keys in the currently selected database. DANGEROUS.
   *
   * This ignores the key prefix and removes every key in the database, including
   * data owned by other logical stores (sessions, queues, other caches) that
   * share the same Redis database. Prefer {@link Redis.clearPrefix} to delete
   * only this store's keys. Never expose this to user-triggered code paths.
   *
   * @returns A promise that resolves once the database has been flushed.
   */
  async flushdb(): Promise<void> { await this.send('FLUSHDB', []) }

  /**
   * Get the underlying Bun `RedisClient` instance for advanced operations.
   *
   * @returns The raw Bun RedisClient.
   */
  getClient(): any { return this.client }
}
