import type { Transport, MailMessage, SevkConfig } from '../types'

// Sevk Transport (HTTP fetch — sevk.io)

export class SevkTransport implements Transport {
  readonly name = 'sevk'
  private baseUrl: string

  constructor(private config: SevkConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.sevk.io').replace(/\/+$/, '')
  }

  async send(message: MailMessage): Promise<void> {
    const body: Record<string, any> = {
      from: message.from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }

    if (message.cc) body.cc = Array.isArray(message.cc) ? message.cc : [message.cc]
    if (message.bcc) body.bcc = Array.isArray(message.bcc) ? message.bcc : [message.bcc]
    if (message.replyTo) body.reply_to = message.replyTo
    if (message.headers) body.headers = message.headers

    if (message.attachments?.length) {
      body.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: typeof a.content === 'string'
          ? a.content
          : Buffer.from(a.content).toString('base64'),
        contentType: a.contentType,
      }))
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
      throw new Error(`[tekir/mail] Sevk API error (${response.status}): ${truncate(error)}`)
    }
  }
}

/** Limit provider error bodies so they can't bloat or pollute logs. */
function truncate(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s
}
