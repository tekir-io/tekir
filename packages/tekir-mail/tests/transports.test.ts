import { afterEach, describe, expect, test } from 'bun:test'
import { ResendTransport } from '../src/transports/resend'
import { MailgunTransport } from '../src/transports/mailgun'
import { SevkTransport } from '../src/transports/sevk'
import { SesTransport } from '../src/transports/ses'
import { SmtpTransport } from '../src/transports/smtp'
import type { MailMessage } from '../src/types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const message: MailMessage = {
  from: 'from@example.com',
  to: ['one@example.com', 'two@example.com'],
  cc: 'cc@example.com',
  bcc: 'bcc@example.com',
  replyTo: 'reply@example.com',
  subject: 'Subject',
  html: '<b>Hello</b>',
  text: 'Hello',
  headers: { 'X-Test': 'yes' },
  attachments: [{ filename: 'note.txt', content: Buffer.from('note'), contentType: 'text/plain' }],
}

describe('HTTP mail transports', () => {
  test('Resend builds the expected authenticated JSON request', async () => {
    let request: any
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init, body: JSON.parse(String(init?.body)) }
      return new Response('{}')
    }) as typeof fetch

    await new ResendTransport({ apiKey: 're_secret', baseUrl: 'https://resend.test/' }).send(message)
    expect(request.url).toBe('https://resend.test/emails')
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer re_secret')
    expect(request.body.to).toEqual(['one@example.com', 'two@example.com'])
    expect(request.body.reply_to).toBe('reply@example.com')
    expect(request.body.attachments[0]).toEqual({ filename: 'note.txt', content: 'bm90ZQ==' })
  })

  test('Resend surfaces bounded provider errors', async () => {
    globalThis.fetch = (async () => new Response('x'.repeat(1000), { status: 429 })) as unknown as typeof fetch
    await expect(new ResendTransport({ apiKey: 'k' }).send(message))
      .rejects.toThrow(/Resend API error \(429\).*truncated/)
  })

  test('Mailgun sends multipart fields, attachments, and Basic auth', async () => {
    let request: any
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init }
      return new Response('{}')
    }) as typeof fetch

    await new MailgunTransport({ apiKey: 'key-secret', domain: 'mg.example.com', region: 'eu' }).send(message)
    expect(request.url).toBe('https://api.eu.mailgun.net/v3/mg.example.com/messages')
    expect(new Headers(request.init.headers).get('authorization'))
      .toBe(`Basic ${Buffer.from('api:key-secret').toString('base64')}`)
    const form = request.init.body as FormData
    expect(form.getAll('to')).toEqual(['one@example.com', 'two@example.com'])
    expect(form.get('h:Reply-To')).toBe('reply@example.com')
    expect(form.get('h:X-Test')).toBe('yes')
    const attachment = form.get('attachment') as File
    expect(attachment.name).toBe('note.txt')
    expect(await attachment.text()).toBe('note')
  })

  test('Sevk sends optional fields and base64 attachments', async () => {
    let body: any
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response('{}')
    }) as typeof fetch

    await new SevkTransport({ apiKey: 'secret', baseUrl: 'https://sevk.test' }).send(message)
    expect(body.to).toEqual(['one@example.com', 'two@example.com'])
    expect(body.cc).toEqual(['cc@example.com'])
    expect(body.reply_to).toBe('reply@example.com')
    expect(body.attachments[0].content).toBe('bm90ZQ==')
    expect(body.attachments[0].contentType).toBe('text/plain')
  })

  test('SES signs and sends the expected form payload', async () => {
    let request: any
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init }
      return new Response('<ok/>')
    }) as typeof fetch

    await new SesTransport({
      accessKeyId: 'AKID', secretAccessKey: 'secret', region: 'eu-central-1',
    }).send(message)
    expect(request.url).toBe('https://email.eu-central-1.amazonaws.com/')
    const headers = new Headers(request.init.headers)
    expect(headers.get('authorization')).toContain('Credential=AKID/')
    expect(headers.get('authorization')).toContain('/eu-central-1/ses/aws4_request')
    const params = new URLSearchParams(String(request.init.body))
    expect(params.get('Action')).toBe('SendEmail')
    expect(params.getAll('Destination.ToAddresses.member.1')).toEqual(['one@example.com'])
    expect(params.get('Destination.ToAddresses.member.2')).toBe('two@example.com')
    expect(params.get('Message.Subject.Data')).toBe('Subject')
  })
})

describe('SMTP optional dependency', () => {
  test('fails with an actionable error when nodemailer is not installed', async () => {
    const smtp = new SmtpTransport({ host: 'smtp.example.com' })
    await expect(smtp.send(message)).rejects.toThrow('bun add nodemailer')
  })
})
