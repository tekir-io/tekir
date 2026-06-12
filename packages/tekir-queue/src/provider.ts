import type { App } from '@tekir/core'
import { MemoryBackend } from './backends/memory'
import { Queue } from './queue'

/**
 * Service provider that registers a {@link Queue} instance into the application
 * container. Reads the `queue.driver` config value to select a backend
 * (`memory`, `redis`, or `database`).
 *
 * @example
 * ```ts
 * // In your kernel:
 * app.register(new QueueProvider())
 * ```
 */
export class QueueProvider {
  /**
   * Register the queue service with the application.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    const config = app.use('config')
    const driver = config('queue.driver', 'memory') as string
    let backend: any

    if (driver === 'memory') {
      backend = new MemoryBackend()

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
            '[@tekir/queue] Queue driver "redis" requires @tekir/redis. Run: bun add @tekir/redis and register RedisProvider.'
          )
        }
        redis = new Redis({ ...config('redis', {}), ...(config('queue', {}) as any) })
      }
      const { RedisBackend } = await import('./backends/redis')
      backend = new RedisBackend(redis)

    } else if (driver === 'database') {
      let db: any
      try { db = app.use('db') } catch {}
      if (!db) {
        throw new Error(
          '[@tekir/queue] Queue driver "database" requires a database service. ' +
          'Add DatabaseProvider to your kernel before QueueProvider.'
        )
      }
      const { DatabaseBackend } = await import('./backends/database')
      backend = new DatabaseBackend(db)

    } else {
      throw new Error(
        `[@tekir/queue] Unknown queue driver "${driver}". Supported: memory, redis, database`
      )
    }

    app.instance('queue', new Queue(backend))
  }
}
