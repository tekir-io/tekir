import type { FcmConfig } from '../types'
import type { BaseNotification } from '../base'

// Push channel (FCM HTTP v1 / legacy)

let _logger: any = null

/**
 * Set the logger instance used by the push notification channel.
 * If not set, `console` is used as a fallback.
 *
 * @param logger - A logger object with a `warn` method.
 */
export function setPushLogger(logger: any) { _logger = logger }

/**
 * Send a notification via the push channel using Firebase Cloud Messaging (FCM).
 * The notification must implement `toPush()`. If no FCM server key is configured,
 * a warning is logged and the push is skipped.
 *
 * @param userId - The target user's identifier (used to derive the FCM topic).
 * @param notification - The notification instance.
 * @param fcm - Optional FCM configuration with server key and endpoint.
 * @throws Error if the notification does not implement `toPush()`.
 *
 * @example
 * ```ts
 * await sendPushChannel('user-123', new AlertNotification(), { serverKey: 'key' })
 * ```
 */
/**
 * Normalize a user id into a valid FCM topic name. FCM restricts topics to
 * `[a-zA-Z0-9-_.~%]+`; any other character is replaced with `_` so an
 * unvalidated user id can't produce an invalid or injected topic.
 */
export function topicForUser(userId: string): string {
  const safe = String(userId).replace(/[^a-zA-Z0-9\-_.~%]/g, '_')
  return `user_${safe}`
}

export async function sendPushChannel(
  userId: string,
  notification: BaseNotification,
  fcm?: FcmConfig
): Promise<void> {
  const log = _logger || console
  if (typeof notification.toPush !== 'function') {
    throw new Error(
      `${notification.constructor.name} does not implement toPush()`
    )
  }
  const payload = (notification.toPush as () => any)()
  const topic = topicForUser(userId)

  // Prefer the HTTP v1 API when OAuth credentials are available: v1 requires a
  // Bearer token and the `message.topic` schema. Fall back to the legacy API
  // (server key + `to:` schema) so the auth scheme and endpoint always match.
  const accessToken = fcm?.accessToken ?? (fcm?.getAccessToken ? await fcm.getAccessToken() : undefined)

  if (accessToken) {
    const endpoint =
      fcm?.endpoint ??
      `https://fcm.googleapis.com/v1/projects/${fcm?.projectId ?? '-'}/messages:send`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          topic,
          notification: payload,
        },
      }),
    })
    if (!response.ok) {
      const body = await safeBody(response)
      throw new Error(`[notification:push] FCM v1 send failed (${response.status}): ${body}`)
    }
    return
  }

  if (!fcm?.serverKey) {
    log.warn(`[notification:push] No FCM credentials configured — skipping push for user ${userId}`)
    return
  }

  // Legacy API: endpoint and `Authorization: key=...` scheme must go together.
  const endpoint = fcm.endpoint ?? 'https://fcm.googleapis.com/fcm/send'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `key=${fcm.serverKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: `/topics/${topic}`,
      notification: payload,
    }),
  })
  if (!response.ok) {
    const body = await safeBody(response)
    throw new Error(`[notification:push] FCM legacy send failed (${response.status}): ${body}`)
  }
}

/** Read and truncate a response body without letting credentials/secrets bloat logs. */
async function safeBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.length > 300 ? text.slice(0, 300) + '…(truncated)' : text
  } catch {
    return '(no body)'
  }
}
