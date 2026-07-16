export type { SentRecord } from './types'
import type { NotificationConfig, ChannelName, SentRecord } from './types'
import { BaseNotification } from './base'
import { DatabaseChannel } from './channels/database'
import { sendMailChannel } from './channels/mail'
import { sendPushChannel } from './channels/push'
import { sendLogChannel } from './channels/log'

// Core Notification

/**
 * Central notification manager that dispatches notifications across multiple
 * channels (mail, database, push, log). Supports fake mode for testing and
 * provides database channel proxies for reading and managing stored notifications.
 *
 * @example
 * ```ts
 * const notify = new Notification()
 * notify.configure({ db: dbAdapter, fcm: { serverKey: '...' } })
 * await notify.send('user-123', new WelcomeNotification())
 * ```
 */
export class Notification {
  private config: NotificationConfig = {}
  private _log: any = console
  private _fakeMode = false
  private _sent: SentRecord[] = []
  private _dbChannel: DatabaseChannel | null = null

  /**
   * Configure the notification manager with database and FCM adapters.
   * Typically called by {@link NotificationProvider} or manually during setup.
   *
   * @param config - The notification configuration including optional db adapter and FCM settings.
   *
   * @example
   * ```ts
   * notify.configure({ db: dbAdapter, fcm: { serverKey: 'my-key' } })
   * ```
   */
  configure(config: NotificationConfig): void {
    this.config = config
    this._dbChannel = config.db ? new DatabaseChannel(config.db) : null
  }

  private _ensureDb(): DatabaseChannel {
    if (!this._dbChannel) {
      throw new Error(
        'No database adapter configured. Pass a db adapter via NotificationProvider or notify.configure({ db }).'
      )
    }
    return this._dbChannel
  }

  /**
   * Send a notification to a single user across all channels defined by the
   * notification's {@link BaseNotification.via} method.
   *
   * @param userId - The target user's identifier.
   * @param notification - The notification instance to send.
   *
   * @example
   * ```ts
   * await notify.send('user-123', new OrderShippedNotification(order))
   * ```
   */
  async send(userId: string, notification: BaseNotification): Promise<void> {
    const channels = notification.via === BaseNotification.prototype.via && this.config.defaultChannels
      ? this.config.defaultChannels
      : notification.via(userId)
    // Per-channel error isolation: a single failing channel (e.g. a downed mail
    // transport) must not stop the others or surface as an unhandled rejection.
    const results = await Promise.allSettled(
      channels.map((ch) => this._dispatchChannel(userId, ch, notification))
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this._log.error?.(
          `[notification] Channel "${channels[i]}" failed for user ${userId}: ${r.reason}`
        )
      }
    })
  }

  /**
   * Send a notification to multiple users in parallel.
   *
   * @param userIds - An array of target user identifiers.
   * @param notification - The notification instance to send to each user.
   *
   * @example
   * ```ts
   * await notify.sendMany(['user-1', 'user-2'], new SystemAlertNotification())
   * ```
   */
  async sendMany(
    userIds: string[],
    notification: BaseNotification
  ): Promise<void> {
    // One user's failure must not abort delivery to the others. `send` already
    // isolates per-channel errors, but use allSettled here too for safety.
    await Promise.allSettled(userIds.map((uid) => this.send(uid, notification)))
  }

  /**
   * Get a handle to a specific channel, bypassing the notification's `via()` method.
   *
   * @param name - The channel name (`'mail'`, `'database'`, `'push'`, or `'log'`).
   * @returns An object with a `send` method for dispatching on that channel.
   *
   * @example
   * ```ts
   * await notify.channel('mail').send('user-123', new PasswordResetNotification())
   * ```
   */
  channel(name: ChannelName): {
    send: (userId: string, notification: BaseNotification) => Promise<void>
  } {
    return {
      send: (userId, notification) =>
        this._dispatchChannel(userId, name, notification),
    }
  }

  // Internal dispatcher
  private async _dispatchChannel(
    userId: string,
    channel: string,
    notification: BaseNotification
  ): Promise<void> {
    if (this._fakeMode) {
      let payload: unknown
      try {
        if (channel === 'mail' && typeof notification.toMail === 'function')
          payload = notification.toMail()
        else if (
          channel === 'database' &&
          typeof notification.toDatabase === 'function'
        )
          payload = notification.toDatabase()
        else if (
          channel === 'push' &&
          typeof notification.toPush === 'function'
        )
          payload = notification.toPush()
        else if (channel === 'log')
          payload =
            typeof notification.toLog === 'function'
              ? notification.toLog()
              : notification.constructor.name
      } catch {
        payload = null
      }
      this._sent.push({ userId, channel, notification, payload })
      return
    }

    switch (channel) {
      case 'mail':
        await sendMailChannel(userId, notification, this.config.mail)
        break
      case 'database':
        await this._ensureDb().send(userId, notification)
        break
      case 'push':
        await sendPushChannel(userId, notification, this.config.fcm)
        break
      case 'log':
        sendLogChannel(userId, notification)
        break
      default:
        this._log.warn(`[notification] Unknown channel: ${channel}`)
    }
  }

  // Database channel proxies — use notify.forUser() instead of notify.database.forUser()

  /**
   * Retrieve all stored notifications for a user from the database channel.
   *
   * @param userId - The target user's identifier.
   * @returns An array of {@link DatabaseRow} records ordered by creation date descending.
   *
   * @example
   * ```ts
   * const notifications = await notify.forUser('user-123')
   * ```
   */
  async forUser(userId: string) {
    return this._ensureDb().forUser(userId)
  }

  /**
   * Mark a single stored notification as read.
   *
   * @param notificationId - The notification record ID.
   *
   * @example
   * ```ts
   * await notify.markAsRead('1713000000000-a1b2c3d')
   * ```
   */
  async markAsRead(notificationId: string) {
    return this._ensureDb().markAsRead(notificationId)
  }

  /**
   * Mark all unread notifications for a user as read.
   *
   * @param userId - The target user's identifier.
   *
   * @example
   * ```ts
   * await notify.markAllAsRead('user-123')
   * ```
   */
  async markAllAsRead(userId: string) {
    return this._ensureDb().markAllAsRead(userId)
  }

  /**
   * Get the number of unread notifications for a user.
   *
   * @param userId - The target user's identifier.
   * @returns The count of unread notifications.
   *
   * @example
   * ```ts
   * const count = await notify.unreadCount('user-123')
   * ```
   */
  async unreadCount(userId: string) {
    return this._ensureDb().unreadCount(userId)
  }

  // Testing helpers

  /**
   * Enter fake mode for testing. While active, no notifications are actually
   * dispatched; instead they are recorded and can be inspected with
   * {@link assertSent} and {@link getSent}.
   *
   * @example
   * ```ts
   * notify.fake()
   * await notify.send('user-1', new WelcomeNotification())
   * notify.assertSent(WelcomeNotification)
   * notify.restore()
   * ```
   */
  fake(): void {
    this._fakeMode = true
    this._sent = []
  }

  /**
   * Exit fake mode, clearing all recorded sends and restoring real dispatch behaviour.
   */
  restore(): void {
    this._fakeMode = false
    this._sent = []
  }

  /**
   * Assert that a notification of the given class was sent during fake mode.
   * Optionally filter by channel and/or user ID. Throws if no match is found.
   *
   * @param notificationClass - The notification class constructor to match.
   * @param channel - Optional channel name to filter by.
   * @param userId - Optional user ID to filter by.
   * @throws Error if no matching sent record is found.
   *
   * @example
   * ```ts
   * notify.assertSent(WelcomeNotification, 'mail', 'user-123')
   * ```
   */
  assertSent(
    notificationClass: new (...args: any[]) => BaseNotification,
    channel?: ChannelName,
    userId?: string
  ): void {
    const match = this._sent.find((r) => {
      const classMatch = r.notification instanceof notificationClass
      const channelMatch = channel ? r.channel === channel : true
      const userMatch = userId ? r.userId === userId : true
      return classMatch && channelMatch && userMatch
    })
    if (!match) {
      const parts: string[] = [`${notificationClass.name}`]
      if (channel) parts.push(`channel=${channel}`)
      if (userId) parts.push(`userId=${userId}`)
      throw new Error(
        `[notification:assertSent] Expected notification not sent: ${parts.join(', ')}`
      )
    }
  }

  /**
   * Return all recorded sends from fake mode for custom assertions.
   *
   * @returns A shallow copy of the sent records array.
   *
   * @example
   * ```ts
   * const sent = notify.getSent()
   * expect(sent).toHaveLength(2)
   * ```
   */
  getSent(): SentRecord[] {
    return [...this._sent]
  }
}
