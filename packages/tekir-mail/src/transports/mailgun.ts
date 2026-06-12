import type { Transport, MailMessage, MailgunConfig } from '../types'

// Mailgun Transport (HTTP fetch)

/**
 * Mail transport that delivers emails via the Mailgun HTTP API.
 * Supports US and EU regions, custom headers, and attachments (sent as
 * multipart/form-data).
 *
 * @example
 * ```ts
 * const transport = new MailgunTransport({ apiKey: 'key-...', domain: 'mg.example.com', region: 'us' })
 * await transport.send({ to: 'user@example.com', subject: 'Hello', from: 'noreply@example.com' })
 * ```
 */
export class MailgunTransport implements Transport {
  readonly name = 'mailgun'

  constructor(private config: MailgunConfig) {}

  private get apiBase(): string {
    const host =
      this.config.region === 'eu'
        ? 'https://api.eu.mailgun.net'
        : 'https://api.mailgun.net'
    return `${host}/v3/${this.config.domain}`
  }

  /**
   * Send an email message through the Mailgun API.
   *
   * @param message - The mail message to send
   * @returns A promise that resolves when the Mailgun API accepts the message
   * @throws Error if the Mailgun API returns a non-OK response
   */
  async send(message: MailMessage): Promise<void> {
    // FormData supports both simple fields and file parts, so attachments are no
    // longer silently dropped.
    const form = new FormData()

    if (message.from) form.append('from', message.from)

    const toList = Array.isArray(message.to) ? message.to : [message.to]
    toList.forEach((t) => form.append('to', t))

    if (message.cc) {
      const ccList = Array.isArray(message.cc) ? message.cc : [message.cc]
      ccList.forEach((c) => form.append('cc', c))
    }

    if (message.bcc) {
      const bccList = Array.isArray(message.bcc) ? message.bcc : [message.bcc]
      bccList.forEach((b) => form.append('bcc', b))
    }

    if (message.replyTo) form.append('h:Reply-To', message.replyTo)
    form.append('subject', message.subject)
    if (message.html) form.append('html', message.html)
    if (message.text) form.append('text', message.text)

    if (message.headers) {
      for (const [key, value] of Object.entries(message.headers)) {
        form.append(`h:${key}`, value)
      }
    }

    if (message.attachments?.length) {
      for (const a of message.attachments) {
        const bytes = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content)
        const blob = new Blob([bytes], a.contentType ? { type: a.contentType } : undefined)
        form.append('attachment', blob, a.filename)
      }
    }

    const credentials = Buffer.from(`api:${this.config.apiKey}`).toString('base64')

    const response = await fetch(`${this.apiBase}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body: form,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`[tekir/mail] Mailgun API error (${response.status}): ${truncate(error)}`)
    }
  }
}

/** Limit provider error bodies so they can't bloat or pollute logs. */
function truncate(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s
}
