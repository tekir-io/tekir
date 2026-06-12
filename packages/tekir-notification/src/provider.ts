import type { App } from '@tekir/core'
import { Notification } from './manager'

/**
 * Service provider that registers a {@link Notification} manager into the
 * application container. Reads the `notification` config and auto-injects
 * a database adapter from the `db` service if available.
 *
 * @example
 * ```ts
 * app.register(new NotificationProvider())
 * ```
 */
export class NotificationProvider {
  /**
   * Register the notification service with the application.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('notification')) return

    const notificationConfig = { ...config('notification') }

    // Auto-inject db service for database channel if available
    if (!notificationConfig.db) {
      let db: any
      try { db = app.use('db') } catch {}
      if (db && typeof db.query === 'function') {
        notificationConfig.db = {
          query: db.query.bind(db),
          execute: db.run.bind(db),
        }
      }
    }

    const mgr = new Notification()
    mgr.configure(notificationConfig)
    app.instance('notification', mgr)
  }
}
