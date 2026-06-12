import type { CacheManagerOptions, CacheStore } from './types'
import { MemoryCacheStore } from './stores/memory'


/**
 * Multi-store cache manager that delegates to configured {@link CacheStore}
 * implementations. Supports named stores, a default TTL, and convenience
 * methods like {@link getOrSet} and {@link pull}.
 *
 * @example
 * ```ts
 * const cache = new Cache({ stores: { memory: new MemoryCacheStore() }, ttl: 60 })
 * await cache.set('key', 'value')
 * const val = await cache.get<string>('key')
 * ```
 */
export class Cache {
  private stores: Record<string, CacheStore>
  private defaultStore: string
  private defaultTtl: number
  // In-flight factory promises keyed by `<store>:<key>` for single-flight
  // stampede protection in getOrSet.
  private inFlight = new Map<string, Promise<unknown>>()

  /**
   * Create a new Cache instance.
   *
   * @param config - Cache configuration including stores, default store name, and TTL.
   */
  constructor(config: CacheManagerOptions = {}) {
    this.stores = config.stores || { memory: new MemoryCacheStore() }
    this.defaultStore = config.default || Object.keys(this.stores)[0]
    this.defaultTtl = config.ttl || 3600
  }

  /**
   * Retrieve a specific named store, or the default store if no name is given.
   *
   * @param name - The store name. Omit to use the default store.
   * @returns The resolved {@link CacheStore} instance.
   * @throws Error if the requested store is not configured.
   *
   * @example
   * ```ts
   * const redis = cache.store('redis')
   * await redis.get('key')
   * ```
   */
  store(name?: string): CacheStore {
    const storeName = name || this.defaultStore
    const s = this.stores[storeName]
    if (!s) throw new Error(`Cache store "${storeName}" not configured`)
    return s
  }

  /**
   * Get a value from the default store.
   *
   * @param key - The cache key.
   * @returns The cached value, or `null` if not found or expired.
   */
  async get<T = any>(key: string): Promise<T | null> { return this.store().get<T>(key) }

  /**
   * Set a value in the default store.
   *
   * @param key - The cache key.
   * @param value - The value to store.
   * @param ttl - Time-to-live in seconds. Falls back to the default TTL.
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> { return this.store().set(key, value, ttl ?? this.defaultTtl) }

  /**
   * Check whether a key exists (and is not expired) in the default store.
   *
   * @param key - The cache key.
   * @returns `true` if the key exists.
   */
  async has(key: string): Promise<boolean> { return this.store().has(key) }

  /**
   * Delete a key from the default store.
   *
   * @param key - The cache key.
   * @returns `true` if the key was deleted.
   */
  async delete(key: string): Promise<boolean> { return this.store().delete(key) }

  /**
   * Flush all entries from the default store.
   */
  async flush(): Promise<void> { return this.store().flush() }

  /**
   * Get a cached value or compute and store it if missing. Inspired by AdonisJS.
   *
   * @param key - The cache key.
   * @param ttl - Time-to-live in seconds for the computed value.
   * @param factory - An async function that produces the value when not cached.
   * @returns The cached or freshly-computed value.
   *
   * Concurrent misses for the same key share a single `factory()` execution
   * (single-flight) so a popular key expiring does not trigger a stampede
   * (thundering herd) against the backend.
   *
   * @example
   * ```ts
   * const users = await cache.getOrSet('users', 300, () => db.query('SELECT * FROM users'))
   * ```
   */
  async getOrSet<T>(key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached

    const flightKey = `${this.defaultStore}:${key}`
    const existing = this.inFlight.get(flightKey)
    if (existing) return existing as Promise<T>

    const promise = (async () => {
      const value = await factory()
      await this.set(key, value, ttl)
      return value
    })().finally(() => this.inFlight.delete(flightKey))

    this.inFlight.set(flightKey, promise)
    return promise
  }

  /**
   * Get a value and immediately delete it from the cache (atomic get-and-remove).
   *
   * @param key - The cache key.
   * @returns The cached value, or `null` if not found.
   *
   * @example
   * ```ts
   * const token = await cache.pull<string>('one-time-token')
   * ```
   */
  async pull<T = unknown>(key: string): Promise<T | null> {
    const value = await this.get<T>(key)
    // Use has() rather than a null-check so that an explicitly cached `null`
    // value is still evicted (get() alone cannot distinguish "absent" from
    // "stored null").
    if (value !== null || (await this.has(key))) await this.delete(key)
    return value
  }
}

/**
 * Create a new {@link Cache} instance with the given configuration.
 *
 * @param config - Optional cache configuration.
 * @returns A new Cache instance.
 *
 * @example
 * ```ts
 * const cache = createCache({ ttl: 120 })
 * ```
 */
export function createCache(config?: CacheManagerOptions): Cache {
  return new Cache(config)
}
