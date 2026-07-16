import type { BaseNotification } from '../base'
import type { MailAdapter } from '../types'
import { sanitizeMessage } from '@tekir/mail'

/**
 * Send a notification via the mail channel using `@tekir/mail`.
 * The notification must implement `toMail()`.
 *
 * @param _userId - The target user's identifier (unused; the mail payload contains `to`).
 * @param notification - The notification instance.
 * @throws Error if the notification does not implement `toMail()`.
 * @throws Error if `@tekir/mail` is not installed.
 *
 * @example
 * ```ts
 * await sendMailChannel('user-123', new PasswordResetNotification())
 * ```
 */
export async function sendMailChannel(
  _userId: string,
  notification: BaseNotification,
  mail?: MailAdapter
): Promise<void> {
  if (typeof notification.toMail !== 'function') {
    throw new Error(
      `${notification.constructor.name} does not implement toMail()`
    )
  }
  const payload = (notification.toMail as () => any)()

  if (!mail) {
    throw new Error(
      '[@tekir/notification] No mail adapter configured. Register MailProvider before NotificationProvider or pass notify.configure({ mail }).'
    )
  }

  // Defense-in-depth: sanitize header fields (to/subject/headers/...) here too,
  // so the notification -> mail path can never inject headers regardless of how
  // the resolved mail object is wired. @tekir/mail's dispatch() also sanitizes,
  // but this channel may pass a raw payload, so do not rely on that alone.
  await mail.dispatch(sanitizeMessage(payload))
}
