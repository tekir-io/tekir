import type { MailPayload, DatabasePayload, PushPayload, ChannelName } from './types'

/**
 * Abstract base class for all notifications. Subclasses define which channels
 * the notification is sent on via {@link via}, and provide channel-specific
 * payloads by implementing `toMail()`, `toDatabase()`, `toPush()`, or `toLog()`.
 *
 * @example
 * ```ts
 * class WelcomeNotification extends BaseNotification {
 *   via() { return ['mail', 'database'] as const }
 *   toMail() { return { to: this.email, subject: 'Welcome!', html: '<h1>Hi</h1>' } }
 *   toDatabase() { return { type: 'welcome', title: 'Welcome', body: 'Thanks for joining' } }
 * }
 * ```
 */
export abstract class BaseNotification {
  /**
   * Return the channels this notification should be sent on. Override in
   * subclasses to customise per-user or per-notification routing.
   *
   * @param _userId - The target user's identifier (available for conditional routing).
   * @returns An array of channel names.
   *
   * @example
   * ```ts
   * via(userId) { return userId === 'admin' ? ['mail', 'push'] : ['database'] }
   * ```
   */
  via(_userId?: string): ChannelName[] {
    return ['log']
  }

  /**
   * Build the mail payload for the `mail` channel.
   * @returns A {@link MailPayload} object, or `undefined` if not implemented.
   */
  toMail?(): MailPayload

  /**
   * Build the database payload for the `database` channel.
   * @returns A {@link DatabasePayload} object, or `undefined` if not implemented.
   */
  toDatabase?(): DatabasePayload

  /**
   * Build the push notification payload for the `push` channel.
   * @returns A {@link PushPayload} object, or `undefined` if not implemented.
   */
  toPush?(): PushPayload

  /**
   * Build a log message string for the `log` channel.
   * @returns A human-readable log string, or `undefined` to use the default.
   */
  toLog?(): string
}
