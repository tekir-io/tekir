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

    // Route notification mail through the configured @tekir/mail service.
    if (!notificationConfig.mail) {
      let mail: any
      try { mail = app.use('mail') } catch {}
      if (mail && typeof mail.dispatch === 'function') {
        notificationConfig.mail = { dispatch: mail.dispatch.bind(mail) }
      }
    }

    // Auto-inject db service for database channel if available
    if (!notificationConfig.db) {
      let db: any
      try { db = app.use('db') } catch {}
      const execute = typeof db?.execute === 'function'
        ? db.execute
        : typeof db?.run === 'function'
          ? db.run
          : undefined
      if (db && typeof db.query === 'function' && execute) {
        notificationConfig.db = {
          query: db.query.bind(db),
          execute: execute.bind(db),
        }
      }
    }

    const mgr = new Notification()
    mgr.configure(notificationConfig)
    app.instance('notification', mgr)
  }
}
