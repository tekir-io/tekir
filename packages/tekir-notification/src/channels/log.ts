import type { BaseNotification } from '../base'

// Log channel -- uses framework logger if set, console otherwise

let _logger: any = null

/**
 * Set the logger instance used by the log notification channel.
 * If not set, `console` is used as a fallback.
 *
 * @param logger - A logger object with an `info` method.
 *
 * @example
 * ```ts
 * setNotificationLogger(app.use('logger'))
 * ```
 */
export function setNotificationLogger(logger: any) { _logger = logger }

/**
 * Send a notification via the log channel. Outputs the notification's
 * `toLog()` result (or a default label) using the configured logger.
 *
 * @param userId - The target user's identifier.
 * @param notification - The notification instance.
 *
 * @example
 * ```ts
 * sendLogChannel('user-123', new WelcomeNotification())
 * // logs: [notification:log] [WelcomeNotification] -> user:user-123
 * ```
 */
export function sendLogChannel(
  userId: string,
  notification: BaseNotification
): void {
  const log = _logger || console
  const label =
    typeof notification.toLog === 'function'
      ? notification.toLog()
      : `[${notification.constructor.name}] → user:${userId}`
  log.info(`[notification:log] ${label}`)
}
