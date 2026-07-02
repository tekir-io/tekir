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
   * @param options.timezone - Default IANA timezone (e.g. `'UTC'`) for every
   *   registered job. When omitted, patterns fire in the host's local time.
   */
  constructor(private readonly options?: { timezone?: string }) {}

  /**
   * Register the cron service with the application.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    app.instance('cron', new Cron(this.options))
  }
}
