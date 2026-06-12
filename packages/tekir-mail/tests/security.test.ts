import { test, expect, describe } from 'bun:test'
import { MailBuilder } from '../src/builder'

// Mock mail manager
const mockManager = {
  getDefaultFrom: () => 'default@test.com',
  dispatch: async () => {},
} as any

// ═══════════════════════════════════════════════════════════
// Email header injection — CRLF prevention
// ═══════════════════════════════════════════════════════════

describe('MailBuilder — CRLF injection in from', () => {
  test('strips \\n from from address', () => {
    const builder = new MailBuilder(mockManager)
    builder.from('attacker@evil.com\nBcc: victim@target.com')
    builder.to('user@test.com').subject('Test')
    // Should not throw, CRLF stripped internally
  })

  test('strips \\r\\n from from address', () => {
    const builder = new MailBuilder(mockManager)
    builder.from('test@test.com\r\nBcc: hacker@evil.com')
    builder.to('user@test.com').subject('Test')
  })

  test('normal from address works', () => {
    const builder = new MailBuilder(mockManager)
    builder.from('valid@example.com')
    builder.to('user@test.com').subject('Test')
  })
})

describe('MailBuilder — CRLF injection in to', () => {
  test('strips \\n from to address', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('victim@target.com\nBcc: spy@evil.com')
    builder.subject('Test')
  })

  test('strips \\r\\n from to array', () => {
    const builder = new MailBuilder(mockManager)
    builder.to(['user1@test.com', 'user2@test.com\r\nBcc: spy@evil.com'])
    builder.subject('Test')
  })

  test('multiple to addresses work normally', () => {
    const builder = new MailBuilder(mockManager)
    builder.to(['a@test.com', 'b@test.com', 'c@test.com'])
    builder.subject('Test')
  })
})

describe('MailBuilder — CRLF injection in cc/bcc', () => {
  test('strips \\n from cc', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').cc('cc@test.com\nBcc: spy@evil.com').subject('Test')
  })

  test('strips \\n from bcc', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').bcc('bcc@test.com\nTo: extra@evil.com').subject('Test')
  })

  test('strips from cc array', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').cc(['cc1@test.com\r\ninjected', 'cc2@test.com']).subject('Test')
  })

  test('strips from bcc array', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').bcc(['bcc1@test.com', 'bcc2@test.com\r\ninjected']).subject('Test')
  })
})

describe('MailBuilder — CRLF injection in replyTo', () => {
  test('strips \\n from replyTo', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').replyTo('reply@test.com\nBcc: spy@evil.com').subject('Test')
  })

  test('strips \\r\\n from replyTo', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').replyTo('reply@test.com\r\nX-Injected: true').subject('Test')
  })
})

describe('MailBuilder — CRLF injection in subject', () => {
  test('strips \\n from subject', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Hello\nBcc: spy@evil.com')
  })

  test('strips \\r\\n from subject', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test\r\nContent-Type: text/html')
  })

  test('normal subject works', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Welcome to our platform!')
  })

  test('subject with special characters works', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Re: Ürünleriniz hakkında — önemli bilgi')
  })
})

describe('MailBuilder — CRLF injection in custom headers', () => {
  test('strips \\n from header key', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test')
    builder.header('X-Custom\nBcc', 'value')
  })

  test('strips \\n from header value', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test')
    builder.header('X-Custom', 'value\nBcc: spy@evil.com')
  })

  test('strips \\r\\n from both key and value', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test')
    builder.header('X-Test\r\nEvil', 'data\r\nBcc: spy@evil.com')
  })

  test('normal header works', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test')
    builder.header('X-Mailer', 'Tekir Framework')
    builder.header('X-Priority', '1')
  })

  test('multiple headers work', () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test')
    builder.header('X-Custom-1', 'value1')
    builder.header('X-Custom-2', 'value2')
    builder.header('X-Custom-3', 'value3')
  })
})

describe('MailBuilder — validation', () => {
  test('throws without recipient', async () => {
    const builder = new MailBuilder(mockManager)
    builder.subject('Test')
    await expect(builder.send()).rejects.toThrow('At least one recipient')
  })

  test('throws without subject', async () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com')
    await expect(builder.send()).rejects.toThrow('subject is required')
  })

  test('send works with valid data', async () => {
    const builder = new MailBuilder(mockManager)
    builder.to('user@test.com').subject('Test').text('Hello')
    await builder.send() // should not throw
  })
})
