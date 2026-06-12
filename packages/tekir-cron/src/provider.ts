import type { App } from '@tekir/core'
import { Cron } from './manager'

/**
 * Service provider that registers a {@link Cron} instance into the application container.
 *
 * @example
 * ```ts
 * app.register(new CronProvider())
 * ```
 */
export class CronProvider {
  /**
   * Register the cron service with the application.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    app.instance('cron', new Cron())
  }
}
