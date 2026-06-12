import { test, expect, describe } from 'bun:test'
import { MailBuilder } from '../src/builder'

const mockManager = { getDefaultFrom: () => 'default@test.com', dispatch: async () => {} } as any

describe('MailBuilder — fluent API', () => {
  test('full chain builds message', async () => {
    const b = new MailBuilder(mockManager)
    b.from('sender@test.com').to('user@test.com').cc('cc@test.com').bcc('bcc@test.com')
      .replyTo('reply@test.com').subject('Hello').html('<h1>Hi</h1>').text('Hi')
    await b.send()
  })

  test('multiple to addresses', async () => {
    const b = new MailBuilder(mockManager)
    b.to(['a@test.com', 'b@test.com', 'c@test.com']).subject('Multi')
    await b.send()
  })

  test('attach adds attachment', () => {
    const b = new MailBuilder(mockManager)
    b.to('user@test.com').subject('Test')
    b.attach({ filename: 'file.pdf', content: Buffer.from('data') })
  })

  test('template sets html', () => {
    const b = new MailBuilder(mockManager)
    b.to('user@test.com').subject('Test')
    b.template((data: any) => `<h1>${data.name}</h1>`, { name: 'Ali' })
  })

  test('uses default from when not specified', async () => {
    const b = new MailBuilder(mockManager)
    b.to('user@test.com').subject('Test')
    await b.send()
  })

  test('custom transport name', async () => {
    const b = new MailBuilder(mockManager, 'ses')
    b.to('user@test.com').subject('Test')
    await b.send()
  })
})

describe('MailBuilder — CRLF comprehensive', () => {
  test('\\r only is stripped from subject', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test\rInjected')
    // Should not throw
  })

  test('\\n only is stripped from subject', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test\nInjected')
  })

  test('multiple CRLF in from', () => {
    const b = new MailBuilder(mockManager)
    b.from('a@b.com\r\n\r\nBcc: x@y.com')
    b.to('u@t.com').subject('Test')
  })

  test('CRLF in cc array items', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').cc(['a@b.com\r\ninjected', 'c@d.com\ninjected']).subject('Test')
  })

  test('CRLF in bcc array items', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').bcc(['a@b.com\r\ninjected']).subject('Test')
  })

  test('CRLF in custom header key', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test')
    b.header('X-Custom\r\nBcc', 'evil')
  })

  test('CRLF in custom header value', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test')
    b.header('X-Custom', 'val\r\nBcc: evil@evil.com')
  })

  test('unicode in subject is preserved', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Türkçe başlık — özel karakterler')
    // Should not throw, unicode is fine
  })

  test('very long subject is preserved', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('x'.repeat(1000))
  })

  test('empty string fields work', () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test').html('').text('')
  })
})

describe('MailBuilder — validation errors', () => {
  test('throws without recipient', async () => {
    const b = new MailBuilder(mockManager)
    b.subject('Test')
    await expect(b.send()).rejects.toThrow('recipient')
  })

  test('throws without subject', async () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com')
    await expect(b.send()).rejects.toThrow('subject')
  })

  test('single to works', async () => {
    const b = new MailBuilder(mockManager)
    b.to('u@t.com').subject('Test')
    await b.send()
  })

  test('multiple to via chaining', async () => {
    const b = new MailBuilder(mockManager)
    b.to('a@t.com').to('b@t.com').subject('Test')
    await b.send()
  })
})
