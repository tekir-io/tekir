import type { DbAdapter, DatabaseRow } from '../types'
import type { BaseNotification } from '../base'

/**
 * Generate a unique notification identifier using the current timestamp and a random suffix.
 *
 * @returns A string in the format `<timestamp>-<random>`.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Keys whose values are masked before a notification payload is persisted. */
const SENSITIVE_KEYS = /^(password|token|secret|api_?key|access_?token|refresh_?token|otp|pin|ssn|credit_?card|cvv)$/i

/**
 * Return a shallow copy of the payload with sensitive fields redacted so
 * tokens/PII are not persisted in plaintext in the notifications table.
 */
function redactPayload(
  payload: Record<string, unknown>,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  if (seen.has(payload)) return { circular: '[circular]' }
  seen.add(payload)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = '[redacted]'
    else if (Array.isArray(v)) {
      out[k] = v.map((item) => {
        if (!item || typeof item !== 'object') return item
        if (seen.has(item)) return '[circular]'
        if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return item
        return redactPayload(item as Record<string, unknown>, seen)
      })
    }
    else if (v && typeof v === 'object' &&
      (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      out[k] = redactPayload(v as Record<string, unknown>, seen)
    }
    else out[k] = v
  }
  seen.delete(payload)
  return out
}

/**
 * Database notification channel that persists notifications in a `notifications` table
 * and provides methods for querying, reading, and counting stored notifications.
 *
 * @example
 * ```ts
 * const channel = new DatabaseChannel(dbAdapter)
 * await channel.send('user-123', notification)
 * const all = await channel.forUser('user-123')
 * ```
 */
export class DatabaseChannel {
  /**
   * Create a new DatabaseChannel.
   *
   * @param db - A database adapter implementing the {@link DbAdapter} interface.
   */
  constructor(private db: DbAdapter) {}

  /**
   * Persist a notification for a user in the database. The notification must
   * implement `toDatabase()`.
   *
   * @param userId - The target user's identifier.
   * @param notification - The notification instance.
   * @throws Error if the notification does not implement `toDatabase()`.
   *
   * @example
   * ```ts
   * await channel.send('user-123', new OrderConfirmation(order))
   * ```
   */
  async send(userId: string, notification: BaseNotification): Promise<void> {
    if (typeof notification.toDatabase !== 'function') {
      throw new Error(
        `${notification.constructor.name} does not implement toDatabase()`
      )
    }
    const payload = (notification.toDatabase as () => any)()
    const id = generateId()
    const now = new Date().toISOString()
    await this.db.execute(
      `INSERT INTO notifications (id, user_id, type, title, body, data, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        id,
        userId,
        payload.type,
        payload.title,
        payload.body,
        JSON.stringify(redactPayload(payload)),
        now,
      ]
    )
  }

  /**
   * Retrieve all notifications for a user, ordered by creation date descending.
   *
   * @param userId - The target user's identifier.
   * @returns An array of {@link DatabaseRow} records.
   *
   * @example
   * ```ts
   * const notifications = await channel.forUser('user-123')
   * ```
   */
  async forUser(userId: string): Promise<DatabaseRow[]> {
    return await this.db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    )
  }

  /**
   * Mark a single notification as read by setting its `read_at` timestamp.
   *
   * @param notificationId - The notification record ID.
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.db.execute(
      `UPDATE notifications SET read_at = ? WHERE id = ?`,
      [new Date().toISOString(), notificationId]
    )
  }

  /**
   * Mark all unread notifications for a user as read.
   *
   * @param userId - The target user's identifier.
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.db.execute(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
      [new Date().toISOString(), userId]
    )
  }

  /**
   * Get the number of unread notifications for a user.
   *
   * @param userId - The target user's identifier.
   * @returns The count of unread notifications.
   */
  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      [userId]
    )
    return rows[0]?.count ?? 0
  }
}
