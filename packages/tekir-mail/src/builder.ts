import type { MailMessage, MailAttachment, TemplateFn } from './types'
import type { Mail } from './manager'

// MailBuilder — fluent API

/**
 * Fluent email builder for composing and sending messages via a configured transport.
 * All header fields (from, to, cc, bcc, subject, custom headers) are automatically
 * sanitized against CRLF injection.
 *
 * @example
 * ```ts
 * await mail.send((msg) => {
 *   msg.from('noreply@app.com')
 *      .to(['user@example.com', 'admin@example.com'])
 *      .cc('manager@example.com')
 *      .subject('Welcome!')
 *      .html('<h1>Hello</h1>')
 *      .attach({ filename: 'report.pdf', content: pdfBuffer })
 *      .header('X-Priority', '1')
 * })
 * ```
 */
export class MailBuilder {
  private _from?: string
  private _to: string[] = []
  private _cc: string[] = []
  private _bcc: string[] = []
  private _replyTo?: string
  private _subject = ''
  private _html?: string
  private _text?: string
  private _attachments: MailAttachment[] = []
  private _headers: Record<string, string> = {}

  constructor(
    private readonly manager: Mail,
    private readonly transportName?: string
  ) {}

  private sanitizeHeader(value: string): string {
    return String(value).replace(/[\r\n]/g, '')
  }

  /**
   * Set the sender ("From") address for this email.
   *
   * @param address - Email address of the sender (e.g. `"noreply@app.com"`)
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.from('noreply@app.com')
   * ```
   */
  from(address: string): this {
    this._from = this.sanitizeHeader(address)
    return this
  }

  /**
   * Add one or more "To" recipients. Can be called multiple times to accumulate addresses.
   *
   * @param address - A single email address or an array of addresses
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.to('user@example.com')
   * msg.to(['alice@example.com', 'bob@example.com'])
   * ```
   */
  to(address: string | string[]): this {
    const list = Array.isArray(address) ? address : [address]
    this._to.push(...list.map(a => this.sanitizeHeader(a)))
    return this
  }

  /**
   * Add one or more "CC" (carbon copy) recipients.
   *
   * @param address - A single email address or an array of addresses
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.cc('manager@example.com')
   * ```
   */
  cc(address: string | string[]): this {
    const list = Array.isArray(address) ? address : [address]
    this._cc.push(...list.map(a => this.sanitizeHeader(a)))
    return this
  }

  /**
   * Add one or more "BCC" (blind carbon copy) recipients.
   *
   * @param address - A single email address or an array of addresses
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.bcc('audit@example.com')
   * ```
   */
  bcc(address: string | string[]): this {
    const list = Array.isArray(address) ? address : [address]
    this._bcc.push(...list.map(a => this.sanitizeHeader(a)))
    return this
  }

  /**
   * Set the "Reply-To" address for this email.
   *
   * @param address - The email address replies should be directed to
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.replyTo('support@example.com')
   * ```
   */
  replyTo(address: string): this {
    this._replyTo = this.sanitizeHeader(address)
    return this
  }

  /**
   * Set the email subject line.
   *
   * @param value - The subject text (CRLF characters are stripped automatically)
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.subject('Welcome to our platform!')
   * ```
   */
  subject(value: string): this {
    this._subject = this.sanitizeHeader(value)
    return this
  }

  /**
   * Set the HTML body of the email.
   *
   * @param content - Raw HTML string for the email body
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.html('<h1>Hello</h1><p>Welcome aboard.</p>')
   * ```
   */
  html(content: string): this {
    this._html = content
    return this
  }

  /**
   * Set the plain-text body of the email (used as fallback when HTML is not supported).
   *
   * @param content - Plain-text string for the email body
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.text('Hello! Welcome aboard.')
   * ```
   */
  text(content: string): this {
    this._text = content
    return this
  }

  /**
   * Add a file attachment to the email. Can be called multiple times for multiple attachments.
   *
   * @param attachment - Object containing filename, content (string or Buffer), and optional contentType/encoding
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.attach({ filename: 'report.pdf', content: pdfBuffer, contentType: 'application/pdf' })
   * ```
   */
  attach(attachment: MailAttachment): this {
    this._attachments.push(attachment)
    return this
  }

  /**
   * Add a custom MIME header to the email. CRLF characters are stripped from both key and value.
   *
   * @param key - Header name (e.g. `"X-Priority"`)
   * @param value - Header value
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * msg.header('X-Priority', '1')
   * msg.header('X-Mailer', 'Tekir Framework')
   * ```
   */
  header(key: string, value: string): this {
    this._headers[key.replace(/[\r\n]/g, '')] = String(value).replace(/[\r\n]/g, '')
    return this
  }

  /**
   * Render an HTML body from a template function and data object.
   * The template function receives `data` and must return an HTML string.
   *
   * @param fn - A function that accepts data and returns an HTML string
   * @param data - The data object passed to the template function
   * @returns The builder instance for chaining
   * @example
   * ```ts
   * const welcomeTemplate = (data: { name: string }) => `<h1>Hello ${data.name}</h1>`
   * msg.template(welcomeTemplate, { name: 'Alice' })
   * ```
   */
  template<T = Record<string, unknown>>(fn: TemplateFn<T>, data: T): this {
    this._html = fn(data)
    return this
  }

  private buildMessage(): MailMessage {
    if (this._to.length === 0) {
      throw new Error('[tekir/mail] At least one recipient (to) is required.')
    }
    if (!this._subject) {
      throw new Error('[tekir/mail] Email subject is required.')
    }

    return {
      from: this._from ?? this.manager.getDefaultFrom(),
      to: this._to.length === 1 ? this._to[0] : this._to,
      cc: this._cc.length > 0 ? (this._cc.length === 1 ? this._cc[0] : this._cc) : undefined,
      bcc: this._bcc.length > 0 ? (this._bcc.length === 1 ? this._bcc[0] : this._bcc) : undefined,
      replyTo: this._replyTo,
      subject: this._subject,
      html: this._html,
      text: this._text,
      attachments: this._attachments.length > 0 ? this._attachments : undefined,
      headers: Object.keys(this._headers).length > 0 ? this._headers : undefined,
    }
  }

  /**
   * Build the final message and send it through the configured transport.
   * Throws if no recipients or subject have been set.
   *
   * @returns A promise that resolves when the email has been handed off to the transport
   * @example
   * ```ts
   * await msg.from('noreply@app.com')
   *   .to('user@example.com')
   *   .subject('Hello')
   *   .html('<p>Hi!</p>')
   *   .send()
   * ```
   */
  async send(): Promise<void> {
    const message = this.buildMessage()
    await this.manager.dispatch(message, this.transportName)
  }
}
