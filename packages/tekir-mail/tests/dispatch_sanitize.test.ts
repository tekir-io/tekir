import { test, expect, describe } from 'bun:test'
import { Mail } from '../src/manager'
import { sanitizeMessage, stripCrlf } from '../src/sanitize'
import { LogTransport } from '../src/transports/log'
import { SesTransport } from '../src/transports/ses'
import type { MailMessage, Transport } from '../src/types'

// A capturing transport so we can assert what reached the transport boundary
// after dispatch-level sanitization.
class CaptureTransport implements Transport {
  readonly name = 'capture'
  last?: MailMessage
  async send(message: MailMessage): Promise<void> { this.last = message }
}

describe('Mail.dispatch centralizes header sanitization (builder bypass closed)', () => {
  test('strips CRLF from a directly-dispatched MailMessage', async () => {
    const mail = new Mail()
    const capture = new CaptureTransport()
    mail.extend('capture', capture)

    // Bypass MailBuilder entirely with a hand-built, malicious message.
    await mail.dispatch(
      {
        from: 'noreply@app.com',
        to: 'victim@target.com\r\nBcc: attacker@evil.com',
        subject: 'Hi\r\nX-Injected: 1',
        headers: { 'X-Custom\r\nEvil': 'value\r\nmore' },
        attachments: [{ filename: 'a\r\n.pdf', content: 'x' }],
        html: '<p>body</p>',
      },
      'capture',
    )

    const m = capture.last!
    expect(m.to).toBe('victim@target.comBcc: attacker@evil.com')
    expect(m.subject).toBe('HiX-Injected: 1')
    expect(Object.keys(m.headers!)[0]).toBe('X-CustomEvil')
    expect(Object.values(m.headers!)[0]).toBe('valuemore')
    expect(m.attachments![0].filename).toBe('a.pdf')
    // Body is preserved untouched.
    expect(m.html).toBe('<p>body</p>')
  })

  test('sanitizes array recipients', () => {
    const out = sanitizeMessage({
      to: ['a@b.com\nBcc: x@y.com', 'c@d.com'],
      cc: 'cc@x.com\r\nEvil: 1',
      subject: 'ok',
    })
    expect(out.to).toEqual(['a@b.comBcc: x@y.com', 'c@d.com'])
    expect(out.cc).toBe('cc@x.comEvil: 1')
  })

  test('stripCrlf removes carriage returns and newlines', () => {
    expect(stripCrlf('a\r\nb\nc\rd')).toBe('abcd')
  })
})

describe('LogTransport redaction', () => {
  function fakeLogger() {
    const lines: string[] = []
    return {
      lines,
      info: (...a: any[]) => lines.push(a.join(' ')),
      debug: (...a: any[]) => lines.push(a.join(' ')),
    }
  }

  test('masks addresses and omits body by default (pretty)', async () => {
    const t = new LogTransport({ pretty: true })
    const logger = fakeLogger()
    t.setLogger(logger)
    await t.send({ from: 'noreply@app.com', to: 'alice@example.com', subject: 'Reset', html: 'token=SECRET123' })
    const joined = logger.lines.join('\n')
    expect(joined).not.toContain('alice@example.com')
    expect(joined).toContain('a***@example.com')
    expect(joined).not.toContain('SECRET123')
  })

  test('non-pretty mode logs metadata only by default', async () => {
    const t = new LogTransport({ pretty: false })
    const logger = fakeLogger()
    t.setLogger(logger)
    await t.send({ to: 'bob@example.com', subject: 's', html: 'magic-link=abc' })
    const joined = logger.lines.join('\n')
    expect(joined).not.toContain('magic-link=abc')
    expect(joined).toContain('"hasHtml":true')
  })

  test('redact:false logs full content (opt-in)', async () => {
    const t = new LogTransport({ pretty: true, redact: false })
    const logger = fakeLogger()
    t.setLogger(logger)
    await t.send({ from: 'a@b.com', to: 'alice@example.com', subject: 's', html: 'TOKEN' })
    const joined = logger.lines.join('\n')
    expect(joined).toContain('alice@example.com')
    expect(joined).toContain('TOKEN')
  })
})

describe('SesTransport SigV4 helpers', () => {
  test('amzDate produces deterministic YYYYMMDDTHHMMSSZ', () => {
    // 2026-06-13T04:05:06.123Z
    const d = new Date(Date.UTC(2026, 5, 13, 4, 5, 6, 123))
    expect(SesTransport.amzDate(d)).toBe('20260613T040506Z')
  })

  test('amzDate has no milliseconds even at .000', () => {
    const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    expect(SesTransport.amzDate(d)).toBe('20260101T000000Z')
  })

  test('canonicalQuery sorts and encodes params', () => {
    const p = new URLSearchParams()
    p.append('b', '2')
    p.append('a', 'hello world')
    expect(SesTransport.canonicalQuery(p)).toBe('a=hello%20world&b=2')
  })

  test('canonicalQuery is empty for no params', () => {
    expect(SesTransport.canonicalQuery(new URLSearchParams())).toBe('')
  })
})
