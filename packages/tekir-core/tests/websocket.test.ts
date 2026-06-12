import { test, expect, describe } from 'bun:test'
import { WsManager } from '../src/ws/index'

// Mock helpers

function mockWs(data: any = {}): any {
  const sent: string[] = []
  const subscribed: string[] = []
  const published: Array<{ topic: string; data: string }> = []
  return {
    data,
    sent,
    subscribed,
    published,
    readyState: 1,
    remoteAddress: '127.0.0.1',
    send(msg: string) { sent.push(msg) },
    close() {},
    subscribe(topic: string) { subscribed.push(topic) },
    unsubscribe(topic: string) { const i = subscribed.indexOf(topic); if (i >= 0) subscribed.splice(i, 1) },
    publish(topic: string, msg: string) { published.push({ topic, data: msg }) },
    isSubscribed(topic: string) { return subscribed.includes(topic) },
    cork(cb: () => void) { cb() },
  }
}

function mockServer() {
  let lastUpgradeData: any = null
  return {
    upgrade(req: any, opts: any) { lastUpgradeData = opts.data; return true },
    get lastData() { return lastUpgradeData },
  }
}

function mockRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { headers })
}

// WsManager — route registration

describe('WsManager — route registration', () => {
  test('hasRoutes() returns false initially', () => {
    const wm = new WsManager()
    expect(wm.hasRoutes()).toBe(false)
  })

  test('hasRoutes() returns true after route()', () => {
    const wm = new WsManager()
    wm.route('/ws/test', {})
    expect(wm.hasRoutes()).toBe(true)
  })

  test('route() is chainable', () => {
    const wm = new WsManager()
    const result = wm.route('/ws/a', {}).route('/ws/b', {})
    expect(result).toBe(wm)
  })

  test('multiple routes are registered', () => {
    const wm = new WsManager()
    wm.route('/ws/a', {}).route('/ws/b', {}).route('/ws/c', {})
    expect(wm.hasRoutes()).toBe(true)
  })
})

// WsManager.build() — upgradeHandler

describe('WsManager — upgradeHandler', () => {
  test('upgrades matching path', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', { open(ws) {} })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    const result = await upgradeHandler(mockRequest('/ws/chat'), server)

    expect(result).toBeUndefined() // successful upgrade returns undefined
    expect(server.lastData.__wsPath).toBe('/ws/chat')
  })

  test('returns undefined for non-matching path', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', {})

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    const result = await upgradeHandler(mockRequest('/ws/other'), server)

    expect(result).toBeUndefined()
    expect(server.lastData).toBeNull()
  })

  test('upgrade() callback data is passed to ws.data', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', {
      upgrade(req) {
        return { userId: 42, room: 'general' }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/chat'), server)

    expect(server.lastData.userId).toBe(42)
    expect(server.lastData.room).toBe('general')
  })

  test('upgrade() can read query params from request', async () => {
    const wm = new WsManager()
    wm.route('/ws/room', {
      upgrade(req) {
        const url = new URL(req.url)
        return { room: url.searchParams.get('room') || 'lobby' }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/room?room=vip'), server)

    expect(server.lastData.room).toBe('vip')
  })

  test('upgrade() can read Authorization header', async () => {
    const wm = new WsManager()
    wm.route('/ws/private', {
      upgrade(req) {
        const token = req.headers.get('Authorization')
        return { token }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/private', { Authorization: 'Bearer abc123' }), server)

    expect(server.lastData.token).toBe('Bearer abc123')
  })

  test('async upgrade() is awaited', async () => {
    const wm = new WsManager()
    wm.route('/ws/async', {
      async upgrade(req) {
        await new Promise(r => setTimeout(r, 5))
        return { delayed: true }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/async'), server)

    expect(server.lastData.delayed).toBe(true)
  })

  test('no upgrade() callback → empty data object', async () => {
    const wm = new WsManager()
    wm.route('/ws/simple', { open() {} })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/simple'), server)

    expect(server.lastData.__wsPath).toBe('/ws/simple')
  })
})

// WsManager.build() — websocket callbacks

describe('WsManager — websocket callbacks', () => {
  test('open() fires for matched route', () => {
    const wm = new WsManager()
    let opened = false
    wm.route('/ws/test', {
      open() { opened = true },
    })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/test' }))

    expect(opened).toBe(true)
  })

  test('message() fires with correct data', () => {
    const wm = new WsManager()
    let received = ''
    wm.route('/ws/echo', {
      message(ws, msg) { received = String(msg) },
    })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/echo' }), 'hello')

    expect(received).toBe('hello')
  })

  test('close() fires with code and reason', () => {
    const wm = new WsManager()
    let closedCode = 0
    let closedReason = ''
    wm.route('/ws/test', {
      close(ws, code, reason) { closedCode = code; closedReason = reason },
    })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/test' }), 1000, 'normal')

    expect(closedCode).toBe(1000)
    expect(closedReason).toBe('normal')
  })

  test('drain() fires', () => {
    const wm = new WsManager()
    let drained = false
    wm.route('/ws/stream', {
      drain() { drained = true },
    })

    const { websocket } = wm.build()
    websocket.drain(mockWs({ __wsPath: '/ws/stream' }))

    expect(drained).toBe(true)
  })

  test('callbacks do not fire for wrong path', () => {
    const wm = new WsManager()
    let opened = false
    wm.route('/ws/a', { open() { opened = true } })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/b' }))

    expect(opened).toBe(false)
  })

  test('ws.data from upgrade() is accessible in open()', () => {
    const wm = new WsManager()
    let userName = ''
    wm.route('/ws/user', {
      open(ws) { userName = ws.data.name },
    })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/user', name: 'Alice' }))

    expect(userName).toBe('Alice')
  })

  test('ws.send() works in open callback', () => {
    const wm = new WsManager()
    wm.route('/ws/greet', {
      open(ws) { ws.send('welcome') },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/greet' })
    websocket.open(ws)

    expect(ws.sent).toEqual(['welcome'])
  })

  test('ws.publish() works in message callback', () => {
    const wm = new WsManager()
    wm.route('/ws/broadcast', {
      message(ws, msg) { ws.publish('room', String(msg)) },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/broadcast' })
    websocket.message(ws, 'hi everyone')

    expect(ws.published).toEqual([{ topic: 'room', data: 'hi everyone' }])
  })

  test('ws.subscribe() and ws.isSubscribed() work', () => {
    const ws = mockWs({ __wsPath: '/ws/sub' })
    ws.subscribe('news')
    expect(ws.isSubscribed('news')).toBe(true)
    ws.unsubscribe('news')
    expect(ws.isSubscribed('news')).toBe(false)
  })
})

// Path matching — exact and params

describe('WsManager — path matching', () => {
  test('exact path match', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', { upgrade: () => ({ matched: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/chat'), server)
    expect(server.lastData.matched).toBe(true)
  })

  test('param path :id matches any segment', async () => {
    const wm = new WsManager()
    wm.route('/ws/:roomId', {
      upgrade(req) {
        const roomId = new URL(req.url).pathname.split('/')[2]
        return { roomId }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/abc123'), server)
    expect(server.lastData.roomId).toBe('abc123')
  })

  test('param path does not match different depth', async () => {
    const wm = new WsManager()
    wm.route('/ws/:id', { upgrade: () => ({ ok: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/a/b'), server)
    expect(server.lastData).toBeNull()
  })

  test('multiple routes — first match wins', async () => {
    const wm = new WsManager()
    wm.route('/ws/specific', { upgrade: () => ({ route: 'specific' }) })
    wm.route('/ws/:id', { upgrade: () => ({ route: 'param' }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/specific'), server)
    expect(server.lastData.route).toBe('specific')
  })

  test('param route matches when specific does not', async () => {
    const wm = new WsManager()
    wm.route('/ws/specific', { upgrade: () => ({ route: 'specific' }) })
    wm.route('/ws/:id', { upgrade: () => ({ route: 'param' }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/other'), server)
    expect(server.lastData.route).toBe('param')
  })
})

// Auth scenarios via upgrade()

describe('WsManager — auth in upgrade()', () => {
  test('token from query param sets user data', async () => {
    const wm = new WsManager()
    const users: Record<string, any> = {
      'valid-token': { id: 1, name: 'Alice' },
    }

    wm.route('/ws/private', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token')
        if (!token || !users[token]) return null
        return users[token]
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()

    // Valid token
    await upgradeHandler(mockRequest('/ws/private?token=valid-token'), server)
    expect(server.lastData.name).toBe('Alice')
  })

  test('missing token — upgrade still called but data has no userId', async () => {
    const wm = new WsManager()
    wm.route('/ws/private', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token')
        if (!token) return { authenticated: false }
        return { authenticated: true, userId: 1 }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/private'), server)
    expect(server.lastData.authenticated).toBe(false)
    expect(server.lastData.userId).toBeUndefined()
  })

  test('invalid token — upgrade returns unauthenticated data', async () => {
    const wm = new WsManager()
    wm.route('/ws/private', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token')
        if (token !== 'secret') return { authenticated: false }
        return { authenticated: true, userId: 1 }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/private?token=wrong'), server)
    expect(server.lastData.authenticated).toBe(false)
  })

  test('authenticated user data flows to open/message callbacks', () => {
    const wm = new WsManager()
    let openUserId: number | undefined
    let msgUserId: number | undefined

    wm.route('/ws/auth', {
      open(ws) { openUserId = ws.data?.userId },
      message(ws) { msgUserId = ws.data?.userId },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/auth', userId: 42 })

    websocket.open(ws)
    expect(openUserId).toBe(42)

    websocket.message(ws, 'hi')
    expect(msgUserId).toBe(42)
  })

  test('null data from upgrade() handled gracefully in open', () => {
    const wm = new WsManager()
    let closeCalled = false

    wm.route('/ws/guard', {
      open(ws) {
        if (!ws.data?.userId) {
          ws.close()
          closeCalled = true
        }
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/guard' }) // no userId
    websocket.open(ws)
    expect(closeCalled).toBe(true)
  })
})

// Chat room full scenario

describe('WsManager — chat room scenario', () => {
  test('full chat flow: join, message, leave', () => {
    const wm = new WsManager()
    const events: string[] = []

    wm.route('/ws/chat', {
      open(ws) {
        ws.subscribe(ws.data.room)
        events.push(`join:${ws.data.room}`)
      },
      message(ws, msg) {
        ws.publish(ws.data.room, String(msg))
        events.push(`msg:${msg}`)
      },
      close(ws) {
        ws.unsubscribe(ws.data.room)
        events.push(`leave:${ws.data.room}`)
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/chat', room: 'general', userId: 1 })

    websocket.open(ws)
    expect(ws.subscribed).toContain('general')

    websocket.message(ws, 'hello everyone')
    expect(ws.published[0]).toEqual({ topic: 'general', data: 'hello everyone' })

    websocket.close(ws, 1000, 'bye')
    expect(ws.isSubscribed('general')).toBe(false)

    expect(events).toEqual(['join:general', 'msg:hello everyone', 'leave:general'])
  })

  test('multiple users in same room', () => {
    const wm = new WsManager()
    wm.route('/ws/chat', {
      open(ws) { ws.subscribe(ws.data.room) },
      message(ws, msg) { ws.publish(ws.data.room, `${ws.data.name}: ${msg}`) },
    })

    const { websocket } = wm.build()
    const alice = mockWs({ __wsPath: '/ws/chat', room: 'dev', name: 'Alice' })
    const bob = mockWs({ __wsPath: '/ws/chat', room: 'dev', name: 'Bob' })

    websocket.open(alice)
    websocket.open(bob)

    websocket.message(alice, 'hi')
    expect(alice.published[0]).toEqual({ topic: 'dev', data: 'Alice: hi' })

    websocket.message(bob, 'hey')
    expect(bob.published[0]).toEqual({ topic: 'dev', data: 'Bob: hey' })
  })

  test('users in different rooms are isolated', () => {
    const wm = new WsManager()
    wm.route('/ws/chat', {
      open(ws) { ws.subscribe(ws.data.room) },
      message(ws, msg) { ws.publish(ws.data.room, String(msg)) },
    })

    const { websocket } = wm.build()
    const alice = mockWs({ __wsPath: '/ws/chat', room: 'room-a' })
    const bob = mockWs({ __wsPath: '/ws/chat', room: 'room-b' })

    websocket.open(alice)
    websocket.open(bob)

    websocket.message(alice, 'only room-a')
    expect(alice.published[0].topic).toBe('room-a')
    expect(bob.published.length).toBe(0)
  })
})

// ws.cork() batching

describe('WsManager — cork batching', () => {
  test('cork() executes callback synchronously', () => {
    const ws = mockWs({})
    ws.cork(() => {
      ws.send('a')
      ws.send('b')
    })
    expect(ws.sent).toEqual(['a', 'b'])
  })
})

// Multiple routes isolation

describe('WsManager — multiple routes isolation', () => {
  test('message to route A does not trigger route B open', () => {
    const wm = new WsManager()
    let openedA = false
    let openedB = false
    wm.route('/ws/a', { open() { openedA = true } })
    wm.route('/ws/b', { open() { openedB = true } })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/a' }))

    expect(openedA).toBe(true)
    expect(openedB).toBe(false)
  })

  test('message to route B does not trigger route A message handler', () => {
    const wm = new WsManager()
    let msgA = ''
    let msgB = ''
    wm.route('/ws/a', { message(ws, msg) { msgA = String(msg) } })
    wm.route('/ws/b', { message(ws, msg) { msgB = String(msg) } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/b' }), 'hello')

    expect(msgA).toBe('')
    expect(msgB).toBe('hello')
  })

  test('each route has independent close callbacks', () => {
    const wm = new WsManager()
    let closedA = false
    let closedB = false
    wm.route('/ws/a', { close() { closedA = true } })
    wm.route('/ws/b', { close() { closedB = true } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/a' }), 1000, '')

    expect(closedA).toBe(true)
    expect(closedB).toBe(false)
  })

  test('3+ routes registered all work independently', () => {
    const wm = new WsManager()
    const opened: string[] = []
    wm.route('/ws/a', { open() { opened.push('a') } })
    wm.route('/ws/b', { open() { opened.push('b') } })
    wm.route('/ws/c', { open() { opened.push('c') } })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/c' }))
    websocket.open(mockWs({ __wsPath: '/ws/a' }))

    expect(opened).toEqual(['c', 'a'])
  })

  test('route order matters — first registered route matched first', async () => {
    const wm = new WsManager()
    wm.route('/ws/:id', { upgrade: () => ({ route: 'param' }) })
    wm.route('/ws/fixed', { upgrade: () => ({ route: 'fixed' }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/fixed'), server)
    // param route registered first so it matches first
    expect(server.lastData.route).toBe('param')
  })

  test('drain on route A does not fire drain on route B', () => {
    const wm = new WsManager()
    let drainedA = false
    let drainedB = false
    wm.route('/ws/a', { drain() { drainedA = true } })
    wm.route('/ws/b', { drain() { drainedB = true } })

    const { websocket } = wm.build()
    websocket.drain(mockWs({ __wsPath: '/ws/b' }))

    expect(drainedA).toBe(false)
    expect(drainedB).toBe(true)
  })

  test('open on unregistered path fires nothing', () => {
    const wm = new WsManager()
    let opened = false
    wm.route('/ws/a', { open() { opened = true } })
    wm.route('/ws/b', { open() { opened = true } })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/unknown' }))

    expect(opened).toBe(false)
  })

  test('message on unregistered path fires nothing', () => {
    const wm = new WsManager()
    let received = false
    wm.route('/ws/a', { message() { received = true } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/nope' }), 'test')

    expect(received).toBe(false)
  })
})

// Upgrade data varieties

describe('WsManager — upgrade data varieties', () => {
  test('upgrade returns empty object', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({}) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.__wsPath).toBe('/ws/t')
  })

  test('upgrade returns large data object', async () => {
    const wm = new WsManager()
    const bigData: Record<string, number> = {}
    for (let i = 0; i < 100; i++) bigData[`key${i}`] = i
    wm.route('/ws/t', { upgrade: () => bigData })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.key99).toBe(99)
  })

  test('upgrade returns nested objects', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ user: { profile: { name: 'Test' } } }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.user.profile.name).toBe('Test')
  })

  test('upgrade returns arrays', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ roles: ['admin', 'user'] }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.roles).toEqual(['admin', 'user'])
  })

  test('upgrade returns numeric values', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ count: 0, pi: 3.14, neg: -1 }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.count).toBe(0)
    expect(server.lastData.pi).toBe(3.14)
    expect(server.lastData.neg).toBe(-1)
  })

  test('upgrade returns boolean values', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ active: true, banned: false }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.active).toBe(true)
    expect(server.lastData.banned).toBe(false)
  })

  test('upgrade returns undefined properties', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ name: undefined, age: 25 }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.name).toBeUndefined()
    expect(server.lastData.age).toBe(25)
  })

  test('upgrade returning a Promise resolves correctly', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      upgrade: () => Promise.resolve({ fromPromise: true }),
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.fromPromise).toBe(true)
  })
})

// Message handling

describe('WsManager — message handling', () => {
  test('string message passed correctly', () => {
    const wm = new WsManager()
    let received: any = null
    wm.route('/ws/m', { message(ws, msg) { received = msg } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), 'hello world')
    expect(received).toBe('hello world')
  })

  test('JSON string message can be parsed in handler', () => {
    const wm = new WsManager()
    let parsed: any = null
    wm.route('/ws/m', { message(ws, msg) { parsed = JSON.parse(String(msg)) } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), JSON.stringify({ type: 'ping' }))
    expect(parsed.type).toBe('ping')
  })

  test('empty string message', () => {
    const wm = new WsManager()
    let received: any = null
    wm.route('/ws/m', { message(ws, msg) { received = String(msg) } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), '')
    expect(received).toBe('')
  })

  test('very long message', () => {
    const wm = new WsManager()
    let len = 0
    wm.route('/ws/m', { message(ws, msg) { len = String(msg).length } })

    const { websocket } = wm.build()
    const longMsg = 'x'.repeat(100_000)
    websocket.message(mockWs({ __wsPath: '/ws/m' }), longMsg)
    expect(len).toBe(100_000)
  })

  test('multiple messages in sequence', () => {
    const wm = new WsManager()
    const msgs: string[] = []
    wm.route('/ws/m', { message(ws, msg) { msgs.push(String(msg)) } })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m' })
    websocket.message(ws, 'first')
    websocket.message(ws, 'second')
    websocket.message(ws, 'third')
    expect(msgs).toEqual(['first', 'second', 'third'])
  })

  test('message handler can modify ws.data', () => {
    const wm = new WsManager()
    wm.route('/ws/m', {
      message(ws, msg) { ws.data.lastMessage = String(msg) },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m' })
    websocket.message(ws, 'update')
    expect(ws.data.lastMessage).toBe('update')
  })

  test('binary-like Buffer message', () => {
    const wm = new WsManager()
    let received: any = null
    wm.route('/ws/m', { message(ws, msg) { received = msg } })

    const { websocket } = wm.build()
    const buf = Buffer.from('binary data')
    websocket.message(mockWs({ __wsPath: '/ws/m' }), buf)
    expect(Buffer.isBuffer(received)).toBe(true)
  })

  test('message broadcasting to multiple topics', () => {
    const wm = new WsManager()
    wm.route('/ws/m', {
      open(ws) {
        ws.subscribe('topic-a')
        ws.subscribe('topic-b')
      },
      message(ws, msg) {
        ws.publish('topic-a', String(msg))
        ws.publish('topic-b', String(msg))
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m' })
    websocket.open(ws)
    websocket.message(ws, 'broadcast')
    expect(ws.published).toEqual([
      { topic: 'topic-a', data: 'broadcast' },
      { topic: 'topic-b', data: 'broadcast' },
    ])
  })

  test('message handler sends reply via ws.send', () => {
    const wm = new WsManager()
    wm.route('/ws/m', {
      message(ws, msg) { ws.send(`echo: ${msg}`) },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m' })
    websocket.message(ws, 'test')
    expect(ws.sent).toEqual(['echo: test'])
  })

  test('message with special characters', () => {
    const wm = new WsManager()
    let received = ''
    wm.route('/ws/m', { message(ws, msg) { received = String(msg) } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), '{"emoji":"🎉","html":"<b>bold</b>"}')
    expect(received).toContain('🎉')
  })
})

// Pub/sub advanced

describe('WsManager — pub/sub advanced', () => {
  test('subscribe to multiple topics', () => {
    const ws = mockWs({})
    ws.subscribe('news')
    ws.subscribe('alerts')
    ws.subscribe('updates')
    expect(ws.isSubscribed('news')).toBe(true)
    expect(ws.isSubscribed('alerts')).toBe(true)
    expect(ws.isSubscribed('updates')).toBe(true)
  })

  test('publish to topic not subscribed to', () => {
    const ws = mockWs({})
    ws.publish('unsubbed', 'hello')
    expect(ws.published).toEqual([{ topic: 'unsubbed', data: 'hello' }])
  })

  test('unsubscribe then publish does not error', () => {
    const ws = mockWs({})
    ws.subscribe('ch')
    ws.unsubscribe('ch')
    expect(ws.isSubscribed('ch')).toBe(false)
    ws.publish('ch', 'msg')
    expect(ws.published.length).toBe(1) // publish still works, just not subscribed
  })

  test('subscribe same topic twice', () => {
    const ws = mockWs({})
    ws.subscribe('dup')
    ws.subscribe('dup')
    expect(ws.subscribed).toEqual(['dup', 'dup'])
    expect(ws.isSubscribed('dup')).toBe(true)
  })

  test('publish from open callback', () => {
    const wm = new WsManager()
    wm.route('/ws/pub', {
      open(ws) {
        ws.subscribe('lobby')
        ws.publish('lobby', 'user joined')
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/pub' })
    websocket.open(ws)
    expect(ws.published).toEqual([{ topic: 'lobby', data: 'user joined' }])
  })

  test('publish JSON objects as strings', () => {
    const ws = mockWs({})
    const payload = JSON.stringify({ type: 'event', data: [1, 2, 3] })
    ws.publish('events', payload)
    expect(JSON.parse(ws.published[0].data)).toEqual({ type: 'event', data: [1, 2, 3] })
  })

  test('empty topic name', () => {
    const ws = mockWs({})
    ws.subscribe('')
    expect(ws.isSubscribed('')).toBe(true)
    ws.publish('', 'msg')
    expect(ws.published[0].topic).toBe('')
  })

  test('topic with special characters', () => {
    const ws = mockWs({})
    const topic = 'room:123/sub#channel'
    ws.subscribe(topic)
    expect(ws.isSubscribed(topic)).toBe(true)
    ws.publish(topic, 'data')
    expect(ws.published[0].topic).toBe(topic)
  })

  test('batch publish via cork', () => {
    const wm = new WsManager()
    wm.route('/ws/batch', {
      message(ws, msg) {
        ws.cork(() => {
          ws.publish('a', 'one')
          ws.publish('b', 'two')
          ws.publish('c', 'three')
        })
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/batch' })
    websocket.message(ws, 'go')
    expect(ws.published).toEqual([
      { topic: 'a', data: 'one' },
      { topic: 'b', data: 'two' },
      { topic: 'c', data: 'three' },
    ])
  })

  test('unsubscribe from topic not subscribed to is safe', () => {
    const ws = mockWs({})
    ws.unsubscribe('nonexistent')
    expect(ws.isSubscribed('nonexistent')).toBe(false)
  })
})

// Close scenarios

describe('WsManager — close scenarios', () => {
  test('close code 1000 — normal closure', () => {
    const wm = new WsManager()
    let code = 0
    wm.route('/ws/c', { close(ws, c) { code = c } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1000, 'Normal Closure')
    expect(code).toBe(1000)
  })

  test('close code 1001 — going away', () => {
    const wm = new WsManager()
    let code = 0
    wm.route('/ws/c', { close(ws, c) { code = c } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1001, 'Going Away')
    expect(code).toBe(1001)
  })

  test('close code 1006 — abnormal closure', () => {
    const wm = new WsManager()
    let code = 0
    wm.route('/ws/c', { close(ws, c) { code = c } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1006, '')
    expect(code).toBe(1006)
  })

  test('close code 1008 — policy violation', () => {
    const wm = new WsManager()
    let code = 0
    wm.route('/ws/c', { close(ws, c) { code = c } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1008, 'Policy Violation')
    expect(code).toBe(1008)
  })

  test('close code 4000 — custom application code', () => {
    const wm = new WsManager()
    let code = 0
    let reason = ''
    wm.route('/ws/c', { close(ws, c, r) { code = c; reason = r } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 4000, 'Custom close')
    expect(code).toBe(4000)
    expect(reason).toBe('Custom close')
  })

  test('empty reason string', () => {
    const wm = new WsManager()
    let reason = 'not-set'
    wm.route('/ws/c', { close(ws, c, r) { reason = r } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1000, '')
    expect(reason).toBe('')
  })

  test('close without prior open does not error', () => {
    const wm = new WsManager()
    let closed = false
    wm.route('/ws/c', { close() { closed = true } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/c' }), 1000, '')
    expect(closed).toBe(true)
  })

  test('close triggers cleanup of all subscriptions', () => {
    const wm = new WsManager()
    wm.route('/ws/c', {
      open(ws) {
        ws.subscribe('room-1')
        ws.subscribe('room-2')
      },
      close(ws) {
        ws.unsubscribe('room-1')
        ws.unsubscribe('room-2')
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/c' })
    websocket.open(ws)
    expect(ws.isSubscribed('room-1')).toBe(true)
    expect(ws.isSubscribed('room-2')).toBe(true)

    websocket.close(ws, 1000, '')
    expect(ws.isSubscribed('room-1')).toBe(false)
    expect(ws.isSubscribed('room-2')).toBe(false)
  })
})

// Drain callback

describe('WsManager — drain callback', () => {
  test('drain fires for correct route', () => {
    const wm = new WsManager()
    let drained = false
    wm.route('/ws/d', { drain() { drained = true } })

    const { websocket } = wm.build()
    websocket.drain(mockWs({ __wsPath: '/ws/d' }))
    expect(drained).toBe(true)
  })

  test('drain with backpressure simulation — sends queued data', () => {
    const wm = new WsManager()
    const queued = ['msg1', 'msg2']
    wm.route('/ws/d', {
      drain(ws) {
        while (queued.length > 0) {
          ws.send(queued.shift()!)
        }
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/d' })
    websocket.drain(ws)
    expect(ws.sent).toEqual(['msg1', 'msg2'])
    expect(queued.length).toBe(0)
  })

  test('drain with no handler does not error', () => {
    const wm = new WsManager()
    wm.route('/ws/d', { open() {} }) // no drain handler

    const { websocket } = wm.build()
    expect(() => {
      websocket.drain(mockWs({ __wsPath: '/ws/d' }))
    }).not.toThrow()
  })

  test('multiple drain calls accumulate sends', () => {
    const wm = new WsManager()
    let callCount = 0
    wm.route('/ws/d', {
      drain(ws) {
        callCount++
        ws.send(`drain-${callCount}`)
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/d' })
    websocket.drain(ws)
    websocket.drain(ws)
    websocket.drain(ws)
    expect(callCount).toBe(3)
    expect(ws.sent).toEqual(['drain-1', 'drain-2', 'drain-3'])
  })
})

// Path matching edge cases

describe('WsManager — path matching edge cases', () => {
  test('trailing slash does not match path without trailing slash', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', { upgrade: () => ({ ok: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/chat/'), server)
    expect(server.lastData).toBeNull()
  })

  test('root path /ws matches', async () => {
    const wm = new WsManager()
    wm.route('/ws', { upgrade: () => ({ root: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws'), server)
    expect(server.lastData.root).toBe(true)
  })

  test('deeply nested path /ws/a/b/c matches', async () => {
    const wm = new WsManager()
    wm.route('/ws/a/b/c', { upgrade: () => ({ deep: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/a/b/c'), server)
    expect(server.lastData.deep).toBe(true)
  })

  test('multiple params /ws/:a/:b matches', async () => {
    const wm = new WsManager()
    wm.route('/ws/:a/:b', { upgrade: () => ({ matched: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/foo/bar'), server)
    expect(server.lastData.matched).toBe(true)
  })

  test('multiple params does not match wrong depth', async () => {
    const wm = new WsManager()
    wm.route('/ws/:a/:b', { upgrade: () => ({ matched: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/foo'), server)
    expect(server.lastData).toBeNull()
  })

  test('case sensitivity — paths are case-sensitive', async () => {
    const wm = new WsManager()
    wm.route('/ws/Chat', { upgrade: () => ({ matched: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/chat'), server)
    expect(server.lastData).toBeNull()
  })

  test('query string is ignored in path matching', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', { upgrade: () => ({ ok: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/chat?room=test&user=1'), server)
    expect(server.lastData.ok).toBe(true)
  })

  test('path with no leading slash does not match', async () => {
    const wm = new WsManager()
    wm.route('/ws/chat', { upgrade: () => ({ ok: true }) })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/other/chat'), server)
    expect(server.lastData).toBeNull()
  })
})

// Auth patterns

describe('WsManager — auth patterns', () => {
  test('role-based access in upgrade — admin allowed', async () => {
    const wm = new WsManager()
    const users: Record<string, { role: string }> = {
      'admin-token': { role: 'admin' },
      'user-token': { role: 'user' },
    }
    wm.route('/ws/admin', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token') || ''
        const user = users[token]
        return { role: user?.role || 'guest', allowed: user?.role === 'admin' }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/admin?token=admin-token'), server)
    expect(server.lastData.role).toBe('admin')
    expect(server.lastData.allowed).toBe(true)
  })

  test('role-based access in upgrade — user denied', async () => {
    const wm = new WsManager()
    wm.route('/ws/admin', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token') || ''
        const isAdmin = token === 'admin-token'
        return { allowed: isAdmin }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/admin?token=user-token'), server)
    expect(server.lastData.allowed).toBe(false)
  })

  test('user object passed through entire lifecycle', () => {
    const wm = new WsManager()
    const events: string[] = []
    wm.route('/ws/lifecycle', {
      open(ws) { events.push(`open:${ws.data.user.name}`) },
      message(ws, msg) { events.push(`msg:${ws.data.user.name}:${msg}`) },
      close(ws) { events.push(`close:${ws.data.user.name}`) },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/lifecycle', user: { name: 'Alice', id: 1 } })
    websocket.open(ws)
    websocket.message(ws, 'hi')
    websocket.close(ws, 1000, '')
    expect(events).toEqual(['open:Alice', 'msg:Alice:hi', 'close:Alice'])
  })

  test('token expiry check pattern', () => {
    const wm = new WsManager()
    let closedForExpiry = false
    wm.route('/ws/expiry', {
      open(ws) {
        const expiry = ws.data.tokenExpiry
        if (expiry < Date.now()) {
          ws.close()
          closedForExpiry = true
        }
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/expiry', tokenExpiry: 0 }) // already expired
    websocket.open(ws)
    expect(closedForExpiry).toBe(true)
  })

  test('auth via query param strategy', async () => {
    const wm = new WsManager()
    wm.route('/ws/auth', {
      upgrade(req) {
        const token = new URL(req.url).searchParams.get('token')
        return { strategy: 'query', token, authenticated: token === 'valid' }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/auth?token=valid'), server)
    expect(server.lastData.strategy).toBe('query')
    expect(server.lastData.authenticated).toBe(true)
  })

  test('auth via header strategy', async () => {
    const wm = new WsManager()
    wm.route('/ws/auth', {
      upgrade(req) {
        const header = req.headers.get('Authorization')
        return { strategy: 'header', authenticated: header === 'Bearer valid' }
      },
    })

    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/auth', { Authorization: 'Bearer valid' }), server)
    expect(server.lastData.strategy).toBe('header')
    expect(server.lastData.authenticated).toBe(true)
  })

  test('guest vs authenticated ws.data shape', () => {
    const wm = new WsManager()
    const shapes: string[] = []
    wm.route('/ws/shape', {
      open(ws) {
        shapes.push(ws.data.authenticated ? 'auth' : 'guest')
      },
    })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/shape', authenticated: false, name: 'Guest' }))
    websocket.open(mockWs({ __wsPath: '/ws/shape', authenticated: true, userId: 42, name: 'Alice' }))
    expect(shapes).toEqual(['guest', 'auth'])
  })

  test('close on unauthorized in open callback', () => {
    const wm = new WsManager()
    const sentMsg = ''
    wm.route('/ws/guard', {
      open(ws) {
        if (!ws.data.authenticated) {
          ws.send('unauthorized')
          ws.close()
        }
      },
    })

    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/guard', authenticated: false })
    websocket.open(ws)
    expect(ws.sent).toEqual(['unauthorized'])
  })

  test('admin-only room pattern — admin joins', () => {
    const wm = new WsManager()
    wm.route('/ws/room', {
      open(ws) {
        if (ws.data.role === 'admin') {
          ws.subscribe('admin-room')
          ws.send('welcome to admin room')
        } else {
          ws.send('access denied')
          ws.close()
        }
      },
    })

    const { websocket } = wm.build()
    const admin = mockWs({ __wsPath: '/ws/room', role: 'admin' })
    websocket.open(admin)
    expect(admin.subscribed).toContain('admin-room')
    expect(admin.sent).toEqual(['welcome to admin room'])
  })

  test('admin-only room pattern — non-admin rejected', () => {
    const wm = new WsManager()
    wm.route('/ws/room', {
      open(ws) {
        if (ws.data.role === 'admin') {
          ws.subscribe('admin-room')
          ws.send('welcome to admin room')
        } else {
          ws.send('access denied')
          ws.close()
        }
      },
    })

    const { websocket } = wm.build()
    const user = mockWs({ __wsPath: '/ws/room', role: 'user' })
    websocket.open(user)
    expect(user.subscribed).not.toContain('admin-room')
    expect(user.sent).toEqual(['access denied'])
  })
})

// Additional tests — WsManager edge cases

describe('WsManager — wildcard-like route patterns', () => {
  test('route with :id param matches any single segment', async () => {
    const wm = new WsManager()
    wm.route('/ws/user/:id', { upgrade: () => ({ param: true }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/user/42'), server)
    expect(server.lastData.param).toBe(true)
  })

  test('route with :id param does not match shorter path', async () => {
    const wm = new WsManager()
    wm.route('/ws/user/:id', { upgrade: () => ({ param: true }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/user'), server)
    expect(server.lastData).toBeNull()
  })

  test('route with two params matches two segments', async () => {
    const wm = new WsManager()
    wm.route('/ws/:a/:b', { upgrade: () => ({ two: true }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/x/y'), server)
    expect(server.lastData.two).toBe(true)
  })

  test('route with three params matches three segments', async () => {
    const wm = new WsManager()
    wm.route('/ws/:a/:b/:c', { upgrade: () => ({ three: true }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/1/2/3'), server)
    expect(server.lastData.three).toBe(true)
  })
})

describe('WsManager — multiple WS routes advanced', () => {
  test('four routes all fire independently', () => {
    const wm = new WsManager()
    const opened: string[] = []
    wm.route('/ws/a', { open() { opened.push('a') } })
    wm.route('/ws/b', { open() { opened.push('b') } })
    wm.route('/ws/c', { open() { opened.push('c') } })
    wm.route('/ws/d', { open() { opened.push('d') } })

    const { websocket } = wm.build()
    websocket.open(mockWs({ __wsPath: '/ws/d' }))
    websocket.open(mockWs({ __wsPath: '/ws/b' }))
    expect(opened).toEqual(['d', 'b'])
  })

  test('message to different routes fires correct handler', () => {
    const wm = new WsManager()
    const msgs: Record<string, string> = {}
    wm.route('/ws/chat', { message(ws, msg) { msgs.chat = String(msg) } })
    wm.route('/ws/feed', { message(ws, msg) { msgs.feed = String(msg) } })

    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/chat' }), 'hello chat')
    websocket.message(mockWs({ __wsPath: '/ws/feed' }), 'hello feed')
    expect(msgs.chat).toBe('hello chat')
    expect(msgs.feed).toBe('hello feed')
  })

  test('close on one route does not affect another', () => {
    const wm = new WsManager()
    let closedRoute = ''
    wm.route('/ws/x', { close() { closedRoute = 'x' } })
    wm.route('/ws/y', { close() { closedRoute = 'y' } })

    const { websocket } = wm.build()
    websocket.close(mockWs({ __wsPath: '/ws/x' }), 1000, '')
    expect(closedRoute).toBe('x')
  })
})

describe('WsManager — upgrade handler with various data types', () => {
  test('upgrade returns data with Date object', async () => {
    const wm = new WsManager()
    const now = new Date()
    wm.route('/ws/t', { upgrade: () => ({ connectedAt: now }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.connectedAt).toBe(now)
  })

  test('upgrade returns data with null value', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ val: null }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.val).toBeNull()
  })

  test('upgrade returns data with empty string', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ name: '' }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.name).toBe('')
  })

  test('upgrade returns data with deeply nested structure', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({ a: { b: { c: { d: 'deep' } } } }) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.a.b.c.d).toBe('deep')
  })
})

describe('WsManager — message handler with different data types', () => {
  test('numeric string message', () => {
    const wm = new WsManager()
    let received = ''
    wm.route('/ws/m', { message(ws, msg) { received = String(msg) } })
    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), '12345')
    expect(received).toBe('12345')
  })

  test('JSON array message can be parsed', () => {
    const wm = new WsManager()
    let parsed: any = null
    wm.route('/ws/m', { message(ws, msg) { parsed = JSON.parse(String(msg)) } })
    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), '[1,2,3]')
    expect(parsed).toEqual([1, 2, 3])
  })

  test('message with newlines', () => {
    const wm = new WsManager()
    let received = ''
    wm.route('/ws/m', { message(ws, msg) { received = String(msg) } })
    const { websocket } = wm.build()
    websocket.message(mockWs({ __wsPath: '/ws/m' }), 'line1\nline2\nline3')
    expect(received).toBe('line1\nline2\nline3')
  })

  test('message handler that echoes back JSON', () => {
    const wm = new WsManager()
    wm.route('/ws/m', {
      message(ws, msg) {
        const data = JSON.parse(String(msg))
        ws.send(JSON.stringify({ type: 'echo', ...data }))
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m' })
    websocket.message(ws, '{"hello":"world"}')
    const response = JSON.parse(ws.sent[0])
    expect(response.type).toBe('echo')
    expect(response.hello).toBe('world')
  })

  test('message handler accumulates state on ws.data', () => {
    const wm = new WsManager()
    wm.route('/ws/m', {
      open(ws) { ws.data.count = 0 },
      message(ws) { ws.data.count++ },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/m', count: 0 })
    websocket.open(ws)
    websocket.message(ws, 'a')
    websocket.message(ws, 'b')
    websocket.message(ws, 'c')
    expect(ws.data.count).toBe(3)
  })
})

describe('WsManager — build returns correct shape', () => {
  test('build returns object with upgradeHandler and websocket', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {})
    const result = wm.build()
    expect(result).toHaveProperty('upgradeHandler')
    expect(result).toHaveProperty('websocket')
  })

  test('upgradeHandler is a function', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {})
    const { upgradeHandler } = wm.build()
    expect(typeof upgradeHandler).toBe('function')
  })

  test('websocket has open, message, close, drain methods', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {})
    const { websocket } = wm.build()
    expect(typeof websocket.open).toBe('function')
    expect(typeof websocket.message).toBe('function')
    expect(typeof websocket.close).toBe('function')
    expect(typeof websocket.drain).toBe('function')
  })

  test('build on empty WsManager still returns valid shape', () => {
    const wm = new WsManager()
    const result = wm.build()
    expect(typeof result.upgradeHandler).toBe('function')
    expect(typeof result.websocket.open).toBe('function')
  })
})

describe('WsManager — open callback variations', () => {
  test('open sends welcome message based on data', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      open(ws) { ws.send(`Hello ${ws.data.name || 'Guest'}`) },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t', name: 'Alice' })
    websocket.open(ws)
    expect(ws.sent).toEqual(['Hello Alice'])
  })

  test('open subscribes to user-specific topic', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      open(ws) { ws.subscribe(`user:${ws.data.userId}`) },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t', userId: 42 })
    websocket.open(ws)
    expect(ws.isSubscribed('user:42')).toBe(true)
  })

  test('open without handler does not error', () => {
    const wm = new WsManager()
    wm.route('/ws/t', { message() {} }) // no open handler
    const { websocket } = wm.build()
    expect(() => websocket.open(mockWs({ __wsPath: '/ws/t' }))).not.toThrow()
  })

  test('open with cork batching', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      open(ws) {
        ws.cork(() => {
          ws.send('a')
          ws.send('b')
          ws.send('c')
        })
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.open(ws)
    expect(ws.sent).toEqual(['a', 'b', 'c'])
  })
})

describe('WsManager — close callback variations', () => {
  test('close unsubscribes from all topics', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      open(ws) {
        ws.subscribe('a')
        ws.subscribe('b')
      },
      close(ws) {
        ws.unsubscribe('a')
        ws.unsubscribe('b')
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.open(ws)
    expect(ws.isSubscribed('a')).toBe(true)
    websocket.close(ws, 1000, '')
    expect(ws.isSubscribed('a')).toBe(false)
    expect(ws.isSubscribed('b')).toBe(false)
  })

  test('close publishes leave notification', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      close(ws) {
        ws.publish('room', JSON.stringify({ type: 'leave', user: ws.data.name }))
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t', name: 'Bob' })
    websocket.close(ws, 1000, '')
    const msg = JSON.parse(ws.published[0].data)
    expect(msg.type).toBe('leave')
    expect(msg.user).toBe('Bob')
  })

  test('close without handler does not error', () => {
    const wm = new WsManager()
    wm.route('/ws/t', { open() {} }) // no close handler
    const { websocket } = wm.build()
    expect(() => websocket.close(mockWs({ __wsPath: '/ws/t' }), 1000, '')).not.toThrow()
  })
})

describe('WsManager — message handler advanced', () => {
  test('message handler increments counter on ws.data', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      message(ws) { ws.data.msgCount = (ws.data.msgCount || 0) + 1 },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.message(ws, 'a')
    websocket.message(ws, 'b')
    websocket.message(ws, 'c')
    expect(ws.data.msgCount).toBe(3)
  })

  test('message handler routes based on message type', () => {
    const wm = new WsManager()
    const actions: string[] = []
    wm.route('/ws/t', {
      message(ws, msg) {
        const data = JSON.parse(String(msg))
        actions.push(data.action)
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.message(ws, '{"action":"join"}')
    websocket.message(ws, '{"action":"send"}')
    websocket.message(ws, '{"action":"leave"}')
    expect(actions).toEqual(['join', 'send', 'leave'])
  })

  test('message handler stores last message timestamp', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      message(ws) { ws.data.lastMsgAt = Date.now() },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.message(ws, 'ping')
    expect(typeof ws.data.lastMsgAt).toBe('number')
  })

  test('message handler can send multiple replies', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      message(ws, msg) {
        ws.send('ack')
        ws.send(String(msg))
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t' })
    websocket.message(ws, 'hello')
    expect(ws.sent).toEqual(['ack', 'hello'])
  })

  test('message handler publishes to multiple topics', () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      message(ws, msg) {
        ws.publish('global', String(msg))
        ws.publish(`user:${ws.data.userId}`, String(msg))
      },
    })
    const { websocket } = wm.build()
    const ws = mockWs({ __wsPath: '/ws/t', userId: 5 })
    websocket.message(ws, 'hi')
    expect(ws.published).toHaveLength(2)
    expect(ws.published[0].topic).toBe('global')
    expect(ws.published[1].topic).toBe('user:5')
  })
})

describe('WsManager — hasRoutes edge cases', () => {
  test('hasRoutes returns false for new WsManager', () => {
    expect(new WsManager().hasRoutes()).toBe(false)
  })

  test('hasRoutes returns true after one route', () => {
    const wm = new WsManager()
    wm.route('/ws/x', {})
    expect(wm.hasRoutes()).toBe(true)
  })

  test('hasRoutes returns true after five routes', () => {
    const wm = new WsManager()
    for (let i = 0; i < 5; i++) wm.route(`/ws/r${i}`, {})
    expect(wm.hasRoutes()).toBe(true)
  })
})

describe('WsManager — upgrade handler edge cases', () => {
  test('upgrade returning empty object sets __wsPath', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', { upgrade: () => ({}) })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.__wsPath).toBe('/ws/t')
  })

  test('no routes means no upgrade', async () => {
    const wm = new WsManager()
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/any'), server)
    expect(server.lastData).toBeNull()
  })

  test('upgrade with headers inspection', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      upgrade(req) {
        return { hasAuth: !!req.headers.get('Authorization') }
      },
    })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t', { Authorization: 'Bearer token' }), server)
    expect(server.lastData.hasAuth).toBe(true)
  })

  test('upgrade without auth header', async () => {
    const wm = new WsManager()
    wm.route('/ws/t', {
      upgrade(req) {
        return { hasAuth: !!req.headers.get('Authorization') }
      },
    })
    const { upgradeHandler } = wm.build()
    const server = mockServer()
    await upgradeHandler(mockRequest('/ws/t'), server)
    expect(server.lastData.hasAuth).toBe(false)
  })
})
