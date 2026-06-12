import type { Transport, MailMessage, SentMail } from '../types'

// Fake (in-memory) Transport — testing

/**
 * In-memory transport used for testing. Captures all sent messages in the {@link sent} array
 * instead of delivering them, allowing assertions against email content.
 *
 * @example
 * ```ts
 * const transport = new FakeTransport()
 * await transport.send({ to: 'user@example.com', subject: 'Test', from: 'a@b.com' })
 * console.log(transport.sent.length) // 1
 * ```
 */
export class FakeTransport implements Transport {
  readonly name = 'fake'
  readonly sent: SentMail[] = []

  /**
   * Capture a mail message in the in-memory store instead of sending it.
   *
   * @param message - The mail message to capture
   * @returns A promise that resolves immediately
   */
  async send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message, transport: 'fake', sentAt: new Date() })
  }

  /**
   * Clear all captured messages from the in-memory store.
   */
  clear(): void {
    this.sent.length = 0
  }
}
