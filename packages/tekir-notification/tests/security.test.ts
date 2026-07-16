import { test, expect, describe, afterEach } from 'bun:test'
import { Notification, NotificationProvider, BaseNotification, DatabaseChannel, sendPushChannel, topicForUser, type ChannelName, type PushPayload, type DatabasePayload } from '../src/index'

const realFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = realFetch })

describe('manager error isolation', () => {
  class FailMailNotif extends BaseNotification {
    via(): ChannelName[] { return ['mail', 'log'] }
    toMail(): any { return { to: 'x@y.com', subject: 's' } }
    toLog(): string { return 'logged' }
  }

  test('one failing channel does not stop the others', async () => {
    const notify = new Notification()
    // Mail channel will throw because @tekir/mail import or send fails; log
    // should still run. We capture logs to confirm the log channel executed and
    // the failure was reported, not propagated.
    const lines: string[] = []
    ;(notify as any)._log = {
      info: (...a: any[]) => lines.push(['info', ...a].join(' ')),
      warn: (...a: any[]) => lines.push(['warn', ...a].join(' ')),
      error: (...a: any[]) => lines.push(['error', ...a].join(' ')),
    }

    // Force the mail channel to reject by using a notification whose toMail is
    // missing in a way that throws inside dispatch. Simpler: spy by replacing
    // the dispatch for 'mail'. Instead assert send() resolves despite a reject.
    class Boom extends BaseNotification {
      via(): ChannelName[] { return ['push', 'log'] }
      toPush(): PushPayload { return { title: 't', body: 'b' } }
      toLog(): string { return 'ok' }
    }
    // push with no fcm config just warns + returns; make push throw via fetch
    globalThis.fetch = (async () => { throw new Error('network down') }) as any
    notify.configure({ fcm: { serverKey: 'k' } })

    await expect(notify.send('u1', new Boom())).resolves.toBeUndefined()
    // The push failure should have been logged, not thrown.
    expect(lines.some(l => l.includes('error') && l.includes('push'))).toBe(true)
  })

  test('sendMany isolates per-user failures', async () => {
    const notify = new Notification()
    ;(notify as any)._log = { info() {}, warn() {}, error() {} }
    globalThis.fetch = (async () => { throw new Error('down') }) as any
    notify.configure({ fcm: { serverKey: 'k' } })
    class P extends BaseNotification {
      via(): ChannelName[] { return ['push'] }
      toPush(): PushPayload { return { title: 't', body: 'b' } }
    }
    await expect(notify.sendMany(['a', 'b', 'c'], new P())).resolves.toBeUndefined()
  })
})

describe('FCM topic normalization', () => {
  test('replaces invalid characters', () => {
    expect(topicForUser('abc-123')).toBe('user_abc-123')
    expect(topicForUser('a/b c')).toBe('user_a_b_c')
    expect(topicForUser('drop;table')).toBe('user_drop_table')
  })
})

describe('FCM push auth/endpoint correctness', () => {
  class PushNotif extends BaseNotification {
    via(): ChannelName[] { return ['push'] }
    toPush(): PushPayload { return { title: 't', body: 'b' } }
  }

  test('v1: Bearer auth + message.topic when accessToken given', async () => {
    let captured: any = null
    globalThis.fetch = (async (url: string, init: any) => {
      captured = { url, init }
      return new Response('{}', { status: 200 })
    }) as any
    await sendPushChannel('user42', new PushNotif(), { accessToken: 'ya29.tok', projectId: 'proj' })
    expect(captured.url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send')
    expect(captured.init.headers.Authorization).toBe('Bearer ya29.tok')
    const body = JSON.parse(captured.init.body)
    expect(body.message.topic).toBe('user_user42')
  })

  test('legacy: key= auth + to: schema + legacy endpoint when only serverKey', async () => {
    let captured: any = null
    globalThis.fetch = (async (url: string, init: any) => {
      captured = { url, init }
      return new Response('{}', { status: 200 })
    }) as any
    await sendPushChannel('user42', new PushNotif(), { serverKey: 'legacy-key' })
    expect(captured.url).toBe('https://fcm.googleapis.com/fcm/send')
    expect(captured.init.headers.Authorization).toBe('key=legacy-key')
    const body = JSON.parse(captured.init.body)
    expect(body.to).toBe('/topics/user_user42')
  })

  test('throws on non-ok response (no silent failure)', async () => {
    globalThis.fetch = (async () => new Response('bad', { status: 401 })) as any
    await expect(sendPushChannel('u', new PushNotif(), { serverKey: 'k' })).rejects.toThrow('401')
  })

  test('uses custom endpoint when provided', async () => {
    let url = ''
    globalThis.fetch = (async (u: string) => { url = u; return new Response('{}', { status: 200 }) }) as any
    await sendPushChannel('u', new PushNotif(), { accessToken: 't', endpoint: 'https://custom/send' })
    expect(url).toBe('https://custom/send')
  })
})

describe('DatabaseChannel redaction', () => {
  test('redacts sensitive keys before persisting', async () => {
    let storedData = ''
    const db = {
      query: async () => [],
      execute: async (_sql: string, params: any[]) => { storedData = params[5] },
    }
    const channel = new DatabaseChannel(db as any)
    class N extends BaseNotification {
      via(): ChannelName[] { return ['database'] }
      toDatabase(): DatabasePayload & Record<string, unknown> {
        return { type: 't', title: 'T', body: 'B', token: 'SECRET-TOKEN', nested: { password: 'p' } as any }
      }
    }
    await channel.send('user-1', new N())
    expect(storedData).not.toContain('SECRET-TOKEN')
    expect(storedData).toContain('[redacted]')
    const parsed = JSON.parse(storedData)
    expect(parsed.nested.password).toBe('[redacted]')
    // Non-sensitive fields preserved.
    expect(parsed.title).toBe('T')
  })

  test('redacts sensitive keys nested inside arrays', async () => {
    let storedData = ''
    const db = {
      query: async () => [],
      execute: async (_sql: string, params: any[]) => { storedData = params[5] },
    }
    const channel = new DatabaseChannel(db as any)
    class N extends BaseNotification {
      toDatabase(): any {
        return { type: 't', title: 'T', body: 'B', devices: [{ token: 'SECRET', name: 'phone' }] }
      }
    }
    await channel.send('user-1', new N())
    const parsed = JSON.parse(storedData)
    expect(parsed.devices[0]).toEqual({ token: '[redacted]', name: 'phone' })
  })
})

describe('notification configuration edge cases', () => {
  test('real mail channel dispatches through the injected mail adapter with sanitized headers', async () => {
    const delivered: any[] = []
    const notify = new Notification()
    notify.configure({
      mail: { dispatch: async (message) => { delivered.push(message) } },
    })
    class N extends BaseNotification {
      toMail(): any {
        return {
          to: 'user@example.com\r\nBcc: attacker@example.com',
          subject: 'Hello\nX-Injected: yes',
          text: 'body\nlines remain',
        }
      }
    }
    await notify.channel('mail').send('u1', new N())
    expect(delivered).toHaveLength(1)
    expect(delivered[0].to).toBe('user@example.comBcc: attacker@example.com')
    expect(delivered[0].subject).toBe('HelloX-Injected: yes')
    expect(delivered[0].text).toBe('body\nlines remain')
  })

  test('mail channel fails clearly when no mail service was injected', async () => {
    const notify = new Notification()
    class N extends BaseNotification {
      toMail(): any { return { to: 'user@example.com', subject: 'Hi' } }
    }
    await expect(notify.channel('mail').send('u1', new N())).rejects.toThrow('No mail adapter configured')
  })

  test('defaultChannels applies when notification does not override via()', async () => {
    const notify = new Notification()
    notify.configure({ defaultChannels: ['push'] })
    notify.fake()
    class N extends BaseNotification { toPush(): PushPayload { return { title: 'T', body: 'B' } } }
    await notify.send('u1', new N())
    expect(notify.getSent().map((entry) => entry.channel)).toEqual(['push'])
  })

  test('provider accepts adapters exposing execute instead of run', async () => {
    let registered: any
    const db = { query: async () => [], execute: async () => {} }
    const app = {
      use(name: string) {
        if (name === 'config') return (key: string) => key === 'notification' ? {} : undefined
        if (name === 'db') return db
      },
      instance(_name: string, value: unknown) { registered = value },
    }
    await new NotificationProvider().register(app as any)
    expect(registered).toBeInstanceOf(Notification)
    expect((registered as any)._dbChannel).not.toBeNull()
  })

  test('provider injects the configured mail service', async () => {
    let registered: any
    const delivered: any[] = []
    const mail = { dispatch: async (message: any) => { delivered.push(message) } }
    const app = {
      use(name: string) {
        if (name === 'config') return (key: string) => key === 'notification' ? {} : undefined
        if (name === 'mail') return mail
        throw new Error('not registered')
      },
      instance(_name: string, value: unknown) { registered = value },
    }
    await new NotificationProvider().register(app as any)
    class N extends BaseNotification {
      toMail(): any { return { to: 'user@example.com', subject: 'Hi' } }
    }
    await registered.channel('mail').send('u1', new N())
    expect(delivered).toHaveLength(1)
  })
})
