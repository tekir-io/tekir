import { test, expect, describe, beforeEach } from 'bun:test'
import { App } from '@tekir/core'
import {
  Notification,
  BaseNotification,
  NotificationProvider,
  type ChannelName,
  type MailPayload,
  type DatabasePayload,
  type PushPayload,
  type SentRecord,
} from '../src/index'

// Concrete notification classes for tests

class WelcomeNotification extends BaseNotification {
  constructor(public readonly userName: string) { super() }

  via(): ChannelName[] { return ['mail', 'log'] }

  toMail(): MailPayload {
    return {
      to: `${this.userName}@example.com`,
      subject: 'Welcome!',
      html: `<h1>Hello, ${this.userName}</h1>`,
    }
  }

  toLog(): string { return `Welcome email queued for ${this.userName}` }
}

class AlertNotification extends BaseNotification {
  constructor(public readonly message: string) { super() }

  via(): ChannelName[] { return ['database', 'push'] }

  toDatabase(): DatabasePayload {
    return { type: 'alert', title: 'Alert', body: this.message }
  }

  toPush(): PushPayload {
    return { title: 'Alert', body: this.message }
  }
}

class LogOnlyNotification extends BaseNotification {
  via(): ChannelName[] { return ['log'] }
  toLog(): string { return 'log-only message' }
}

class MultiChannelNotification extends BaseNotification {
  via(): ChannelName[] { return ['mail', 'database', 'push', 'log'] }

  toMail(): MailPayload { return { to: 'x@y.com', subject: 'Multi' } }
  toDatabase(): DatabasePayload { return { type: 'multi', title: 'Multi', body: 'body' } }
  toPush(): PushPayload { return { title: 'Multi', body: 'body' } }
  toLog(): string { return 'multi-channel' }
}

// Helpers

function makeFakeNotify(): Notification {
  const notify = new Notification()
  notify.fake()
  return notify
}

// fake() mode — basic send & getSent

describe('Notification.fake — send', () => {
  let notify: Notification

  beforeEach(() => {
    notify = makeFakeNotify()
  })

  test('send() in fake mode does not throw', async () => {
    await expect(notify.send('user-1', new WelcomeNotification('Alice'))).resolves.toBeUndefined()
  })

  test('getSent() returns sent records after send()', async () => {
    await notify.send('user-1', new WelcomeNotification('Alice'))
    const sent = notify.getSent()
    expect(sent.length).toBeGreaterThan(0)
  })

  test('getSent() captures userId correctly', async () => {
    await notify.send('user-42', new WelcomeNotification('Bob'))
    const sent = notify.getSent()
    expect(sent.some(r => r.userId === 'user-42')).toBe(true)
  })

  test('getSent() captures the notification instance', async () => {
    const n = new WelcomeNotification('Carol')
    await notify.send('u1', n)
    const sent = notify.getSent()
    expect(sent.some(r => r.notification === n)).toBe(true)
  })

  test('each via() channel produces a separate sent record', async () => {
    // WelcomeNotification.via() returns ['mail', 'log']
    await notify.send('u1', new WelcomeNotification('Dave'))
    const sent = notify.getSent()
    const channels = sent.map(r => r.channel)
    expect(channels).toContain('mail')
    expect(channels).toContain('log')
  })

  test('send captures payload for mail channel', async () => {
    await notify.send('u1', new WelcomeNotification('Eve'))
    const sent = notify.getSent()
    const mailRecord = sent.find(r => r.channel === 'mail')
    expect(mailRecord).toBeDefined()
    expect((mailRecord!.payload as MailPayload).to).toBe('Eve@example.com')
    expect((mailRecord!.payload as MailPayload).subject).toBe('Welcome!')
  })

  test('send captures payload for log channel', async () => {
    await notify.send('u1', new WelcomeNotification('Frank'))
    const sent = notify.getSent()
    const logRecord = sent.find(r => r.channel === 'log')
    expect(logRecord).toBeDefined()
    expect(logRecord!.payload).toBe('Welcome email queued for Frank')
  })

  test('send captures payload for database channel', async () => {
    await notify.send('u1', new AlertNotification('disk full'))
    const sent = notify.getSent()
    const dbRecord = sent.find(r => r.channel === 'database')
    expect(dbRecord).toBeDefined()
    expect((dbRecord!.payload as DatabasePayload).type).toBe('alert')
    expect((dbRecord!.payload as DatabasePayload).body).toBe('disk full')
  })

  test('send captures payload for push channel', async () => {
    await notify.send('u1', new AlertNotification('new message'))
    const sent = notify.getSent()
    const pushRecord = sent.find(r => r.channel === 'push')
    expect(pushRecord).toBeDefined()
    expect((pushRecord!.payload as PushPayload).body).toBe('new message')
  })

  test('getSent() returns a copy (mutation does not affect internal state)', async () => {
    await notify.send('u1', new LogOnlyNotification())
    const sent1 = notify.getSent()
    sent1.length = 0 // mutate the copy
    expect(notify.getSent().length).toBeGreaterThan(0)
  })
})

// assertSent

describe('Notification.assertSent', () => {
  let notify: Notification

  beforeEach(() => {
    notify = makeFakeNotify()
  })

  test('assertSent does not throw when notification was sent', async () => {
    await notify.send('u1', new WelcomeNotification('G'))
    expect(() => notify.assertSent(WelcomeNotification)).not.toThrow()
  })

  test('assertSent throws when notification was NOT sent', () => {
    expect(() => notify.assertSent(WelcomeNotification)).toThrow('Expected notification not sent')
  })

  test('assertSent with channel — passes when channel matches', async () => {
    await notify.send('u1', new WelcomeNotification('H'))
    expect(() => notify.assertSent(WelcomeNotification, 'mail')).not.toThrow()
  })

  test('assertSent with channel — throws when channel does not match', async () => {
    await notify.send('u1', new WelcomeNotification('I'))
    // WelcomeNotification does not go on 'database'
    expect(() => notify.assertSent(WelcomeNotification, 'database')).toThrow()
  })

  test('assertSent with userId — passes when userId matches', async () => {
    await notify.send('user-99', new WelcomeNotification('J'))
    expect(() => notify.assertSent(WelcomeNotification, undefined, 'user-99')).not.toThrow()
  })

  test('assertSent with userId — throws when userId does not match', async () => {
    await notify.send('user-99', new WelcomeNotification('K'))
    expect(() => notify.assertSent(WelcomeNotification, undefined, 'user-000')).toThrow()
  })

  test('assertSent with channel and userId — passes when both match', async () => {
    await notify.send('u5', new WelcomeNotification('L'))
    expect(() => notify.assertSent(WelcomeNotification, 'mail', 'u5')).not.toThrow()
  })

  test('assertSent with wrong class throws', async () => {
    await notify.send('u1', new LogOnlyNotification())
    expect(() => notify.assertSent(WelcomeNotification)).toThrow()
  })
})

// channel() — forced channel routing

describe('Notification.channel', () => {
  let notify: Notification

  beforeEach(() => {
    notify = makeFakeNotify()
  })

  test('channel().send() bypasses via() and uses specified channel', async () => {
    // WelcomeNotification.via() returns ['mail','log'], not 'database'
    const n = new WelcomeNotification('Zara')
    // toDatabase is not implemented — payload will be null in fake mode
    await notify.channel('database').send('u1', n)
    const sent = notify.getSent()
    expect(sent.some(r => r.channel === 'database')).toBe(true)
    // No mail or log records (only the forced channel)
    expect(sent.filter(r => r.channel === 'mail')).toHaveLength(0)
  })

  test('channel().send() records the correct userId', async () => {
    await notify.channel('log').send('forced-user', new LogOnlyNotification())
    const sent = notify.getSent()
    expect(sent[0].userId).toBe('forced-user')
  })
})

// sendMany

describe('Notification.sendMany', () => {
  test('sendMany sends to every userId', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany(['u1', 'u2', 'u3'], new LogOnlyNotification())
    const sent = notify.getSent()
    const userIds = sent.map(r => r.userId)
    expect(userIds).toContain('u1')
    expect(userIds).toContain('u2')
    expect(userIds).toContain('u3')
  })

  test('sendMany with empty array sends nothing', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany([], new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(0)
  })
})

// restore() clears fake state

describe('Notification.restore', () => {
  test('restore() clears the sent list', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    expect(notify.getSent().length).toBeGreaterThan(0)
    notify.restore()
    expect(notify.getSent()).toHaveLength(0)
  })

  test('calling fake() again after restore() resets the sent list', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    notify.restore()
    notify.fake()
    expect(notify.getSent()).toHaveLength(0)
  })
})

// All four channels captured in fake mode

describe('Notification — all channels in fake mode', () => {
  test('all four channels are recorded for MultiChannelNotification', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new MultiChannelNotification())
    const sent = notify.getSent()
    const channels = sent.map(r => r.channel)
    expect(channels).toContain('mail')
    expect(channels).toContain('database')
    expect(channels).toContain('push')
    expect(channels).toContain('log')
  })
})

// NotificationProvider

describe('NotificationProvider', () => {
  test('register() registers a Notification into the app container', async () => {
    const provider = new NotificationProvider()
    const app = new App()
    app.instance('config', (key: string) => key === 'notification' ? { channels: [] } : undefined)
    await provider.register(app)
    expect(app.use('notification')).toBeInstanceOf(Notification)
  })

  test('register() returns early if no notification config', async () => {
    const provider = new NotificationProvider()
    const app = new App()
    app.instance('config', (_key: string) => undefined)
    await provider.register(app)
    expect(app.has('notification')).toBe(false)
  })
})

// BaseNotification defaults

describe('BaseNotification defaults', () => {
  test('via() defaults to ["log"]', () => {
    class Bare extends BaseNotification {}
    const n = new Bare()
    expect(n.via()).toEqual(['log'])
  })

  test('optional methods are undefined by default', () => {
    class Bare extends BaseNotification {}
    const n = new Bare()
    expect(n.toMail).toBeUndefined()
    expect(n.toDatabase).toBeUndefined()
    expect(n.toPush).toBeUndefined()
    expect(n.toLog).toBeUndefined()
  })
})

// via() — different channels per user

describe('BaseNotification — via() receives userId', () => {
  test('via() can return different channels based on userId', async () => {
    class UserAwareNotification extends BaseNotification {
      via(userId?: string): ChannelName[] {
        return userId === 'vip' ? ['mail', 'push'] : ['log']
      }
      toMail(): MailPayload { return { to: 'vip@t.com', subject: 'VIP' } }
      toPush(): PushPayload { return { title: 'VIP', body: 'Hi VIP' } }
      toLog(): string { return 'standard log' }
    }

    const notify = makeFakeNotify()
    await notify.send('vip', new UserAwareNotification())
    await notify.send('regular', new UserAwareNotification())

    const vipRecords = notify.getSent().filter(r => r.userId === 'vip')
    const regularRecords = notify.getSent().filter(r => r.userId === 'regular')

    expect(vipRecords.map(r => r.channel)).toContain('mail')
    expect(vipRecords.map(r => r.channel)).toContain('push')
    expect(regularRecords.map(r => r.channel)).toEqual(['log'])
  })
})

// sendMany — edge cases

describe('Notification.sendMany — edge cases', () => {
  test('sendMany with a single user produces records for that user', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany(['only-user'], new LogOnlyNotification())
    const sent = notify.getSent()
    expect(sent.every(r => r.userId === 'only-user')).toBe(true)
  })

  test('sendMany produces records for every user', async () => {
    const notify = makeFakeNotify()
    const users = ['u1', 'u2', 'u3', 'u4']
    await notify.sendMany(users, new LogOnlyNotification())
    const ids = notify.getSent().map(r => r.userId)
    for (const u of users) {
      expect(ids).toContain(u)
    }
  })

  test('sendMany with empty array leaves getSent() empty', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany([], new MultiChannelNotification())
    expect(notify.getSent()).toHaveLength(0)
  })
})

// channel() — force specific channel

describe('Notification.channel() — forced routing', () => {
  test('forced log channel records the log payload', async () => {
    const notify = makeFakeNotify()
    await notify.channel('log').send('u1', new LogOnlyNotification())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('log')
    expect(sent[0].payload).toBe('log-only message')
  })

  test('forced push channel records push payload', async () => {
    const notify = makeFakeNotify()
    await notify.channel('push').send('u1', new AlertNotification('fire!'))
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('push')
    expect((sent[0].payload as PushPayload).body).toBe('fire!')
  })

  test('forced mail channel records mail payload', async () => {
    const notify = makeFakeNotify()
    await notify.channel('mail').send('u1', new WelcomeNotification('Zoe'))
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('mail')
    expect((sent[0].payload as MailPayload).to).toBe('Zoe@example.com')
  })

  test('forcing a channel the notification does not implement stores null payload', async () => {
    const notify = makeFakeNotify()
    // LogOnlyNotification has no toMail()
    await notify.channel('mail').send('u1', new LogOnlyNotification())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    // When no channel method matches, payload is left as undefined (not null)
    expect(sent[0].payload).toBeUndefined()
  })
})

// assertSent — filters: class, channel, userId

describe('Notification.assertSent — combined filters', () => {
  let notify: Notification

  beforeEach(() => {
    notify = makeFakeNotify()
  })

  test('assertSent with class filter matches correct class', async () => {
    await notify.send('u1', new AlertNotification('cpu'))
    expect(() => notify.assertSent(AlertNotification)).not.toThrow()
  })

  test('assertSent with class filter does not match wrong class', async () => {
    await notify.send('u1', new LogOnlyNotification())
    expect(() => notify.assertSent(AlertNotification)).toThrow()
  })

  test('assertSent with channel filter: push matches AlertNotification on push', async () => {
    await notify.send('u1', new AlertNotification('mem'))
    expect(() => notify.assertSent(AlertNotification, 'push')).not.toThrow()
  })

  test('assertSent with channel filter: log does NOT match AlertNotification (no log channel)', async () => {
    await notify.send('u1', new AlertNotification('mem'))
    expect(() => notify.assertSent(AlertNotification, 'log')).toThrow()
  })

  test('assertSent with userId filter passes when userId matches', async () => {
    await notify.send('target-user', new WelcomeNotification('T'))
    expect(() => notify.assertSent(WelcomeNotification, undefined, 'target-user')).not.toThrow()
  })

  test('assertSent with userId filter fails when userId does not match', async () => {
    await notify.send('other-user', new WelcomeNotification('T'))
    expect(() => notify.assertSent(WelcomeNotification, undefined, 'target-user')).toThrow()
  })

  test('assertSent with class + channel + userId all matching passes', async () => {
    await notify.send('u99', new WelcomeNotification('Q'))
    expect(() => notify.assertSent(WelcomeNotification, 'mail', 'u99')).not.toThrow()
  })

  test('assertSent with class + channel + userId fails when userId wrong', async () => {
    await notify.send('u99', new WelcomeNotification('Q'))
    expect(() => notify.assertSent(WelcomeNotification, 'mail', 'u88')).toThrow()
  })
})

// restore() clears fake state thoroughly

describe('Notification.restore — clears fake state', () => {
  test('getSent() returns empty array after restore()', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new MultiChannelNotification())
    expect(notify.getSent().length).toBeGreaterThan(0)
    notify.restore()
    expect(notify.getSent()).toHaveLength(0)
  })

  test('assertSent after restore() returns nothing (sent[] empty)', () => {
    const notify = makeFakeNotify()
    notify.restore()
    // assertSent would need at least one sent record — after restore there are none.
    // In non-fake mode this might behave differently; re-fake so we can test empty state.
    notify.fake()
    expect(() => notify.assertSent(WelcomeNotification)).toThrow()
  })

  test('calling fake() immediately after restore() starts fresh', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    notify.restore()
    notify.fake()
    expect(notify.getSent()).toHaveLength(0)
    // New sends work after re-faking
    await notify.send('u2', new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(1)
  })
})

// Multiple notifications to same user accumulate

describe('Notification — multiple notifications to same user', () => {
  test('sending two different notifications to same user accumulates records', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('Alice'))
    await notify.send('u1', new AlertNotification('disk full'))
    const sent = notify.getSent()
    const forU1 = sent.filter(r => r.userId === 'u1')
    // WelcomeNotification uses mail+log (2 records), AlertNotification uses database+push (2 records)
    expect(forU1.length).toBeGreaterThanOrEqual(4)
  })

  test('records from different notifications are distinguishable by class', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    await notify.send('u1', new AlertNotification('test'))
    const sent = notify.getSent()
    expect(sent.some(r => r.notification instanceof LogOnlyNotification)).toBe(true)
    expect(sent.some(r => r.notification instanceof AlertNotification)).toBe(true)
  })
})

// BaseNotification — default via returns ['log']

describe('BaseNotification — default via()', () => {
  test('bare subclass with no override returns ["log"]', () => {
    class MinimalNotification extends BaseNotification {}
    expect(new MinimalNotification().via()).toEqual(['log'])
  })

  test('via() ignores userId argument when no userId-aware logic is present', () => {
    class MinimalNotification extends BaseNotification {}
    expect(new MinimalNotification().via('any-user')).toEqual(['log'])
  })

  test('subclass can override via() to return different channels', () => {
    class CustomChannelNotification extends BaseNotification {
      via(): ChannelName[] { return ['mail', 'database'] }
    }
    expect(new CustomChannelNotification().via()).toEqual(['mail', 'database'])
  })
})


describe('Notification — single channel notifications', () => {
  test('mail-only notification records single mail record', async () => {
    class MailOnly extends BaseNotification {
      via(): ChannelName[] { return ['mail'] }
      toMail(): MailPayload { return { to: 'a@b.com', subject: 'Hi' } }
    }
    const notify = makeFakeNotify()
    await notify.send('u1', new MailOnly())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('mail')
  })

  test('push-only notification records single push record', async () => {
    class PushOnly extends BaseNotification {
      via(): ChannelName[] { return ['push'] }
      toPush(): PushPayload { return { title: 'Alert', body: 'Hello' } }
    }
    const notify = makeFakeNotify()
    await notify.send('u1', new PushOnly())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('push')
  })

  test('database-only notification records single db record', async () => {
    class DbOnly extends BaseNotification {
      via(): ChannelName[] { return ['database'] }
      toDatabase(): DatabasePayload { return { type: 'info', title: 'T', body: 'B' } }
    }
    const notify = makeFakeNotify()
    await notify.send('u1', new DbOnly())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('database')
  })
})

describe('Notification — sendMany with multi-channel', () => {
  test('sendMany to 3 users with 2-channel notification creates 6 records', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany(['u1', 'u2', 'u3'], new WelcomeNotification('Test'))
    // WelcomeNotification uses ['mail', 'log'] = 2 channels per user
    expect(notify.getSent()).toHaveLength(6)
  })

  test('sendMany to 2 users with 4-channel notification creates 8 records', async () => {
    const notify = makeFakeNotify()
    await notify.sendMany(['u1', 'u2'], new MultiChannelNotification())
    expect(notify.getSent()).toHaveLength(8)
  })

  test('sendMany accumulates with prior sends', async () => {
    const notify = makeFakeNotify()
    await notify.send('u0', new LogOnlyNotification())
    await notify.sendMany(['u1', 'u2'], new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(3)
  })
})

describe('Notification — channel forced routing additional', () => {
  test('forced database channel on alert records database payload', async () => {
    const notify = makeFakeNotify()
    await notify.channel('database').send('u1', new AlertNotification('test'))
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('database')
    expect((sent[0].payload as DatabasePayload).body).toBe('test')
  })

  test('forced channel does not produce records for original via channels', async () => {
    const notify = makeFakeNotify()
    // WelcomeNotification.via() = ['mail', 'log'], force 'push' only
    await notify.channel('push').send('u1', new WelcomeNotification('Z'))
    const channels = notify.getSent().map(r => r.channel)
    expect(channels).toEqual(['push'])
    expect(channels).not.toContain('mail')
    expect(channels).not.toContain('log')
  })
})

describe('Notification.assertSent — additional edge cases', () => {
  test('assertSent after multiple sends finds the right one', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    await notify.send('u2', new WelcomeNotification('A'))
    await notify.send('u3', new AlertNotification('B'))
    expect(() => notify.assertSent(WelcomeNotification, 'mail', 'u2')).not.toThrow()
  })

  test('assertSent with log channel on WelcomeNotification passes', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('X'))
    expect(() => notify.assertSent(WelcomeNotification, 'log')).not.toThrow()
  })

  test('assertSent with database channel on AlertNotification passes', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('Y'))
    expect(() => notify.assertSent(AlertNotification, 'database')).not.toThrow()
  })

  test('assertSent with push channel on AlertNotification passes', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('Z'))
    expect(() => notify.assertSent(AlertNotification, 'push')).not.toThrow()
  })

  test('assertSent with wrong channel for multi-channel throws', async () => {
    const notify = makeFakeNotify()
    // MultiChannelNotification uses all four channels but LogOnlyNotification uses only log
    await notify.send('u1', new LogOnlyNotification())
    expect(() => notify.assertSent(LogOnlyNotification, 'mail')).toThrow()
  })
})

describe('Notification — restore and re-fake cycle', () => {
  test('restore, fake, send, restore cycle works', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(1)
    notify.restore()
    notify.fake()
    expect(notify.getSent()).toHaveLength(0)
    await notify.send('u2', new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(1)
    notify.restore()
    expect(notify.getSent()).toHaveLength(0)
  })

  test('multiple fake() calls do not duplicate state', async () => {
    const notify = new Notification()
    notify.fake()
    notify.fake()
    await notify.send('u1', new LogOnlyNotification())
    expect(notify.getSent()).toHaveLength(1)
    notify.restore()
  })

  test('getSent returns empty array on brand new fake instance', () => {
    const notify = makeFakeNotify()
    expect(notify.getSent()).toEqual([])
  })
})

describe('Notification — payload correctness', () => {
  test('mail payload has to, subject fields', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('PayloadTest'))
    const mail = notify.getSent().find(r => r.channel === 'mail')
    const payload = mail!.payload as MailPayload
    expect(payload).toHaveProperty('to')
    expect(payload).toHaveProperty('subject')
  })

  test('database payload has type, title, body fields', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('db test'))
    const db = notify.getSent().find(r => r.channel === 'database')
    const payload = db!.payload as DatabasePayload
    expect(payload).toHaveProperty('type')
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('body')
  })

  test('push payload has title and body fields', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('push test'))
    const push = notify.getSent().find(r => r.channel === 'push')
    const payload = push!.payload as PushPayload
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('body')
  })

  test('log payload is a string', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('LogTest'))
    const log = notify.getSent().find(r => r.channel === 'log')
    expect(typeof log!.payload).toBe('string')
  })

  test('sent record has userId, channel, notification, payload', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    const record = notify.getSent()[0]
    expect(record).toHaveProperty('userId')
    expect(record).toHaveProperty('channel')
    expect(record).toHaveProperty('notification')
    expect(record).toHaveProperty('payload')
  })

  test('notification reference on sent record is the same instance', async () => {
    const notify = makeFakeNotify()
    const n = new LogOnlyNotification()
    await notify.send('u1', n)
    expect(notify.getSent()[0].notification).toBe(n)
  })

  test('userId on sent record matches what was passed', async () => {
    const notify = makeFakeNotify()
    await notify.send('specific-user-id', new LogOnlyNotification())
    expect(notify.getSent()[0].userId).toBe('specific-user-id')
  })

  test('channel on sent record matches via() output', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())
    expect(notify.getSent()[0].channel).toBe('log')
  })
})

// Additional edge-case tests

describe('Notification — channel routing with various notification types', () => {
  test('channel().send() with mail on MultiChannelNotification only records mail', async () => {
    const notify = makeFakeNotify()
    await notify.channel('mail').send('u1', new MultiChannelNotification())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('mail')
    expect((sent[0].payload as MailPayload).subject).toBe('Multi')
  })

  test('channel().send() with database on MultiChannelNotification only records database', async () => {
    const notify = makeFakeNotify()
    await notify.channel('database').send('u1', new MultiChannelNotification())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('database')
    expect((sent[0].payload as DatabasePayload).type).toBe('multi')
  })

  test('channel().send() with log on WelcomeNotification records log payload', async () => {
    const notify = makeFakeNotify()
    await notify.channel('log').send('u1', new WelcomeNotification('Test'))
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('log')
    expect(sent[0].payload).toBe('Welcome email queued for Test')
  })
})

describe('Notification — mail payload content verification', () => {
  test('mail payload html field is set correctly', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('HtmlTest'))
    const mail = notify.getSent().find(r => r.channel === 'mail')
    expect((mail!.payload as MailPayload).html).toBe('<h1>Hello, HtmlTest</h1>')
  })

  test('mail payload to field is derived from userName', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('UserName'))
    const mail = notify.getSent().find(r => r.channel === 'mail')
    expect((mail!.payload as MailPayload).to).toBe('UserName@example.com')
  })
})

describe('Notification — database payload content verification', () => {
  test('database payload title is set correctly', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('disk'))
    const db = notify.getSent().find(r => r.channel === 'database')
    expect((db!.payload as DatabasePayload).title).toBe('Alert')
  })

  test('database payload type reflects notification type', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('x'))
    const db = notify.getSent().find(r => r.channel === 'database')
    expect((db!.payload as DatabasePayload).type).toBe('alert')
  })
})

describe('Notification — push payload content verification', () => {
  test('push payload title and body match alert message', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new AlertNotification('server down'))
    const push = notify.getSent().find(r => r.channel === 'push')
    expect((push!.payload as PushPayload).title).toBe('Alert')
    expect((push!.payload as PushPayload).body).toBe('server down')
  })
})

describe('Notification — sendMany with forced channel', () => {
  test('sendMany does not support channel() but individual sends do', async () => {
    const notify = makeFakeNotify()
    // Send to multiple users via forced channel one at a time
    for (const uid of ['u1', 'u2', 'u3']) {
      await notify.channel('push').send(uid, new AlertNotification('batch'))
    }
    const sent = notify.getSent()
    expect(sent).toHaveLength(3)
    expect(sent.every(r => r.channel === 'push')).toBe(true)
    expect(sent.map(r => r.userId)).toEqual(['u1', 'u2', 'u3'])
  })
})

describe('Notification — assertSent with multiple notification classes', () => {
  test('assertSent distinguishes between different classes sent to same user', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('A'))
    await notify.send('u1', new AlertNotification('B'))
    await notify.send('u1', new LogOnlyNotification())
    expect(() => notify.assertSent(WelcomeNotification, 'mail', 'u1')).not.toThrow()
    expect(() => notify.assertSent(AlertNotification, 'database', 'u1')).not.toThrow()
    expect(() => notify.assertSent(LogOnlyNotification, 'log', 'u1')).not.toThrow()
  })

  test('assertSent throws for class never sent even when others were', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new WelcomeNotification('A'))
    await notify.send('u2', new AlertNotification('B'))
    expect(() => notify.assertSent(MultiChannelNotification)).toThrow()
  })
})

describe('Notification — BaseNotification subclass with custom via per user', () => {
  test('notification routed to different channels based on userId', async () => {
    class PriorityNotification extends BaseNotification {
      via(userId?: string): ChannelName[] {
        if (userId === 'admin') return ['mail', 'push', 'database']
        return ['log']
      }
      toMail(): MailPayload { return { to: 'admin@co.com', subject: 'Priority' } }
      toPush(): PushPayload { return { title: 'Priority', body: 'Urgent' } }
      toDatabase(): DatabasePayload { return { type: 'priority', title: 'P', body: 'Urgent' } }
      toLog(): string { return 'priority-log' }
    }

    const notify = makeFakeNotify()
    await notify.send('admin', new PriorityNotification())
    await notify.send('user', new PriorityNotification())

    const adminRecords = notify.getSent().filter(r => r.userId === 'admin')
    const userRecords = notify.getSent().filter(r => r.userId === 'user')
    expect(adminRecords).toHaveLength(3)
    expect(adminRecords.map(r => r.channel).sort()).toEqual(['database', 'mail', 'push'])
    expect(userRecords).toHaveLength(1)
    expect(userRecords[0].channel).toBe('log')
  })
})

describe('Notification — fake mode log channel fallback', () => {
  test('log channel uses constructor name when toLog is not defined', async () => {
    class NoLogMethod extends BaseNotification {
      via(): ChannelName[] { return ['log'] }
    }
    const notify = makeFakeNotify()
    await notify.send('u1', new NoLogMethod())
    const sent = notify.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toBe('NoLogMethod')
  })
})

describe('Notification — getSent after interleaved sends and channel forces', () => {
  test('interleaved send and channel().send accumulate correctly', async () => {
    const notify = makeFakeNotify()
    await notify.send('u1', new LogOnlyNotification())           // 1 record (log)
    await notify.channel('mail').send('u2', new WelcomeNotification('X')) // 1 record (mail)
    await notify.send('u3', new WelcomeNotification('Y'))        // 2 records (mail+log)
    const sent = notify.getSent()
    expect(sent).toHaveLength(4)
    expect(sent[0].userId).toBe('u1')
    expect(sent[1].userId).toBe('u2')
    expect(sent.filter(r => r.userId === 'u3')).toHaveLength(2)
  })
})
