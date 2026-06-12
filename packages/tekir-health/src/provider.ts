import type { App } from '@tekir/core'
import { Health } from './health'

/**
 * Service provider that registers the Health manager into the application container.
 *
 * @example
 * ```ts
 * app.register(new HealthProvider())
 * ```
 */
export class HealthProvider {
  /**
   * Register the Health service into the app container if health config is present.
   *
   * Note: this registers an empty {@link Health} manager. Concrete checks
   * (DbCheck, RedisCheck, custom checks) must be registered by the application,
   * because they need live client instances that the provider cannot infer:
   *
   * ```ts
   * const health = app.use('health') as Health
   * health.register([new DbCheck(db), new RedisCheck(redis)])
   * ```
   *
   * Until checks are registered, `run()` returns a healthy report with no
   * checks; this is intentional but easy to overlook, so a warning is logged.
   *
   * @param {App} app - The application instance
   * @returns {Promise<void>}
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('health')) return
    const health = new Health()
    app.instance('health', health)
    queueMicrotask(() => {
      if (!health.hasChecks()) {
        console.warn(
          '[@tekir/health] No health checks registered. ' +
          'health.run() will report "healthy" with no checks until you register some.'
        )
      }
    })
  }
}
