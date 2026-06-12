import type { App } from '@tekir/core'
import { RedisManager } from './manager'

/**
 * Service provider that reads the `redis` configuration and registers
 * a {@link RedisManager} instance in the application container.
 */
export class RedisProvider {
  /**
   * Register the Redis manager into the application container.
   *
   * @param app - The Tekir application instance.
   * @returns A promise that resolves once registration is complete.
   *
   * @example
   * ```ts
   * // In your providers list:
   * app.register(new RedisProvider())
   * ```
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('redis')) return
    app.instance('redis', new RedisManager(config('redis')))
  }
}
