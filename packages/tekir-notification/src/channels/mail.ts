import type { BaseNotification } from '../base'

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
  notification: BaseNotification
): Promise<void> {
  if (typeof notification.toMail !== 'function') {
    throw new Error(
      `${notification.constructor.name} does not implement toMail()`
    )
  }
  const payload = (notification.toMail as () => any)()

  let mod: any
  try {
    mod = await import('@tekir/mail') as any
  } catch {
    throw new Error(
      '[@tekir/notification] Mail channel requires @tekir/mail. Run: bun add @tekir/mail'
    )
  }

  // Defense-in-depth: sanitize header fields (to/subject/headers/...) here too,
  // so the notification -> mail path can never inject headers regardless of how
  // the resolved mail object is wired. @tekir/mail's dispatch() also sanitizes,
  // but this channel may pass a raw payload, so do not rely on that alone.
  const safePayload =
    typeof mod.sanitizeMessage === 'function' ? mod.sanitizeMessage(payload) : payload

  const mail = mod.default ?? mod
  await mail.send(safePayload)
}
