import type { App } from '@tekir/core'
import type { CacheStore } from './types'
import { Cache } from './cache'
import { MemoryCacheStore } from './stores/memory'

/**
 * Service provider that registers a {@link Cache} instance into the application
 * container. Reads the `cache` configuration to create stores for each configured
 * driver (`memory`, `redis`, or `database`).
 *
 * @example
 * ```ts
 * // In your kernel:
 * app.register(new CacheProvider())
 * ```
 */
export class CacheProvider {
  /**
   * Register the cache service with the application. Reads `cache.stores`,
   * `cache.ttl`, and `cache.default` from the application config.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('cache')) return

    const storesConfig = config('cache.stores', {}) as Record<string, any>
    const stores: Record<string, CacheStore> = {}

    for (const [name, storeConfig] of Object.entries(storesConfig)) {
      // Already a CacheStore instance (backwards compat)
      if (storeConfig && typeof storeConfig.get === 'function') {
        stores[name] = storeConfig as CacheStore
        continue
      }

      const driver = storeConfig?.driver || name

      if (driver === 'memory') {
        stores[name] = new MemoryCacheStore()

      } else if (driver === 'redis') {
        let redis: any
        try { redis = app.use('redis') } catch {}
        if (!redis) {
          // Fallback: create instance from config
          let Redis: any
          try {
            // @ts-ignore optional peer; resolved at runtime, falls through
            // to the catch below if not installed.
            Redis = (await import('@tekir/redis')).Redis
          } catch {
            throw new Error(
              `[@tekir/cache] Store "${name}" uses the redis driver but @tekir/redis is not installed. ` +
              'Run: bun add @tekir/redis and register RedisProvider before CacheProvider.'
            )
          }
          redis = new Redis({ ...config('redis', {}), ...storeConfig })
        }
        const { RedisCacheStore } = await import('./stores/redis')
        stores[name] = new RedisCacheStore(redis, storeConfig?.prefix)

      } else if (driver === 'database') {
        let db: any
        try { db = app.use('db') } catch {}
        if (!db) {
          throw new Error(
            `[@tekir/cache] Store "${name}" uses the database driver but no database service is registered. ` +
            'Add DatabaseProvider to your kernel before CacheProvider.'
          )
        }
        const { DatabaseCacheStore } = await import('./stores/database')
        stores[name] = new DatabaseCacheStore(db, storeConfig?.table)

      } else {
        throw new Error(
          `[@tekir/cache] Unknown cache driver "${driver}" for store "${name}". ` +
          'Supported drivers: memory, redis, database'
        )
      }
    }

    // Fallback to memory if no stores configured
    if (Object.keys(stores).length === 0) {
      stores.memory = new MemoryCacheStore()
    }

    const cacheInstance = new Cache({
      stores,
      ttl: config('cache.ttl', 60) as number,
      default: config('cache.default', Object.keys(stores)[0]) as string,
    })
    app.instance('cache', cacheInstance)

    // Wire the cache() HTTP middleware so route-level `cache({ ttl: 60 })`
    // works without an explicit `store` option once this provider is
    // registered.
    const { setDefaultCacheStore } = await import('./http-cache')
    setDefaultCacheStore(cacheInstance)
  }
}
