import { test, expect, describe, beforeEach } from 'bun:test'
import { App } from '@tekir/core'
import {
  Mail,
  MailBuilder,
  MailProvider,
  BaseMail,
  type MailMessage,
  type SentMail,
  type Transport,
} from '../src/index'

// Helpers

function makeFakeMail(): Mail {
  const mail = new Mail()
  mail.fake()
  return mail
}

// fake() mode — basic send

describe('Mail.fake — basic send', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('send via fluent builder does not throw in fake mode', async () => {
    await expect(
      mail.to('alice@example.com').subject('Hello').text('Hi').send()
    ).resolves.toBeUndefined()
  })

  test('sent[] contains the message after send', async () => {
    await mail.to('bob@example.com').subject('Test').text('body').send()
    expect(mail.sent).toHaveLength(1)
  })

  test('sent[] contains correct to address', async () => {
    await mail.to('carol@example.com').subject('Greet').text('hi').send()
    expect(mail.sent[0].to).toBe('carol@example.com')
  })

  test('sent[] contains correct subject', async () => {
    await mail.to('a@b.com').subject('My Subject').text('x').send()
    expect(mail.sent[0].subject).toBe('My Subject')
  })

  test('sent[] entry has transport = "fake"', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(mail.sent[0].transport).toBe('fake')
  })

  test('sent[] entry has a sentAt Date', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(mail.sent[0].sentAt).toBeInstanceOf(Date)
  })

  test('multiple sends accumulate in sent[]', async () => {
    await mail.to('a@b.com').subject('1').text('a').send()
    await mail.to('b@c.com').subject('2').text('b').send()
    await mail.to('c@d.com').subject('3').text('c').send()
    expect(mail.sent).toHaveLength(3)
  })
})

// assertSent

describe('Mail.assertSent', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('assertSent does not throw when at least one mail was sent', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() => mail.assertSent()).not.toThrow()
  })

  test('assertSent throws when no mail was sent', () => {
    expect(() => mail.assertSent()).toThrow('Expected at least one email')
  })

  test('assertSent with matching predicate does not throw', async () => {
    await mail.to('target@example.com').subject('special').text('body').send()
    expect(() =>
      mail.assertSent(m => m.to === 'target@example.com')
    ).not.toThrow()
  })

  test('assertSent with non-matching predicate throws', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() =>
      mail.assertSent(m => m.to === 'nobody@example.com')
    ).toThrow('No sent email matched')
  })

  test('assertSent with custom message uses it in error', () => {
    expect(() => mail.assertSent(undefined, 'custom error text')).toThrow('custom error text')
  })

  test('assertSent throws when not in fake mode', () => {
    const realMail = new Mail()
    expect(() => realMail.assertSent()).toThrow('requires fake mode')
  })
})

// assertNotSent

describe('Mail.assertNotSent', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('assertNotSent does not throw when nothing was sent', () => {
    expect(() => mail.assertNotSent()).not.toThrow()
  })

  test('assertNotSent throws when emails were sent', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() => mail.assertNotSent()).toThrow('Expected no emails')
  })

  test('assertNotSent with predicate — does not throw when predicate never matches', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() =>
      mail.assertNotSent(m => m.to === 'nobody@nope.com')
    ).not.toThrow()
  })

  test('assertNotSent with predicate — throws when predicate matches', async () => {
    await mail.to('x@y.com').subject('s').text('t').send()
    expect(() =>
      mail.assertNotSent(m => m.to === 'x@y.com')
    ).toThrow('matching the predicate was sent')
  })

  test('assertNotSent throws when not in fake mode', () => {
    const realMail = new Mail()
    expect(() => realMail.assertNotSent()).toThrow('requires fake mode')
  })
})

// assertSentCount

describe('Mail.assertSentCount', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('assertSentCount(0) passes when nothing sent', () => {
    expect(() => mail.assertSentCount(0)).not.toThrow()
  })

  test('assertSentCount(n) passes when exactly n mails sent', async () => {
    await mail.to('a@b.com').subject('1').text('a').send()
    await mail.to('b@c.com').subject('2').text('b').send()
    expect(() => mail.assertSentCount(2)).not.toThrow()
  })

  test('assertSentCount throws when count does not match', async () => {
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() => mail.assertSentCount(3)).toThrow('Expected 3 email(s)')
  })

  test('assertSentCount throws when not in fake mode', () => {
    const realMail = new Mail()
    expect(() => realMail.assertSentCount(0)).toThrow('requires fake mode')
  })
})

// clearSent

describe('Mail.clearSent', () => {
  test('clearSent empties the sent list', async () => {
    const mail = makeFakeMail()
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(mail.sent).toHaveLength(1)
    mail.clearSent()
    expect(mail.sent).toHaveLength(0)
  })

  test('clearSent is safe to call when nothing has been sent', () => {
    const mail = makeFakeMail()
    expect(() => mail.clearSent()).not.toThrow()
  })
})

// restore()

describe('Mail.restore', () => {
  test('restore() exits fake mode', () => {
    const mail = new Mail()
    mail.fake()
    mail.restore()
    // After restore, assertSent should fail with "requires fake mode"
    expect(() => mail.assertSent()).toThrow('requires fake mode')
  })

  test('sent[] returns [] after restore()', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('s').text('t').send()
    mail.restore()
    expect(mail.sent).toHaveLength(0)
  })
})

// Fluent builder API — MailBuilder

describe('MailBuilder — fluent API', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
    mail.configure({ from: 'noreply@app.com' })
  })

  test('from() sets the sender address', async () => {
    await mail.to('r@r.com').from('sender@app.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('sender@app.com')
  })

  test('to() with single string', async () => {
    await mail.to('one@test.com').subject('s').text('t').send()
    expect(mail.sent[0].to).toBe('one@test.com')
  })

  test('to() with array produces array in message when multiple', async () => {
    await mail.to(['a@t.com', 'b@t.com']).subject('s').text('t').send()
    expect(Array.isArray(mail.sent[0].to)).toBe(true)
    expect(mail.sent[0].to).toContain('a@t.com')
    expect(mail.sent[0].to).toContain('b@t.com')
  })

  test('chained to() calls accumulate recipients', async () => {
    await mail.to('a@t.com').to('b@t.com').subject('s').text('t').send()
    const to = mail.sent[0].to
    expect(Array.isArray(to)).toBe(true)
    expect((to as string[]).length).toBe(2)
  })

  test('cc() sets CC addresses', async () => {
    await mail.to('a@t.com').cc('cc@t.com').subject('s').text('t').send()
    expect(mail.sent[0].cc).toBe('cc@t.com')
  })

  test('bcc() sets BCC addresses', async () => {
    await mail.to('a@t.com').bcc('bcc@t.com').subject('s').text('t').send()
    expect(mail.sent[0].bcc).toBe('bcc@t.com')
  })

  test('replyTo() sets replyTo', async () => {
    await mail.to('a@t.com').subject('s').text('t').replyTo('reply@t.com').send()
    expect(mail.sent[0].replyTo).toBe('reply@t.com')
  })

  test('html() sets the html body', async () => {
    await mail.to('a@t.com').subject('s').html('<b>bold</b>').send()
    expect(mail.sent[0].html).toBe('<b>bold</b>')
  })

  test('text() sets the plain text body', async () => {
    await mail.to('a@t.com').subject('s').text('plain text').send()
    expect(mail.sent[0].text).toBe('plain text')
  })

  test('attach() adds an attachment', async () => {
    await mail
      .to('a@t.com')
      .subject('s')
      .text('t')
      .attach({ filename: 'file.txt', content: 'hello', contentType: 'text/plain' })
      .send()
    expect(mail.sent[0].attachments).toHaveLength(1)
    expect(mail.sent[0].attachments![0].filename).toBe('file.txt')
  })

  test('header() adds a custom header', async () => {
    await mail
      .to('a@t.com')
      .subject('s')
      .text('t')
      .header('X-Custom', 'value')
      .send()
    expect(mail.sent[0].headers?.['X-Custom']).toBe('value')
  })

  test('template() sets html via function', async () => {
    const tmpl = (data: { name: string }) => `<h1>Hello ${data.name}</h1>`
    await mail.to('a@t.com').subject('s').template(tmpl, { name: 'World' }).send()
    expect(mail.sent[0].html).toBe('<h1>Hello World</h1>')
  })

  test('send() throws when no recipient provided', async () => {
    const builder = new MailBuilder(mail)
    builder.subject('no-to')
    await expect(builder.send()).rejects.toThrow('At least one recipient')
  })

  test('send() throws when no subject provided', async () => {
    const builder = new MailBuilder(mail)
    builder.to('a@t.com')
    await expect(builder.send()).rejects.toThrow('subject is required')
  })

  test('default from is used when not explicitly set', async () => {
    // mail is configured with from: 'noreply@app.com' in beforeEach
    await mail.to('a@t.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('noreply@app.com')
  })

  test('no attachments field when none added', async () => {
    await mail.to('a@t.com').subject('s').text('t').send()
    expect(mail.sent[0].attachments).toBeUndefined()
  })

  test('no headers field when none added', async () => {
    await mail.to('a@t.com').subject('s').text('t').send()
    expect(mail.sent[0].headers).toBeUndefined()
  })

  test('no cc field when none added', async () => {
    await mail.to('a@t.com').subject('s').text('t').send()
    expect(mail.sent[0].cc).toBeUndefined()
  })

  test('no bcc field when none added', async () => {
    await mail.to('a@t.com').subject('s').text('t').send()
    expect(mail.sent[0].bcc).toBeUndefined()
  })
})

// use() — named transport selection

describe('Mail.use()', () => {
  test('use() in fake mode still routes through fake transport', async () => {
    const mail = makeFakeMail()
    await mail.use('log').to('a@b.com').subject('s').text('t').send()
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].transport).toBe('fake')
  })
})

// extend() — custom transport

describe('Mail.extend', () => {
  test('custom transport receives the message', async () => {
    const mail = new Mail()
    const received: MailMessage[] = []

    const custom: Transport = {
      name: 'custom',
      async send(msg) { received.push(msg) },
    }

    mail.extend('custom', custom)
    await mail.use('custom').to('a@b.com').subject('Test').text('hi').send()

    expect(received).toHaveLength(1)
    expect(received[0].subject).toBe('Test')
  })

  test('extend() throws when transport name not found and not in fake mode', async () => {
    const mail = new Mail()
    await expect(mail.use('nonexistent').to('a@b.com').subject('s').text('t').send()).rejects.toThrow()
  })
})

// configure()

describe('Mail.configure', () => {
  test('configure() sets the default from', async () => {
    const mail = new Mail()
    mail.fake()
    mail.configure({ from: 'system@app.com' })
    await mail.to('x@y.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('system@app.com')
  })

  test('configure() is chainable', () => {
    const mail = new Mail()
    expect(mail.configure({})).toBe(mail)
  })
})

// BaseMail — class-based emails

describe('BaseMail', () => {
  test('BaseMail.send() uses the provided manager in fake mode', async () => {
    class WelcomeMail extends BaseMail {
      constructor(private readonly to: string) { super() }
      prepare(): MailBuilder {
        return new MailBuilder(this['builder'] ? this['builder']['manager'] : new Mail())
          .to(this.to)
          .subject('Welcome!')
          .text('Hello there')
      }
    }

    const mail = makeFakeMail()

    class TestMail extends BaseMail {
      prepare(): MailBuilder {
        return new MailBuilder(mail)
          .to('test@example.com')
          .subject('BaseMail test')
          .html('<p>hello</p>')
      }
    }

    const instance = new TestMail()
    await instance.send(mail)

    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].subject).toBe('BaseMail test')
    expect(mail.sent[0].to).toBe('test@example.com')
  })
})

// MailProvider

describe('MailProvider', () => {
  test('register() registers a Mail into the app container', async () => {
    const provider = new MailProvider()
    const app = new App()
    app.instance('config', (key: string) => key === 'mail' ? { from: 'hello@world.com' } : undefined)
    await provider.register(app)
    expect(app.use('mail')).toBeInstanceOf(Mail)
  })

  test('register() returns early if no mail config', async () => {
    const provider = new MailProvider()
    const app = new App()
    app.instance('config', (_key: string) => undefined)
    await provider.register(app)
    expect(app.has('mail')).toBe(false)
  })

  test('registered Mail is functional', async () => {
    const provider = new MailProvider()
    const app = new App()
    app.instance('config', (key: string) => key === 'mail' ? { from: 'hello@world.com' } : undefined)
    await provider.register(app)
    const mgr = app.use<Mail>('mail')
    mgr.fake()
    await mgr.to('x@y.com').subject('s').text('t').send()
    expect(mgr.sent[0].from).toBe('hello@world.com')
  })
})

// log transport — always available as fallback

describe('Mail — log transport (built-in fallback)', () => {
  test('log transport is available without any configuration', async () => {
    const mail = new Mail()
    // Should not throw — log transport is always registered
    await expect(
      mail.use('log').to('a@b.com').subject('s').text('t').send()
    ).resolves.toBeUndefined()
  })
})

// Fluent builder — all methods return `this` (chainability)

describe('MailBuilder — fluent chaining returns builder instance', () => {
  test('from() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.from('a@b.com')).toBe(builder)
  })

  test('to() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.to('a@b.com')).toBe(builder)
  })

  test('cc() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.cc('cc@b.com')).toBe(builder)
  })

  test('bcc() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.bcc('bcc@b.com')).toBe(builder)
  })

  test('replyTo() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.replyTo('reply@b.com')).toBe(builder)
  })

  test('subject() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.subject('Hello')).toBe(builder)
  })

  test('html() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.html('<p>hi</p>')).toBe(builder)
  })

  test('text() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.text('plain')).toBe(builder)
  })

  test('attach() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.attach({ filename: 'f.txt', content: 'x' })).toBe(builder)
  })

  test('header() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.header('X-Foo', 'bar')).toBe(builder)
  })

  test('template() returns the builder', () => {
    const mail = makeFakeMail()
    const builder = new MailBuilder(mail)
    expect(builder.template((d: { v: string }) => d.v, { v: 'hi' })).toBe(builder)
  })

  test('full chain all methods in sequence', async () => {
    const mail = makeFakeMail()
    await mail
      .to('a@b.com')
      .from('f@b.com')
      .cc('cc@b.com')
      .bcc('bcc@b.com')
      .replyTo('r@b.com')
      .subject('Chain test')
      .text('plain')
      .html('<b>bold</b>')
      .attach({ filename: 'a.txt', content: 'data' })
      .header('X-Chain', '1')
      .send()
    expect(mail.sent).toHaveLength(1)
    const msg = mail.sent[0]
    expect(msg.subject).toBe('Chain test')
    expect(msg.cc).toBe('cc@b.com')
    expect(msg.bcc).toBe('bcc@b.com')
    expect(msg.replyTo).toBe('r@b.com')
    expect(msg.from).toBe('f@b.com')
    expect(msg.attachments).toHaveLength(1)
    expect(msg.headers?.['X-Chain']).toBe('1')
  })
})

// cc / bcc / replyTo — more edge cases

describe('MailBuilder — cc, bcc, replyTo edge cases', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('cc with array stores multiple addresses', async () => {
    await mail.to('a@t.com').cc(['cc1@t.com', 'cc2@t.com']).subject('s').text('t').send()
    const cc = mail.sent[0].cc
    expect(Array.isArray(cc)).toBe(true)
    expect((cc as string[]).length).toBe(2)
  })

  test('bcc with array stores multiple addresses', async () => {
    await mail.to('a@t.com').bcc(['bcc1@t.com', 'bcc2@t.com']).subject('s').text('t').send()
    const bcc = mail.sent[0].bcc
    expect(Array.isArray(bcc)).toBe(true)
    expect((bcc as string[]).length).toBe(2)
  })

  test('chained cc() calls accumulate', async () => {
    await mail.to('a@t.com').cc('c1@t.com').cc('c2@t.com').subject('s').text('t').send()
    const cc = mail.sent[0].cc
    expect(Array.isArray(cc)).toBe(true)
    expect((cc as string[]).length).toBe(2)
  })

  test('chained bcc() calls accumulate', async () => {
    await mail.to('a@t.com').bcc('b1@t.com').bcc('b2@t.com').subject('s').text('t').send()
    const bcc = mail.sent[0].bcc
    expect(Array.isArray(bcc)).toBe(true)
    expect((bcc as string[]).length).toBe(2)
  })
})

// attach() — multiple attachments

describe('MailBuilder — attach accumulates attachments', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('two attach() calls produce two attachments', async () => {
    await mail
      .to('a@t.com')
      .subject('files')
      .text('body')
      .attach({ filename: 'one.txt', content: '1' })
      .attach({ filename: 'two.txt', content: '2' })
      .send()
    expect(mail.sent[0].attachments).toHaveLength(2)
  })

  test('attachment contentType is preserved', async () => {
    await mail
      .to('a@t.com')
      .subject('img')
      .text('body')
      .attach({ filename: 'img.png', content: Buffer.from([0]), contentType: 'image/png' })
      .send()
    expect(mail.sent[0].attachments![0].contentType).toBe('image/png')
  })

  test('attachment with Buffer content is preserved', async () => {
    const buf = Buffer.from('binary data')
    await mail
      .to('a@t.com')
      .subject('bin')
      .text('body')
      .attach({ filename: 'data.bin', content: buf })
      .send()
    expect(Buffer.isBuffer(mail.sent[0].attachments![0].content)).toBe(true)
  })
})

// header() — custom headers

describe('MailBuilder — header() custom headers', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('multiple headers are all stored', async () => {
    await mail
      .to('a@t.com')
      .subject('s')
      .text('t')
      .header('X-One', 'v1')
      .header('X-Two', 'v2')
      .send()
    expect(mail.sent[0].headers?.['X-One']).toBe('v1')
    expect(mail.sent[0].headers?.['X-Two']).toBe('v2')
  })

  test('setting the same header key twice overwrites the value', async () => {
    await mail
      .to('a@t.com')
      .subject('s')
      .text('t')
      .header('X-Token', 'first')
      .header('X-Token', 'second')
      .send()
    expect(mail.sent[0].headers?.['X-Token']).toBe('second')
  })
})

// template() — renders to html

describe('MailBuilder — template()', () => {
  let mail: Mail

  beforeEach(() => {
    mail = makeFakeMail()
  })

  test('template function receives data and result is stored as html', async () => {
    await mail
      .to('a@t.com')
      .subject('tpl')
      .template((d: { title: string; count: number }) => `<h1>${d.title}: ${d.count}</h1>`, { title: 'Items', count: 3 })
      .send()
    expect(mail.sent[0].html).toBe('<h1>Items: 3</h1>')
  })

  test('template() overwrites any previous html() call', async () => {
    await mail
      .to('a@t.com')
      .subject('s')
      .html('<p>old</p>')
      .template((_d: unknown) => '<p>new</p>', {})
      .send()
    expect(mail.sent[0].html).toBe('<p>new</p>')
  })
})

// multiple to() calls accumulate

describe('MailBuilder — multiple to() calls', () => {
  test('three separate to() calls produce three recipients', async () => {
    const mail = makeFakeMail()
    await mail
      .to('a@t.com')
      .to('b@t.com')
      .to('c@t.com')
      .subject('multi')
      .text('body')
      .send()
    const to = mail.sent[0].to
    expect(Array.isArray(to)).toBe(true)
    expect((to as string[]).length).toBe(3)
    expect(to).toContain('a@t.com')
    expect(to).toContain('b@t.com')
    expect(to).toContain('c@t.com')
  })

  test('mixing to() string and to() array accumulates all addresses', async () => {
    const mail = makeFakeMail()
    await mail
      .to('solo@t.com')
      .to(['arr1@t.com', 'arr2@t.com'])
      .subject('mix')
      .text('body')
      .send()
    const to = mail.sent[0].to as string[]
    expect(to.length).toBe(3)
    expect(to).toContain('solo@t.com')
  })
})

// from config default

describe('Mail — from config default', () => {
  test('configure() from is used as sender when not overridden', async () => {
    const mail = new Mail()
    mail.fake()
    mail.configure({ from: 'default@app.com' })
    await mail.to('r@r.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('default@app.com')
  })

  test('explicit from() on builder overrides configure() default', async () => {
    const mail = new Mail()
    mail.fake()
    mail.configure({ from: 'default@app.com' })
    await mail.to('r@r.com').from('explicit@app.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('explicit@app.com')
  })

  test('no from is set when neither configure() nor from() is called', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('r@r.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBeUndefined()
  })
})

// fake: sent array accumulates across multiple sends

describe('Mail.fake — accumulation across many sends', () => {
  test('sent array grows with each send call', async () => {
    const mail = makeFakeMail()
    for (let i = 0; i < 5; i++) {
      await mail.to(`user${i}@test.com`).subject(`msg ${i}`).text('body').send()
    }
    expect(mail.sent).toHaveLength(5)
    expect(mail.sent[4].subject).toBe('msg 4')
  })

  test('sent entries are ordered by insertion (FIFO)', async () => {
    const mail = makeFakeMail()
    await mail.to('first@t.com').subject('first').text('x').send()
    await mail.to('second@t.com').subject('second').text('x').send()
    expect(mail.sent[0].subject).toBe('first')
    expect(mail.sent[1].subject).toBe('second')
  })

  test('clearSent resets count to zero after multiple sends', async () => {
    const mail = makeFakeMail()
    await mail.to('a@t.com').subject('1').text('x').send()
    await mail.to('b@t.com').subject('2').text('x').send()
    mail.clearSent()
    expect(mail.sent).toHaveLength(0)
  })

  test('after clearSent new sends accumulate again', async () => {
    const mail = makeFakeMail()
    await mail.to('a@t.com').subject('1').text('x').send()
    mail.clearSent()
    await mail.to('b@t.com').subject('2').text('x').send()
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].subject).toBe('2')
  })
})

// BaseMail subclass — prepare is called, send dispatches

describe('BaseMail — subclass prepare() and send()', () => {
  test('prepare() is called and its builder is used to send', async () => {
    const mail = makeFakeMail()

    class InvoiceMail extends BaseMail {
      constructor(private readonly invoiceId: string) { super() }
      prepare(): MailBuilder {
        return new MailBuilder(mail)
          .to('billing@example.com')
          .subject(`Invoice #${this.invoiceId}`)
          .html('<p>Please pay</p>')
      }
    }

    const instance = new InvoiceMail('INV-001')
    await instance.send(mail)

    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].subject).toBe('Invoice #INV-001')
    expect(mail.sent[0].to).toBe('billing@example.com')
    expect(mail.sent[0].html).toBe('<p>Please pay</p>')
  })

  test('each new instance of a BaseMail subclass dispatches independently', async () => {
    const mail = makeFakeMail()

    class PingMail extends BaseMail {
      constructor(private readonly recipient: string) { super() }
      prepare(): MailBuilder {
        return new MailBuilder(mail).to(this.recipient).subject('ping').text('pong')
      }
    }

    await new PingMail('a@t.com').send(mail)
    await new PingMail('b@t.com').send(mail)

    expect(mail.sent).toHaveLength(2)
    expect(mail.sent[0].to).toBe('a@t.com')
    expect(mail.sent[1].to).toBe('b@t.com')
  })

  test('BaseMail prepare() returning html is captured in fake mode', async () => {
    const mail = makeFakeMail()

    class HtmlMail extends BaseMail {
      prepare(): MailBuilder {
        return new MailBuilder(mail)
          .to('t@t.com')
          .subject('HTML mail')
          .html('<strong>Hello</strong>')
      }
    }

    await new HtmlMail().send(mail)
    expect(mail.sent[0].html).toBe('<strong>Hello</strong>')
  })

  test('BaseMail prepare() can use template()', async () => {
    const mail = makeFakeMail()

    class TplMail extends BaseMail {
      prepare(): MailBuilder {
        return new MailBuilder(mail)
          .to('t@t.com')
          .subject('Template mail')
          .template((d: { name: string }) => `<p>Hi ${d.name}</p>`, { name: 'Bob' })
      }
    }

    await new TplMail().send(mail)
    expect(mail.sent[0].html).toBe('<p>Hi Bob</p>')
  })
})

// NEW TESTS: Deep edge cases for Mail

describe('Mail.fake — isolation between instances', () => {
  test('two fake Mail instances have independent sent arrays', async () => {
    const mail1 = new Mail()
    mail1.fake()
    const mail2 = new Mail()
    mail2.fake()
    await mail1.to('a@b.com').subject('m1').text('t').send()
    expect(mail1.sent).toHaveLength(1)
    expect(mail2.sent).toHaveLength(0)
  })

  test('restoring one instance does not affect another', async () => {
    const mail1 = new Mail()
    mail1.fake()
    const mail2 = new Mail()
    mail2.fake()
    await mail1.to('a@b.com').subject('s').text('t').send()
    mail1.restore()
    await mail2.to('b@c.com').subject('s2').text('t2').send()
    expect(mail2.sent).toHaveLength(1)
  })
})

describe('MailBuilder — validation edge cases', () => {
  test('send with empty string subject throws', async () => {
    const mail = new Mail()
    mail.fake()
    const builder = new MailBuilder(mail)
    builder.to('a@b.com').subject('')
    await expect(builder.send()).rejects.toThrow('subject is required')
  })

  test('send with html but no text sets html only', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('html-only').html('<p>hi</p>').send()
    expect(mail.sent[0].html).toBe('<p>hi</p>')
    expect(mail.sent[0].text).toBeUndefined()
  })

  test('send with text but no html sets text only', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('text-only').text('plain').send()
    expect(mail.sent[0].text).toBe('plain')
    expect(mail.sent[0].html).toBeUndefined()
  })

  test('both html and text can be set on the same message', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('both').text('plain').html('<b>bold</b>').send()
    expect(mail.sent[0].text).toBe('plain')
    expect(mail.sent[0].html).toBe('<b>bold</b>')
  })
})

describe('MailBuilder — multiple attachments edge cases', () => {
  test('three attachments are all preserved in order', async () => {
    const mail = new Mail()
    mail.fake()
    await mail
      .to('a@b.com')
      .subject('files')
      .text('body')
      .attach({ filename: 'a.txt', content: '1' })
      .attach({ filename: 'b.txt', content: '2' })
      .attach({ filename: 'c.txt', content: '3' })
      .send()
    const attachments = mail.sent[0].attachments!
    expect(attachments).toHaveLength(3)
    expect(attachments[0].filename).toBe('a.txt')
    expect(attachments[1].filename).toBe('b.txt')
    expect(attachments[2].filename).toBe('c.txt')
  })

  test('attachment with empty content is allowed', async () => {
    const mail = new Mail()
    mail.fake()
    await mail
      .to('a@b.com')
      .subject('empty')
      .text('body')
      .attach({ filename: 'empty.txt', content: '' })
      .send()
    expect(mail.sent[0].attachments).toHaveLength(1)
    expect(mail.sent[0].attachments![0].content).toBe('')
  })
})

describe('Mail.assertSent — predicate edge cases', () => {
  test('assertSent with predicate checking subject', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('Special Subject').text('t').send()
    expect(() => mail.assertSent(m => m.subject === 'Special Subject')).not.toThrow()
  })

  test('assertSent with predicate checking html content', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('s').html('<p>content</p>').send()
    expect(() => mail.assertSent(m => m.html?.includes('content') ?? false)).not.toThrow()
  })

  test('assertNotSent with predicate checking subject passes when no match', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('Normal').text('t').send()
    expect(() => mail.assertNotSent(m => m.subject === 'Other')).not.toThrow()
  })
})

describe('Mail.use() — transport selection', () => {
  test('use() returns a builder that still works in fake mode', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.use('log').to('a@b.com').subject('s').text('t').send()
    expect(mail.sent).toHaveLength(1)
  })

  test('use() with custom transport receives correct message', async () => {
    const mail = new Mail()
    const received: MailMessage[] = []
    const transport: Transport = {
      name: 'test-transport',
      async send(msg) { received.push(msg) },
    }
    mail.extend('test-transport', transport)
    await mail.use('test-transport').to('a@b.com').subject('custom').text('body').send()
    expect(received).toHaveLength(1)
    expect(received[0].to).toBe('a@b.com')
    expect(received[0].subject).toBe('custom')
  })
})

describe('Mail.configure — edge cases', () => {
  test('configure with empty object does not throw', () => {
    const mail = new Mail()
    expect(() => mail.configure({})).not.toThrow()
  })

  test('configure can be called multiple times, last wins', async () => {
    const mail = new Mail()
    mail.fake()
    mail.configure({ from: 'first@app.com' })
    mail.configure({ from: 'second@app.com' })
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(mail.sent[0].from).toBe('second@app.com')
  })
})

describe('Mail — assertSentCount edge cases', () => {
  test('assertSentCount(1) passes after exactly one send', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() => mail.assertSentCount(1)).not.toThrow()
  })

  test('assertSentCount(0) fails after one send', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('s').text('t').send()
    expect(() => mail.assertSentCount(0)).toThrow()
  })

  test('clearSent resets so assertSentCount(0) passes', async () => {
    const mail = new Mail()
    mail.fake()
    await mail.to('a@b.com').subject('s').text('t').send()
    mail.clearSent()
    expect(() => mail.assertSentCount(0)).not.toThrow()
  })
})

describe('Mail.extend — transport override', () => {
  test('extending with same name replaces the transport', async () => {
    const mail = new Mail()
    const received1: MailMessage[] = []
    const received2: MailMessage[] = []
    mail.extend('custom', { name: 'custom', send: async (m) => { received1.push(m) } })
    mail.extend('custom', { name: 'custom', send: async (m) => { received2.push(m) } })
    await mail.use('custom').to('a@b.com').subject('s').text('t').send()
    expect(received1).toHaveLength(0)
    expect(received2).toHaveLength(1)
  })
})
