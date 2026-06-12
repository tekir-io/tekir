import type { Transport, MailMessage, ResendConfig } from '../types'

// Resend Transport (HTTP fetch)

/**
 * Mail transport that delivers emails via the Resend HTTP API.
 * Supports attachments (base64-encoded) and custom headers.
 *
 * @example
 * ```ts
 * const transport = new ResendTransport({ apiKey: 're_...' })
 * await transport.send({ to: 'user@example.com', subject: 'Hello', from: 'noreply@example.com' })
 * ```
 */
export class ResendTransport implements Transport {
  readonly name = 'resend'
  private baseUrl: string

  constructor(private config: ResendConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.resend.com'
  }

  /**
   * Send an email message through the Resend API.
   *
   * @param message - The mail message to send
   * @returns A promise that resolves when the Resend API accepts the message
   * @throws Error if the Resend API returns a non-OK response
   */
  async send(message: MailMessage): Promise<void> {
    const body = {
      from: message.from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      cc: message.cc
        ? Array.isArray(message.cc)
          ? message.cc
          : [message.cc]
        : undefined,
      bcc: message.bcc
        ? Array.isArray(message.bcc)
          ? message.bcc
          : [message.bcc]
        : undefined,
      reply_to: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === 'string'
            ? a.content
            : a.content.toString('base64'),
      })),
    }

    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`[tekir/mail] Resend API error (${response.status}): ${truncate(error)}`)
    }
  }
}

/** Limit provider error bodies so they can't bloat or pollute logs. */
function truncate(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s
}
