import type { App } from '@tekir/core'
import type { SessionConfig } from './types'
import { session } from './middleware'
import { MemorySessionStore } from './stores/memory'

/**
 * Service provider that configures and registers session middleware globally.
 * Resolves the session driver (memory, redis, database) from the app config.
 */
export class SessionProvider {
  /**
   * Boots the session middleware by resolving the configured driver and
   * registering the session middleware as a global middleware.
   *
   * @param app - The application instance.
   */
  async boot(app: App) {
    const config = app.use('config')
    if (!config('session')) return

    const sessionConfig = { ...config('session') } as SessionConfig
    const driver = sessionConfig.driver || 'memory'

    // If store is already provided (backwards compat), use it
    if (!sessionConfig.store) {
      if (driver === 'memory') {
        sessionConfig.store = new MemorySessionStore()

      } else if (driver === 'redis') {
        let redis: any
        try { redis = app.use('redis') } catch {}
        if (!redis) {
          let Redis: any
          try {
            // @ts-ignore optional peer; resolved at runtime.
            Redis = (await import('@tekir/redis')).Redis
          } catch {
            throw new Error(
              '[@tekir/session] Session driver "redis" requires @tekir/redis. Run: bun add @tekir/redis and register RedisProvider.'
            )
          }
          // `session.prefix` belongs to the session store. Do not also feed it
          // into @tekir/redis or keys become `sess:sess:<id>`.
          redis = new Redis(config('redis', {}))
        }
        const { RedisSessionStore } = await import('./stores/redis')
        sessionConfig.store = new RedisSessionStore(redis, sessionConfig.prefix || 'sess:')

      } else if (driver === 'database') {
        let db: any
        try { db = app.use('db') } catch {}
        if (!db) {
          throw new Error(
            '[@tekir/session] Session driver "database" requires a database service. ' +
            'Add DatabaseProvider to your kernel before SessionProvider.'
          )
        }
        const { DatabaseSessionStore } = await import('./stores/database')
        sessionConfig.store = new DatabaseSessionStore(db, sessionConfig.table || 'sessions')

      } else {
        throw new Error(
          `[@tekir/session] Unknown session driver "${driver}". Supported: memory, redis, database`
        )
      }
    }

    app.use('router').useGlobal(session(sessionConfig))
  }
}
