export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<boolean>
  flush(): Promise<void>
}

/** Driver-based config that the provider expands into a CacheStore instance. */
export interface CacheStoreDriverConfig {
  driver?: 'memory' | 'redis' | 'database'
  /** Optional key prefix (redis driver). */
  prefix?: string
  /** Optional table name (database driver). */
  table?: string
  /** Allow driver-specific extras without losing autocomplete on the known fields. */
  [key: string]: unknown
}

/**
 * User-facing config shape — what `config/cache.ts` exports. Stores can be
 * either concrete `CacheStore` instances or driver-config objects which the
 * provider expands before instantiating {@link Cache}.
 */
export interface CacheConfig {
  default?: string
  stores?: Record<string, CacheStore | CacheStoreDriverConfig>
  ttl?: number // default TTL in seconds
}

/**
 * Internal options accepted by the {@link Cache} constructor after the
 * provider has expanded driver configs into concrete stores.
 */
export interface CacheManagerOptions {
  default?: string
  stores?: Record<string, CacheStore>
  ttl?: number
}
