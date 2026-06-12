import type { MailConfig, MailMessage, Transport, SentMail } from './types'
import { SmtpTransport } from './transports/smtp'
import { SevkTransport } from './transports/sevk'
import { ResendTransport } from './transports/resend'
import { MailgunTransport } from './transports/mailgun'
import { SesTransport } from './transports/ses'
import { LogTransport } from './transports/log'
import { FakeTransport } from './transports/fake'
import { MailBuilder } from './builder'
import { sanitizeMessage } from './sanitize'

// Mail — core class

/**
 * Core mail manager responsible for transport registration, dispatch, and testing utilities.
 * Supports multiple transports (SMTP, Resend, Mailgun, SES, Sevk, Log) and provides
 * a fluent API via {@link MailBuilder} for composing emails.
 *
 * @example
 * ```ts
 * const mail = new Mail({ default: 'smtp', from: 'noreply@app.com', transports: { smtp: { host: 'localhost', port: 587 } } })
 * await mail.to('user@example.com').subject('Hi').html('<p>Hello</p>').send()
 * ```
 */
export class Mail {
  private config: MailConfig
  private transports: Map<string, Transport> = new Map()
  private fakeTransport: FakeTransport | null = null
  private isFaking = false

  constructor(config: MailConfig = {}) {
    this.config = config
    this.registerBuiltins()
  }

  private registerBuiltins(): void {
    const t = this.config.transports ?? {}

    if (t.smtp) {
      // Verify nodemailer is available at boot time, not at first send
      try {
        require.resolve('nodemailer')
      } catch {
        throw new Error(
          '[tekir/mail] SMTP transport is configured but nodemailer is not installed. ' +
          'Run: bun add nodemailer'
        )
      }
      this.transports.set('smtp', new SmtpTransport(t.smtp))
    }
    if (t.sevk) {
      this.transports.set('sevk', new SevkTransport(t.sevk))
    }
    if (t.resend) {
      this.transports.set('resend', new ResendTransport(t.resend))
    }
    if (t.mailgun) {
      this.transports.set('mailgun', new MailgunTransport(t.mailgun))
    }
    if (t.ses) {
      this.transports.set('ses', new SesTransport(t.ses))
    }

    // Log transport is always available as a fallback
    this.transports.set('log', new LogTransport(t.log ?? {}))
  }

  /**
   * Register a custom transport under a given name.
   *
   * @param name - Unique name for the transport (e.g. `"postmark"`)
   * @param transport - An object implementing the {@link Transport} interface
   * @returns The Mail instance for chaining
   * @example
   * ```ts
   * mail.extend('postmark', new PostmarkTransport({ apiKey: '...' }))
   * ```
   */
  extend(name: string, transport: Transport): this {
    this.transports.set(name, transport)
    return this
  }

  /**
   * Merge new configuration and re-register all built-in transports.
   *
   * @param config - Partial mail configuration to merge with the existing config
   * @returns The Mail instance for chaining
   */
  configure(config: MailConfig): this {
    this.config = { ...this.config, ...config }
    this.transports.clear()
    this.registerBuiltins()
    return this
  }

  /**
   * Return the global default "from" address configured for this mail instance.
   *
   * @returns The default sender address, or `undefined` if not configured
   */
  getDefaultFrom(): string | undefined {
    return this.config.from
  }

  private resolveTransport(name?: string): Transport {
    if (this.isFaking && this.fakeTransport) {
      return this.fakeTransport
    }

    const targetName = name ?? this.config.default ?? 'log'
    const transport = this.transports.get(targetName)

    if (!transport) {
      throw new Error(
        `[tekir/mail] Transport "${targetName}" is not registered. ` +
          `Available transports: ${[...this.transports.keys()].join(', ')}`
      )
    }

    return transport
  }

  /**
   * Send a pre-built mail message through the specified (or default) transport.
   * In fake mode, the message is captured in-memory instead of being sent.
   *
   * @param message - The fully constructed {@link MailMessage} object
   * @param transportName - Optional transport name override; falls back to the configured default
   * @returns A promise that resolves when the transport finishes sending
   */
  async dispatch(message: MailMessage, transportName?: string): Promise<void> {
    const transport = this.resolveTransport(transportName)
    // Centralized CRLF header sanitization at the dispatch boundary. This covers
    // every path into a transport, including direct dispatch() calls and the
    // notification mail channel, so header-injection protection no longer relies
    // solely on MailBuilder.
    await transport.send(sanitizeMessage(message))
  }

  // Fluent entry points

  /**
   * Create a new {@link MailBuilder} that sends through the specified transport.
   *
   * @param transportName - Name of a registered transport (e.g. `"smtp"`, `"resend"`)
   * @returns A new fluent MailBuilder instance
   * @example
   * ```ts
   * await mail.use('resend').to('user@example.com').subject('Hi').html('<p>Hello</p>').send()
   * ```
   */
  use(transportName: string): MailBuilder {
    return new MailBuilder(this, transportName)
  }

  /**
   * Shorthand to create a new {@link MailBuilder} with recipients already set.
   *
   * @param address - A single email address or an array of addresses
   * @returns A new fluent MailBuilder instance with recipients pre-configured
   * @example
   * ```ts
   * await mail.to('user@example.com').subject('Hi').html('<p>Hello</p>').send()
   * ```
   */
  to(address: string | string[]): MailBuilder {
    return new MailBuilder(this).to(address)
  }

  // Fake / testing API

  /**
   * Enable fake mode for testing. All subsequent sends are captured in-memory
   * instead of being dispatched to a real transport.
   *
   * @returns The Mail instance for chaining
   * @example
   * ```ts
   * mail.fake()
   * await mail.to('user@example.com').subject('Test').html('<p>Hi</p>').send()
   * mail.assertSent((m) => m.subject === 'Test')
   * mail.restore()
   * ```
   */
  fake(): this {
    this.fakeTransport = new FakeTransport()
    this.isFaking = true
    return this
  }

  /**
   * Disable fake mode and discard captured messages, restoring normal transport dispatch.
   *
   * @returns The Mail instance for chaining
   */
  restore(): this {
    this.isFaking = false
    this.fakeTransport = null
    return this
  }

  /**
   * Access the list of emails captured during fake mode.
   *
   * @returns Array of sent mail objects, or an empty array if not faking
   */
  get sent(): SentMail[] {
    return this.fakeTransport?.sent ?? []
  }

  /**
   * Assert that at least one email was sent during fake mode, optionally matching a predicate.
   * Throws if fake mode is not active, no emails were sent, or no email matches the predicate.
   *
   * @param predicate - Optional function to match against captured emails
   * @param message - Optional custom error message
   * @example
   * ```ts
   * mail.assertSent((m) => m.subject === 'Welcome')
   * ```
   */
  assertSent(
    predicate?: (mail: SentMail) => boolean,
    message?: string
  ): void {
    if (!this.isFaking || !this.fakeTransport) {
      throw new Error('[tekir/mail] assertSent() requires fake mode. Call mail.fake() first.')
    }

    if (this.fakeTransport.sent.length === 0) {
      throw new Error(message ?? '[tekir/mail] Expected at least one email to be sent, but none were.')
    }

    if (predicate) {
      const match = this.fakeTransport.sent.some(predicate)
      if (!match) {
        throw new Error(
          message ?? '[tekir/mail] No sent email matched the given predicate.'
        )
      }
    }
  }

  /**
   * Assert that no email matching the predicate was sent during fake mode.
   * When called without a predicate, asserts that no emails were sent at all.
   *
   * @param predicate - Optional function to match against captured emails
   * @param message - Optional custom error message
   * @example
   * ```ts
   * mail.assertNotSent((m) => m.subject === 'Spam')
   * ```
   */
  assertNotSent(predicate?: (mail: SentMail) => boolean, message?: string): void {
    if (!this.isFaking || !this.fakeTransport) {
      throw new Error('[tekir/mail] assertNotSent() requires fake mode. Call mail.fake() first.')
    }

    if (!predicate && this.fakeTransport.sent.length > 0) {
      throw new Error(
        message ?? `[tekir/mail] Expected no emails to be sent, but ${this.fakeTransport.sent.length} were.`
      )
    }

    if (predicate) {
      const match = this.fakeTransport.sent.some(predicate)
      if (match) {
        throw new Error(
          message ?? '[tekir/mail] An email matching the predicate was sent, but none was expected.'
        )
      }
    }
  }

  /**
   * Assert that exactly `count` emails were sent during fake mode.
   *
   * @param count - Expected number of sent emails
   * @param message - Optional custom error message
   * @example
   * ```ts
   * mail.assertSentCount(2)
   * ```
   */
  assertSentCount(count: number, message?: string): void {
    if (!this.isFaking || !this.fakeTransport) {
      throw new Error('[tekir/mail] assertSentCount() requires fake mode. Call mail.fake() first.')
    }

    const actual = this.fakeTransport.sent.length
    if (actual !== count) {
      throw new Error(
        message ?? `[tekir/mail] Expected ${count} email(s) to be sent, but got ${actual}.`
      )
    }
  }

  /**
   * Clear all captured emails from the fake transport's in-memory store.
   */
  clearSent(): void {
    this.fakeTransport?.clear()
  }
}
