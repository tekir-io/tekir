import type { Transport, MailMessage, LogConfig } from '../types'

// Log/JSON Transport (dev mode) — uses framework logger if available, console otherwise

let _logger: any = null

/**
 * Development/debug transport that logs email messages to the console or a framework logger
 * instead of delivering them. Supports pretty-printed and JSON output modes.
 *
 * @example
 * ```ts
 * const transport = new LogTransport({ pretty: true })
 * await transport.send({ to: 'user@example.com', subject: 'Test', from: 'a@b.com' })
 * // [mail] From: a@b.com | To: user@example.com | Subject: Test
 * ```
 */
export class LogTransport implements Transport {
  readonly name = 'log'

  constructor(private config: LogConfig = {}) {}

  /**
   * Set a custom logger instance (e.g. the framework logger). Falls back to `console`.
   *
   * @param logger - Any object with an `info` method (and optionally `debug`)
   */
  setLogger(logger: any) { _logger = logger }

  private get log() { return _logger || console }

  /** Redaction is on unless explicitly disabled. */
  private get redacting(): boolean { return this.config.redact !== false }

  /** Mask the local part of an address so it is identifiable but not exposed (a***@example.com). */
  private maskAddress(addr: string): string {
    const at = addr.lastIndexOf('@')
    if (at <= 0) return '***'
    const local = addr.slice(0, at)
    const domain = addr.slice(at)
    return `${local[0]}***${domain}`
  }

  private maskList(value: string | string[] | undefined): string | null {
    if (!value) return null
    const list = Array.isArray(value) ? value : [value]
    return list.map((a) => (this.redacting ? this.maskAddress(a) : a)).join(', ')
  }

  /**
   * Log the mail message to the configured logger.
   *
   * By default, recipient addresses are masked and message bodies are omitted so
   * password-reset tokens, magic links and PII never reach the logs. Set
   * `redact: false` to log full content (development only).
   *
   * @param message - The mail message to log
   * @returns A promise that resolves once logging is complete
   */
  async send(message: MailMessage): Promise<void> {
    if (this.config.pretty !== false) {
      const from = this.redacting && message.from ? this.maskAddress(message.from) : (message.from ?? '(not set)')
      const to = this.maskList(message.to)
      const cc = this.maskList(message.cc)
      const bcc = this.maskList(message.bcc)
      let output = `[mail] From: ${from} | To: ${to} | Subject: ${message.subject}`
      if (cc) output += ` | CC: ${cc}`
      if (bcc) output += ` | BCC: ${bcc}`
      this.log.info(output)
      if (!this.redacting) {
        if (message.text) this.log.debug?.(`[mail] Text: ${message.text}`)
        if (message.html) this.log.debug?.(`[mail] HTML: ${message.html}`)
      }
    } else if (this.redacting) {
      // Metadata only — never serialize bodies/attachments which may carry PII.
      this.log.info('[mail]', JSON.stringify({
        from: message.from ? this.maskAddress(message.from) : undefined,
        to: this.maskList(message.to),
        cc: this.maskList(message.cc),
        bcc: this.maskList(message.bcc),
        subject: message.subject,
        hasHtml: !!message.html,
        hasText: !!message.text,
        attachments: message.attachments?.length ?? 0,
      }))
    } else {
      this.log.info('[mail]', JSON.stringify(message))
    }
  }
}
