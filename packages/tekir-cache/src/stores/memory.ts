import type { CacheStore } from '../types'

/**
 * In-memory cache store with optional TTL expiration. Data is stored in a Map
 * and lost when the process exits. Ideal for development and testing.
 *
 * @example
 * ```ts
 * const store = new MemoryCacheStore()
 * await store.set('key', 'value', 60)
 * const val = await store.get<string>('key') // 'value'
 * ```
 */
export class MemoryCacheStore implements CacheStore {
  private data = new Map<string, { value: unknown; expiresAt: number | null }>()
  private maxEntries: number
  private writes = 0

  /**
   * @param options.maxEntries - Hard cap on stored entries. When exceeded, the
   *   oldest insertion-order entry is evicted (after pruning expired ones).
   *   Defaults to 10000 to bound memory growth from never-read keys. Set to 0
   *   to disable the cap.
   */
  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10000
  }

  /** Remove every entry whose TTL has elapsed. */
  prune(): void {
    const now = Date.now()
    for (const [k, entry] of this.data) {
      if (entry.expiresAt && now > entry.expiresAt) this.data.delete(k)
    }
  }

  /**
   * Retrieve a cached value by key. Returns `null` if the key does not exist
   * or has expired.
   *
   * @param key - The cache key.
   * @returns The stored value cast to `T`, or `null`.
   */
  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.data.get(key)
    if (!entry) return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key)
      return null
    }
    return entry.value as T
  }

  /**
   * Store a value under the given key with an optional TTL.
   *
   * @param key - The cache key.
   * @param value - The value to cache.
   * @param ttlSeconds - Time-to-live in seconds. Omit for no expiration.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    })
    // Periodically sweep expired entries so keys that are never read again don't
    // accumulate unbounded, then enforce the size cap.
    if (this.maxEntries > 0) {
      if (++this.writes % 256 === 0) this.prune()
      while (this.data.size > this.maxEntries) {
        const oldest = this.data.keys().next().value
        if (oldest === undefined) break
        this.data.delete(oldest)
      }
    }
  }

  /**
   * Check whether a key exists and is not expired.
   *
   * @param key - The cache key.
   * @returns `true` if the key exists and has not expired.
   */
  async has(key: string): Promise<boolean> {
    // Check the map directly so an explicitly stored `null` value still counts
    // as present (get() alone can't distinguish stored-null from absent).
    const entry = this.data.get(key)
    if (!entry) return false
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key)
      return false
    }
    return true
  }

  /**
   * Delete a key from the store.
   *
   * @param key - The cache key to remove.
   * @returns `true` if the key was present and deleted.
   */
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  /**
   * Remove all entries from the store.
   */
  async flush(): Promise<void> {
    this.data.clear()
  }
}
