import { test, expect, describe, beforeEach } from 'bun:test'
import { Channel } from '../src/ws/channel'
import { ChannelManager } from '../src/ws/channel_manager'
import { PresenceStore } from '../src/ws/presence'
import { createBroadcast } from '../src/ws/broadcast'
import { WsManager } from '../src/ws/index'


function mockWs(data: any = {}): any {
  const sent: string[] = []
  const subscribed = new Set<string>()
  const published: Array<{ topic: string; data: string }> = []
  return {
    data: { __id: String(Math.random()), __channels: new Set<string>(), ...data },
    sent,
    subscribed,
    published,
    readyState: 1,
    remoteAddress: '127.0.0.1',
    send(msg: string) { sent.push(msg) },
    close() {},
    subscribe(topic: string) { subscribed.add(topic) },
    unsubscribe(topic: string) { subscribed.delete(topic) },
    publish(topic: string, msg: string) { published.push({ topic, data: msg }) },
    isSubscribed(topic: string) { return subscribed.has(topic) },
    cork(cb: () => void) { cb() },
  }
}

function mockServer() {
  const obj = {
    published: [] as Array<{ topic: string; data: string }>,
    publish(topic: string, data: string) { obj.published.push({ topic, data }) },
  }
  return obj
}

function parse(json: string) {
  return JSON.parse(json)
}


describe('PresenceStore', () => {
  let store: PresenceStore

  beforeEach(() => { store = new PresenceStore() })

  test('join adds a member', () => {
    store.join('topic1', 'sock1', { name: 'Ali' })
    expect(store.count('topic1')).toBe(1)
    expect(store.members('topic1')).toEqual([{ name: 'Ali' }])
  })

  test('multiple members', () => {
    store.join('topic1', 'sock1', { name: 'Ali' })
    store.join('topic1', 'sock2', { name: 'Veli' })
    expect(store.count('topic1')).toBe(2)
    expect(store.members('topic1')).toHaveLength(2)
  })

  test('leave removes a member and returns data', () => {
    store.join('topic1', 'sock1', { name: 'Ali' })
    const data = store.leave('topic1', 'sock1')
    expect(data).toEqual({ name: 'Ali' })
    expect(store.count('topic1')).toBe(0)
  })

  test('leave on non-existent returns undefined', () => {
    expect(store.leave('nope', 'nope')).toBeUndefined()
  })

  test('clear removes all members', () => {
    store.join('t', 'a', { id: 1 })
    store.join('t', 'b', { id: 2 })
    store.clear('t')
    expect(store.count('t')).toBe(0)
  })

  test('members returns empty for unknown topic', () => {
    expect(store.members('unknown')).toEqual([])
    expect(store.count('unknown')).toBe(0)
  })
})


describe('Channel', () => {
  test('topic() builds correct string', () => {
    class TestChannel extends Channel {}
    const ch = new TestChannel()
    ch.name = 'chat'
    expect(ch.topic('general')).toBe('channel:chat:general')
  })

  test('authorize defaults to true', async () => {
    class TestChannel extends Channel {}
    const ch = new TestChannel()
    expect(await ch.authorize(mockWs(), {})).toBe(true)
  })

  test('broadcast sends via server.publish', () => {
    class TestChannel extends Channel {}
    const ch = new TestChannel()
    ch.name = 'chat'
    const server = mockServer()
    ch._server = server
    ch.broadcast('room1', 'hello', { msg: 'hi' })
    expect(server.published).toHaveLength(1)
    const payload = parse(server.published[0].data)
    expect(payload.type).toBe('event')
    expect(payload.channel).toBe('chat')
    expect(payload.room).toBe('room1')
    expect(payload.event).toBe('hello')
    expect(payload.data).toEqual({ msg: 'hi' })
  })

  test('broadcastExcept sends via ws.publish', () => {
    class TestChannel extends Channel {}
    const ch = new TestChannel()
    ch.name = 'chat'
    const ws = mockWs()
    ch.broadcastExcept(ws, 'room1', 'hello', { msg: 'hi' })
    expect(ws.published).toHaveLength(1)
    expect(ws.published[0].topic).toBe('channel:chat:room1')
  })

  test('presenceData returns user or id', () => {
    class TestChannel extends Channel {}
    const ch = new TestChannel()
    const ws1 = mockWs({ user: { id: 1, name: 'Ali' } })
    expect(ch.presenceData(ws1)).toEqual({ id: 1, name: 'Ali' })

    const ws2 = mockWs({ __id: 'abc' })
    expect(ch.presenceData(ws2)).toEqual({ id: 'abc' })
  })
})


describe('ChannelManager', () => {
  let manager: ChannelManager
  let server: ReturnType<typeof mockServer>

  class ChatChannel extends Channel {
    onJoin(_ws: any, _room: string) { /* noop */ }
    onMessage(_ws: any, event: string, data: any, room: string) {
      if (event === 'msg') this.broadcast(room, 'msg', data)
    }
  }

  class PrivateChannel extends Channel {
    authorize(ws: any, params: any) {
      return params.secret === '123'
    }
  }

  class PresenceChatChannel extends Channel {
    presence = true
    presenceData(ws: any) { return { name: ws.data.userName || 'anon' } }
  }

  beforeEach(() => {
    manager = new ChannelManager()
    server = mockServer()
    manager.register('chat', ChatChannel)
    manager.register('private', PrivateChannel)
    manager.register('presence-chat', PresenceChatChannel)
    manager.setServer(server)
  })

  test('channelNames returns registered names', () => {
    expect(manager.channelNames()).toEqual(['chat', 'private', 'presence-chat'])
  })

  test('join sends joined confirmation', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'general' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'joined')).toBeTruthy()
    expect(msgs.find((m: any) => m.type === 'joined')?.room).toBe('general')
  })

  test('join subscribes to topic', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'general' }))
    expect(ws.subscribed.has('channel:chat:general')).toBe(true)
    expect(ws.data.__channels.has('channel:chat:general')).toBe(true)
  })

  test('join denied on failed auth', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'private', room: 'x', params: { secret: 'wrong' } }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'denied')).toBeTruthy()
    expect(ws.subscribed.has('channel:private:x')).toBe(false)
  })

  test('join allowed with correct auth', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'private', room: 'x', params: { secret: '123' } }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('duplicate join returns error', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.filter((m: any) => m.type === 'error')).toHaveLength(1)
  })

  test('leave unsubscribes and sends confirmation', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'chat', room: 'r1' }))
    expect(ws.subscribed.has('channel:chat:r1')).toBe(false)
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'left')).toBeTruthy()
  })

  test('event dispatches to channel onMessage', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'event', channel: 'chat', room: 'r1', event: 'msg', data: { text: 'hi' } }))
    // ChatChannel.onMessage broadcasts via server.publish
    expect(server.published.length).toBeGreaterThan(0)
    const payload = parse(server.published[0].data)
    expect(payload.event).toBe('msg')
    expect(payload.data).toEqual({ text: 'hi' })
  })

  test('event on unjoined channel returns error', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'event', channel: 'chat', room: 'r1', event: 'msg', data: {} }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'error' && m.message.includes('Not joined'))).toBeTruthy()
  })

  test('unknown channel returns error', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'nope', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'error' && m.message.includes('Unknown channel'))).toBeTruthy()
  })

  test('invalid JSON returns error', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, 'not json')
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('missing fields returns error', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join' }))
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('close cleans up all joined rooms', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'r2' }))
    expect(ws.data.__channels.size).toBe(2)
    await handler.close!(ws, 1000, '')
    expect(ws.data.__channels.size).toBe(0)
  })

  // ─── Presence ──────────────────────────────────────────────────────────────

  test('presence: join sends sync with members', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs({ userName: 'Ali' })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'presence-chat', room: 'lobby' }))
    const msgs = ws.sent.map(parse)
    const sync = msgs.find((m: any) => m.type === 'presence:sync')
    expect(sync).toBeTruthy()
    expect(sync.members).toHaveLength(1)
    expect(sync.members[0].name).toBe('Ali')
  })

  test('presence: join publishes presence:join to others', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs({ userName: 'Ali' })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'presence-chat', room: 'lobby' }))
    // ws.publish sends to everyone except self
    const presenceJoin = ws.published.find((p: any) => {
      const msg = parse(p.data)
      return msg.type === 'presence:join'
    })
    expect(presenceJoin).toBeTruthy()
    expect(parse(presenceJoin!.data).member.name).toBe('Ali')
  })

  test('presence: leave publishes presence:leave', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs({ userName: 'Ali' })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'presence-chat', room: 'lobby' }))
    server.published = [] // clear
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'presence-chat', room: 'lobby' }))
    const leaveMsg = server.published.find((p: any) => parse(p.data).type === 'presence:leave')
    expect(leaveMsg).toBeTruthy()
    expect(parse(leaveMsg!.data).member.name).toBe('Ali')
  })

  test('presence: disconnect cleans up', async () => {
    const handler = manager.buildHandler()
    const ws = mockWs({ userName: 'Ali' })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'presence-chat', room: 'lobby' }))
    server.published = []
    await handler.close!(ws, 1000, '')
    const leaveMsg = server.published.find((p: any) => parse(p.data).type === 'presence:leave')
    expect(leaveMsg).toBeTruthy()
  })
})


describe('Channel auth', () => {
  test('requireAuth denies unauthenticated users', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class SecureChannel extends Channel {
      requireAuth = true
    }

    manager.register('secure', SecureChannel)
    manager.setServer(server)

    const handler = manager.buildHandler()
    const ws = mockWs({ user: null }) // no user
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'secure', room: 'r1' }))

    const msgs = ws.sent.map(parse)
    const denied = msgs.find((m: any) => m.type === 'denied')
    expect(denied).toBeTruthy()
    expect(denied.reason).toBe('Authentication required')
    expect(ws.subscribed.has('channel:secure:r1')).toBe(false)
  })

  test('requireAuth allows authenticated users', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class SecureChannel extends Channel {
      requireAuth = true
    }

    manager.register('secure', SecureChannel)
    manager.setServer(server)

    const handler = manager.buildHandler()
    const ws = mockWs({ user: { id: 1, name: 'Ali' } })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'secure', room: 'r1' }))

    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('authorize with user data for role-based access', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class AdminChannel extends Channel {
      requireAuth = true
      authorize(ws: any) {
        return ws.data.user?.role === 'admin'
      }
    }

    manager.register('admin', AdminChannel)
    manager.setServer(server)
    const handler = manager.buildHandler()

    // Regular user denied
    const ws1 = mockWs({ user: { id: 1, role: 'user' } })
    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'admin', room: 'panel' }))
    expect(ws1.sent.map(parse).find((m: any) => m.type === 'denied')).toBeTruthy()

    // Admin allowed
    const ws2 = mockWs({ user: { id: 2, role: 'admin' } })
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'admin', room: 'panel' }))
    expect(ws2.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('authorize with room-level access control', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class PrivateRoomChannel extends Channel {
      requireAuth = true
      authorize(ws: any, params: any) {
        // User can only join their own room
        return String(ws.data.user?.id) === params.userId
      }
    }

    manager.register('dm', PrivateRoomChannel)
    manager.setServer(server)
    const handler = manager.buildHandler()

    const ws = mockWs({ user: { id: 42 } })

    // Own room — allowed
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'dm', room: 'inbox', params: { userId: '42' } }))
    expect(ws.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()

    // Other user's room — denied
    const ws2 = mockWs({ user: { id: 42 } })
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'dm', room: 'inbox', params: { userId: '99' } }))
    expect(ws2.sent.map(parse).find((m: any) => m.type === 'denied')).toBeTruthy()
  })

  test('authResolver sets user during upgrade', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    manager.setAuthResolver(async (req: Request) => {
      const url = new URL(req.url)
      const token = url.searchParams.get('token')
      if (token === 'valid-jwt') return { id: 1, name: 'Ali' }
      return null
    })

    class SecureChannel extends Channel {
      requireAuth = true
    }

    manager.register('secure', SecureChannel)
    manager.setServer(server)

    const handler = manager.buildHandler()

    // Upgrade with valid token
    const data1 = await handler.upgrade!(new Request('http://localhost/ws?token=valid-jwt'))
    expect(data1.user).toEqual({ id: 1, name: 'Ali' })

    // Upgrade with no token
    const data2 = await handler.upgrade!(new Request('http://localhost/ws'))
    expect(data2.user).toBeNull()

    // Upgrade with invalid token
    const data3 = await handler.upgrade!(new Request('http://localhost/ws?token=bad'))
    expect(data3.user).toBeNull()
  })

  test('authResolver with database token pattern', async () => {
    const manager = new ChannelManager()

    // Simulate a database token lookup
    const tokens: Record<string, any> = {
      'tok_abc123': { id: 5, name: 'Veli', role: 'admin' },
    }

    manager.setAuthResolver(async (req: Request) => {
      const auth = req.headers.get('authorization')
      const token = auth?.replace('Bearer ', '')
      return token ? tokens[token] ?? null : null
    })

    const handler = manager.buildHandler()

    // Valid token
    const data1 = await handler.upgrade!(new Request('http://localhost/ws', {
      headers: { authorization: 'Bearer tok_abc123' },
    }))
    expect(data1.user).toEqual({ id: 5, name: 'Veli', role: 'admin' })

    // Invalid token
    const data2 = await handler.upgrade!(new Request('http://localhost/ws', {
      headers: { authorization: 'Bearer tok_invalid' },
    }))
    expect(data2.user).toBeNull()
  })

  test('presence channel uses authenticated user data', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class PresenceRoom extends Channel {
      presence = true
      requireAuth = true
      presenceData(ws: any) {
        return { id: ws.data.user.id, name: ws.data.user.name }
      }
    }

    manager.register('room', PresenceRoom)
    manager.setServer(server)
    const handler = manager.buildHandler()

    // User 1 joins
    const ws1 = mockWs({ user: { id: 1, name: 'Ali' } })
    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'room', room: 'lobby' }))
    const sync1 = ws1.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    expect(sync1.members).toEqual([{ id: 1, name: 'Ali' }])

    // User 2 joins — gets both members in sync
    const ws2 = mockWs({ user: { id: 2, name: 'Veli' } })
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'room', room: 'lobby' }))
    const sync2 = ws2.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    expect(sync2.members).toHaveLength(2)
    expect(sync2.members.find((m: any) => m.name === 'Ali')).toBeTruthy()
    expect(sync2.members.find((m: any) => m.name === 'Veli')).toBeTruthy()

    // User 2's join publishes presence:join (via ws2.publish, which goes to others)
    const joinNotif = ws2.published.find((p: any) => {
      const msg = parse(p.data)
      return msg.type === 'presence:join' && msg.member.name === 'Veli'
    })
    expect(joinNotif).toBeTruthy()
  })

  test('unauthenticated user cannot send events to requireAuth channel', async () => {
    const manager = new ChannelManager()
    const server = mockServer()

    class SecureChannel extends Channel {
      requireAuth = true
    }

    manager.register('secure', SecureChannel)
    manager.setServer(server)
    const handler = manager.buildHandler()

    const ws = mockWs({ user: null })
    // Try to send event without joining (should fail)
    await handler.message!(ws, JSON.stringify({ type: 'event', channel: 'secure', room: 'r1', event: 'test', data: {} }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'error' && m.message.includes('Not joined'))).toBeTruthy()
  })
})


describe('WsManager — channel registration', () => {
  test('channel() makes hasRoutes() return true', () => {
    const wm = new WsManager()
    class TestChannel extends Channel {}
    wm.channel('test', TestChannel)
    expect(wm.hasRoutes()).toBe(true)
  })

  test('channel() registers on /ws path', () => {
    const wm = new WsManager()
    class TestChannel extends Channel {}
    wm.channel('test', TestChannel)
    const { upgradeHandler } = wm.build()
    expect(upgradeHandler).toBeDefined()
  })

  test('getChannelManager returns manager after channel()', () => {
    const wm = new WsManager()
    expect(wm.getChannelManager()).toBeNull()
    class TestChannel extends Channel {}
    wm.channel('test', TestChannel)
    expect(wm.getChannelManager()).toBeTruthy()
  })

  test('channelAuth sets auth resolver', () => {
    const wm = new WsManager()
    class TestChannel extends Channel {}
    wm.channelAuth(async (req) => {
      const token = new URL(req.url).searchParams.get('token')
      return token === 'ok' ? { id: 1 } : null
    })
    wm.channel('test', TestChannel)
    expect(wm.getChannelManager()).toBeTruthy()
  })
})


describe('createBroadcast', () => {
  test('emit publishes to correct topic', () => {
    const server = mockServer()
    const bc = createBroadcast(() => server)
    bc.to('chat', 'general').emit('message', { text: 'hello' })
    expect(server.published).toHaveLength(1)
    const payload = parse(server.published[0].data)
    expect(payload.type).toBe('event')
    expect(payload.channel).toBe('chat')
    expect(payload.room).toBe('general')
    expect(payload.event).toBe('message')
    expect(payload.data).toEqual({ text: 'hello' })
    expect(server.published[0].topic).toBe('channel:chat:general')
  })

  test('emit throws if server not started', () => {
    const bc = createBroadcast(() => null)
    expect(() => bc.to('chat', 'room').emit('test')).toThrow('Server not started')
  })

  test('emit with no data', () => {
    const server = mockServer()
    const bc = createBroadcast(() => server)
    bc.to('chat', 'room').emit('ping')
    const payload = parse(server.published[0].data)
    expect(payload.event).toBe('ping')
    expect(payload.data).toBeUndefined()
  })

  test('emit to different rooms', () => {
    const server = mockServer()
    const bc = createBroadcast(() => server)
    bc.to('chat', 'room1').emit('msg', { text: 'a' })
    bc.to('chat', 'room2').emit('msg', { text: 'b' })
    expect(server.published).toHaveLength(2)
    expect(server.published[0].topic).toBe('channel:chat:room1')
    expect(server.published[1].topic).toBe('channel:chat:room2')
  })

  test('emit to different channels', () => {
    const server = mockServer()
    const bc = createBroadcast(() => server)
    bc.to('chat', 'r').emit('msg', {})
    bc.to('notifications', 'r').emit('alert', {})
    expect(server.published[0].topic).toBe('channel:chat:r')
    expect(server.published[1].topic).toBe('channel:notifications:r')
  })
})


describe('PresenceStore — advanced', () => {
  let store: PresenceStore
  beforeEach(() => { store = new PresenceStore() })

  test('overwrite same socketId updates data', () => {
    store.join('t', 'a', { name: 'old' })
    store.join('t', 'a', { name: 'new' })
    expect(store.members('t')).toEqual([{ name: 'new' }])
    expect(store.count('t')).toBe(1)
  })

  test('multiple topics are independent', () => {
    store.join('t1', 'a', { x: 1 })
    store.join('t2', 'a', { x: 2 })
    expect(store.count('t1')).toBe(1)
    expect(store.count('t2')).toBe(1)
    store.leave('t1', 'a')
    expect(store.count('t1')).toBe(0)
    expect(store.count('t2')).toBe(1)
  })

  test('leave non-existent socketId is safe', () => {
    store.join('t', 'a', {})
    expect(store.leave('t', 'zzz')).toBeUndefined()
    expect(store.count('t')).toBe(1)
  })

  test('clear non-existent topic is safe', () => {
    store.clear('nope') // should not throw
    expect(store.count('nope')).toBe(0)
  })

  test('members returns fresh array each call', () => {
    store.join('t', 'a', { id: 1 })
    const m1 = store.members('t')
    const m2 = store.members('t')
    expect(m1).toEqual(m2)
    expect(m1).not.toBe(m2) // different array reference
  })

  test('many members', () => {
    for (let i = 0; i < 50; i++) store.join('t', `s${i}`, { i })
    expect(store.count('t')).toBe(50)
    expect(store.members('t')).toHaveLength(50)
  })
})


describe('Channel — edge cases', () => {
  test('broadcast with no server is a no-op', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'x'
    ch._server = null
    ch.broadcast('r', 'e', {}) // should not throw
  })

  test('topic with special characters', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'my-channel'
    expect(ch.topic('room-123')).toBe('channel:my-channel:room-123')
    expect(ch.topic('user:42')).toBe('channel:my-channel:user:42')
  })

  test('broadcastExcept payload is valid JSON', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'ch'
    const ws = mockWs()
    ch.broadcastExcept(ws, 'r', 'evt', { nested: { deep: true } })
    const msg = parse(ws.published[0].data)
    expect(msg.data.nested.deep).toBe(true)
  })

  test('presenceData with no user returns id', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    const ws = mockWs({ __id: 'test-123' })
    delete ws.data.user
    expect(ch.presenceData(ws)).toEqual({ id: 'test-123' })
  })

  test('requireAuth defaults to false', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    expect(ch.requireAuth).toBe(false)
  })

  test('presence defaults to false', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    expect(ch.presence).toBe(false)
  })
})


describe('ChannelManager — edge cases', () => {
  test('unknown message type returns error', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'unknown', channel: 'ch', room: 'r' }))
    expect(parse(ws.sent[0]).type).toBe('error')
    expect(parse(ws.sent[0]).message).toContain('Unknown message type')
  })

  test('event with empty event name', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {
      onMessage(_ws: any, event: string) {
        // event should be empty string
        expect(event).toBe('')
      }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    await handler.message!(ws, JSON.stringify({ type: 'event', channel: 'ch', room: 'r', data: {} }))
  })

  test('join multiple rooms in same channel', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r2' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r3' }))
    expect(ws.data.__channels.size).toBe(3)
    expect(ws.subscribed.size).toBe(3)
  })

  test('join multiple channels', async () => {
    const manager = new ChannelManager()
    class Ch1 extends Channel {}
    class Ch2 extends Channel {}
    manager.register('a', Ch1)
    manager.register('b', Ch2)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'a', room: 'r' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'b', room: 'r' }))
    expect(ws.data.__channels.size).toBe(2)
  })

  test('leave room not joined is safe', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'ch', room: 'notjoined' }))
    // no error, no crash
    expect(ws.sent.map(parse).filter((m: any) => m.type === 'error')).toHaveLength(0)
  })

  test('close with no joined channels is safe', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.close!(ws, 1000, '')
    // no crash
  })

  test('close with null __channels is safe', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    ws.data.__channels = undefined
    await handler.close!(ws, 1000, '')
  })

  test('Buffer message is handled', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    const buf = Buffer.from(JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    await handler.message!(ws, buf)
    expect(ws.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('channelNames returns all registered names', () => {
    const manager = new ChannelManager()
    class A extends Channel {}
    class B extends Channel {}
    class C extends Channel {}
    manager.register('alpha', A)
    manager.register('beta', B)
    manager.register('gamma', C)
    expect(manager.channelNames()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('onJoin hook is called', async () => {
    const manager = new ChannelManager()
    let joinCalled = false
    class Ch extends Channel {
      onJoin() { joinCalled = true }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    expect(joinCalled).toBe(true)
  })

  test('onLeave hook is called on explicit leave', async () => {
    const manager = new ChannelManager()
    let leaveCalled = false
    class Ch extends Channel {
      onLeave() { leaveCalled = true }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'ch', room: 'r' }))
    expect(leaveCalled).toBe(true)
  })

  test('onLeave hook is called on disconnect', async () => {
    const manager = new ChannelManager()
    let leaveCalled = false
    class Ch extends Channel {
      onLeave() { leaveCalled = true }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    await handler.close!(ws, 1000, '')
    expect(leaveCalled).toBe(true)
  })

  test('onMessage receives correct event and data', async () => {
    const manager = new ChannelManager()
    let receivedEvent = ''
    let receivedData: any = null
    let receivedRoom = ''
    class Ch extends Channel {
      onMessage(_ws: any, event: string, data: any, room: string) {
        receivedEvent = event
        receivedData = data
        receivedRoom = room
      }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'myroom' }))
    await handler.message!(ws, JSON.stringify({ type: 'event', channel: 'ch', room: 'myroom', event: 'ping', data: { ts: 123 } }))
    expect(receivedEvent).toBe('ping')
    expect(receivedData).toEqual({ ts: 123 })
    expect(receivedRoom).toBe('myroom')
  })

  test('async authorize works', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {
      async authorize(_ws: any, params: any) {
        await new Promise(r => setTimeout(r, 1))
        return params.key === 'secret'
      }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()

    const ws1 = mockWs()
    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'ch', room: 'r', params: { key: 'secret' } }))
    expect(ws1.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()

    const ws2 = mockWs()
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'ch', room: 'r', params: { key: 'wrong' } }))
    expect(ws2.sent.map(parse).find((m: any) => m.type === 'denied')).toBeTruthy()
  })

  test('upgrade generates unique ids', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    const handler = manager.buildHandler()
    const d1 = await handler.upgrade!(new Request('http://localhost/ws'))
    const d2 = await handler.upgrade!(new Request('http://localhost/ws'))
    expect(d1.__id).not.toBe(d2.__id)
  })

  test('upgrade initializes empty __channels set', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    const handler = manager.buildHandler()
    const d = await handler.upgrade!(new Request('http://localhost/ws'))
    expect(d.__channels).toBeInstanceOf(Set)
    expect(d.__channels.size).toBe(0)
  })
})


describe('Presence — advanced', () => {
  test('multiple users join and leave presence channel', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch extends Channel {
      presence = true
      presenceData(ws: any) { return { name: ws.data.name } }
    }
    manager.register('room', Ch)
    manager.setServer(server)
    const handler = manager.buildHandler()

    const ws1 = mockWs({ name: 'Ali' })
    const ws2 = mockWs({ name: 'Veli' })
    const ws3 = mockWs({ name: 'Ayse' })

    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'room', room: 'lobby' }))
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'room', room: 'lobby' }))
    await handler.message!(ws3, JSON.stringify({ type: 'join', channel: 'room', room: 'lobby' }))

    // ws3 gets sync with all 3 members
    const sync = ws3.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    expect(sync.members).toHaveLength(3)

    // ws2 leaves
    await handler.message!(ws2, JSON.stringify({ type: 'leave', channel: 'room', room: 'lobby' }))

    // server published presence:leave
    const leaveMsg = server.published.find((p: any) => {
      const m = parse(p.data)
      return m.type === 'presence:leave' && m.member.name === 'Veli'
    })
    expect(leaveMsg).toBeTruthy()
  })

  test('presence sync after disconnect and rejoin', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch extends Channel {
      presence = true
      presenceData(ws: any) { return { id: ws.data.uid } }
    }
    manager.register('ch', Ch)
    manager.setServer(server)
    const handler = manager.buildHandler()

    const ws1 = mockWs({ uid: 'u1' })
    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    await handler.close!(ws1, 1000, '')

    // Rejoin with new socket
    const ws2 = mockWs({ uid: 'u2' })
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const sync = ws2.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    // Only ws2 should be present (ws1 disconnected)
    expect(sync.members).toHaveLength(1)
    expect(sync.members[0].id).toBe('u2')
  })

  test('presence in different rooms is independent', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch extends Channel {
      presence = true
      presenceData(ws: any) { return { name: ws.data.name } }
    }
    manager.register('ch', Ch)
    manager.setServer(server)
    const handler = manager.buildHandler()

    const ws1 = mockWs({ name: 'Ali' })
    const ws2 = mockWs({ name: 'Veli' })

    await handler.message!(ws1, JSON.stringify({ type: 'join', channel: 'ch', room: 'room-a' }))
    await handler.message!(ws2, JSON.stringify({ type: 'join', channel: 'ch', room: 'room-b' }))

    const sync1 = ws1.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    const sync2 = ws2.sent.map(parse).find((m: any) => m.type === 'presence:sync')

    expect(sync1.members).toHaveLength(1)
    expect(sync1.members[0].name).toBe('Ali')
    expect(sync2.members).toHaveLength(1)
    expect(sync2.members[0].name).toBe('Veli')
  })

  test('non-presence channel does not send sync', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {} // presence = false
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'presence:sync')).toBeUndefined()
  })
})


describe('Auth — advanced', () => {
  test('authResolver error is caught gracefully', async () => {
    const manager = new ChannelManager()
    manager.setAuthResolver(async () => { throw new Error('db down') })
    class Ch extends Channel {}
    manager.register('ch', Ch)
    const handler = manager.buildHandler()
    const data = await handler.upgrade!(new Request('http://localhost/ws'))
    expect(data.user).toBeNull() // error caught, user is null
  })

  test('requireAuth + presence: denied user gets no sync', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {
      presence = true
      requireAuth = true
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()

    const ws = mockWs({ user: null })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'denied')).toBeTruthy()
    expect(msgs.find((m: any) => m.type === 'presence:sync')).toBeUndefined()
  })

  test('authorize receives params from join message', async () => {
    const manager = new ChannelManager()
    let receivedParams: any = null
    class Ch extends Channel {
      authorize(_ws: any, params: any) {
        receivedParams = params
        return true
      }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r', params: { foo: 'bar', n: 42 } }))
    expect(receivedParams).toEqual({ foo: 'bar', n: 42 })
  })

  test('authorize receives ws with user data', async () => {
    const manager = new ChannelManager()
    let receivedUser: any = null
    class Ch extends Channel {
      requireAuth = true
      authorize(ws: any) {
        receivedUser = ws.data.user
        return true
      }
    }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs({ user: { id: 7, name: 'Test' } })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    expect(receivedUser).toEqual({ id: 7, name: 'Test' })
  })

  test('public channel allows null user', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {} // requireAuth = false
    manager.register('pub', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs({ user: null })
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'pub', room: 'r' }))
    expect(ws.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('session cookie auth pattern', async () => {
    const manager = new ChannelManager()
    const sessions: Record<string, any> = {
      'sess_abc': { id: 1, name: 'Ali' },
    }
    manager.setAuthResolver(async (req: Request) => {
      const cookie = req.headers.get('cookie') || ''
      const match = cookie.match(/session=([^;]+)/)
      return match ? sessions[match[1]] ?? null : null
    })
    class Ch extends Channel { requireAuth = true }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()

    const d1 = await handler.upgrade!(new Request('http://localhost/ws', {
      headers: { cookie: 'session=sess_abc' },
    }))
    expect(d1.user).toEqual({ id: 1, name: 'Ali' })

    const d2 = await handler.upgrade!(new Request('http://localhost/ws', {
      headers: { cookie: 'session=invalid' },
    }))
    expect(d2.user).toBeNull()
  })
})


describe('WsManager — advanced', () => {
  test('channel and raw route coexist', () => {
    const wm = new WsManager()
    class Ch extends Channel {}
    wm.route('/ws/raw', { message(ws, msg) { ws.send(String(msg)) } })
    wm.channel('ch', Ch)
    expect(wm.hasRoutes()).toBe(true)
    const { upgradeHandler, websocket } = wm.build()
    expect(upgradeHandler).toBeDefined()
    expect(websocket).toBeDefined()
  })

  test('multiple channels registered', () => {
    const wm = new WsManager()
    class A extends Channel {}
    class B extends Channel {}
    class C extends Channel {}
    wm.channel('a', A).channel('b', B).channel('c', C)
    expect(wm.getChannelManager()!.channelNames()).toEqual(['a', 'b', 'c'])
  })

  test('channelAuth before channel() creates manager', () => {
    const wm = new WsManager()
    wm.channelAuth(async () => null)
    // Manager created by channelAuth
    expect(wm.getChannelManager()).toBeTruthy()
  })

  test('channelAuth chaining', () => {
    const wm = new WsManager()
    class Ch extends Channel {}
    const result = wm.channelAuth(async () => null).channel('ch', Ch)
    expect(result).toBe(wm) // chainable
  })
})


describe('Message validation', () => {
  let manager: ChannelManager
  let handler: any

  beforeEach(() => {
    manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    handler = manager.buildHandler()
  })

  test('empty string message returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, '')
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('non-JSON string returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, 'hello world')
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('JSON array returns error (missing fields)', async () => {
    const ws = mockWs()
    await handler.message!(ws, '[1,2,3]')
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('missing channel field returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', room: 'r' }))
    expect(parse(ws.sent[0]).message).toContain('Missing')
  })

  test('missing room field returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch' }))
    expect(parse(ws.sent[0]).message).toContain('Missing')
  })

  test('missing type field returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ channel: 'ch', room: 'r' }))
    expect(parse(ws.sent[0]).message).toContain('Missing')
  })

  test('null values in required fields returns error', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: null, channel: 'ch', room: 'r' }))
    expect(parse(ws.sent[0]).type).toBe('error')
  })

  test('extra fields are ignored gracefully', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r', extra: 'stuff', foo: 123 }))
    expect(ws.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('deeply nested data is passed through', async () => {
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    let received: any = null
    // Replace channel with one that captures data
    const mgr2 = new ChannelManager()
    class Ch2 extends Channel {
      onMessage(_ws: any, _e: string, data: any) { received = data }
    }
    mgr2.register('ch2', Ch2)
    mgr2.setServer(mockServer())
    const h2 = mgr2.buildHandler()
    const ws2 = mockWs()
    await h2.message!(ws2, JSON.stringify({ type: 'join', channel: 'ch2', room: 'r' }))
    await h2.message!(ws2, JSON.stringify({ type: 'event', channel: 'ch2', room: 'r', event: 'x', data: { a: { b: { c: [1, 2, 3] } } } }))
    expect(received).toEqual({ a: { b: { c: [1, 2, 3] } } })
  })
})


describe('Concurrent operations', () => {
  test('many sockets join same room concurrently', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()

    const sockets = Array.from({ length: 20 }, () => mockWs())
    await Promise.all(sockets.map(ws =>
      handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'big' }))
    ))

    for (const ws of sockets) {
      expect(ws.sent.map(parse).find((m: any) => m.type === 'joined')).toBeTruthy()
      expect(ws.subscribed.has('channel:ch:big')).toBe(true)
    }
  })

  test('many sockets join and leave', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel { presence = true; presenceData(ws: any) { return { id: ws.data.__id } } }
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()

    const sockets = Array.from({ length: 10 }, () => mockWs())

    // All join
    await Promise.all(sockets.map(ws =>
      handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    ))

    // Half leave
    await Promise.all(sockets.slice(0, 5).map(ws =>
      handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'ch', room: 'r' }))
    ))

    // New socket joins — should see 5 members
    const newWs = mockWs()
    await handler.message!(newWs, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const sync = newWs.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    expect(sync.members).toHaveLength(6) // 5 remaining + newWs
  })

  test('rapid join/leave same room', async () => {
    const manager = new ChannelManager()
    class Ch extends Channel {}
    manager.register('ch', Ch)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()

    for (let i = 0; i < 10; i++) {
      await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
      await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'ch', room: 'r' }))
    }

    expect(ws.data.__channels.size).toBe(0)
    expect(ws.subscribed.size).toBe(0)
  })

  test('broadcast during join hook reaches room', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch extends Channel {
      onJoin(_ws: any, room: string) {
        this.broadcast(room, 'welcome', { msg: 'hello' })
      }
    }
    manager.register('ch', Ch)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const welcome = server.published.find((p: any) => parse(p.data).event === 'welcome')
    expect(welcome).toBeTruthy()
    expect(parse(welcome!.data).data.msg).toBe('hello')
  })
})


describe('Channel — additional edge cases', () => {
  test('topic with empty room name', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'chat'
    expect(ch.topic('')).toBe('channel:chat:')
  })

  test('topic with spaces in room', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'chat'
    expect(ch.topic('room with spaces')).toBe('channel:chat:room with spaces')
  })

  test('topic with unicode room name', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'chat'
    expect(ch.topic('こんにちは')).toBe('channel:chat:こんにちは')
  })

  test('broadcast with complex nested data', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'ch'
    const server = mockServer()
    ch._server = server
    ch.broadcast('r', 'evt', { arr: [1, 2, { nested: true }], num: 42, str: 'hello' })
    const payload = parse(server.published[0].data)
    expect(payload.data.arr).toEqual([1, 2, { nested: true }])
    expect(payload.data.num).toBe(42)
  })

  test('broadcastExcept with empty data', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'ch'
    const ws = mockWs()
    ch.broadcastExcept(ws, 'r', 'evt', {})
    const msg = parse(ws.published[0].data)
    expect(msg.data).toEqual({})
  })

  test('broadcastExcept with undefined data', () => {
    class Ch extends Channel {}
    const ch = new Ch()
    ch.name = 'ch'
    const ws = mockWs()
    ch.broadcastExcept(ws, 'r', 'evt')
    const msg = parse(ws.published[0].data)
    expect(msg.event).toBe('evt')
  })

  test('authorize can return a promise', async () => {
    class Ch extends Channel {
      async authorize(_ws: any, _data: any) {
        return Promise.resolve(true)
      }
    }
    const ch = new Ch()
    expect(await ch.authorize(mockWs(), {})).toBe(true)
  })

  test('multiple channels with same room name are independent', async () => {
    const manager = new ChannelManager()
    class Ch1 extends Channel {}
    class Ch2 extends Channel {}
    manager.register('chat', Ch1)
    manager.register('notifications', Ch2)
    manager.setServer(mockServer())
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'chat', room: 'lobby' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'notifications', room: 'lobby' }))
    expect(ws.subscribed.has('channel:chat:lobby')).toBe(true)
    expect(ws.subscribed.has('channel:notifications:lobby')).toBe(true)
    expect(ws.data.__channels.size).toBe(2)
  })

  test('rapid presence join/leave maintains consistency', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch extends Channel {
      presence = true
      presenceData(ws: any) { return { id: ws.data.__id } }
    }
    manager.register('ch', Ch)
    manager.setServer(server)
    const handler = manager.buildHandler()

    for (let i = 0; i < 5; i++) {
      const ws = mockWs()
      await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
      await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'ch', room: 'r' }))
    }

    // New user should see empty presence
    const finalWs = mockWs()
    await handler.message!(finalWs, JSON.stringify({ type: 'join', channel: 'ch', room: 'r' }))
    const sync = finalWs.sent.map(parse).find((m: any) => m.type === 'presence:sync')
    expect(sync.members).toHaveLength(1) // only finalWs
  })

  test('authResolver returning different user shapes', async () => {
    const manager = new ChannelManager()
    let callCount = 0
    manager.setAuthResolver(async (req: Request) => {
      callCount++
      const url = new URL(req.url)
      const type = url.searchParams.get('type')
      if (type === 'minimal') return { id: 1 }
      if (type === 'full') return { id: 2, name: 'User', email: 'u@test.com', roles: ['admin', 'user'] }
      if (type === 'numeric') return { id: 999, score: 42.5 }
      return null
    })
    class Ch extends Channel {}
    manager.register('ch', Ch)
    const handler = manager.buildHandler()

    const d1 = await handler.upgrade!(new Request('http://localhost/ws?type=minimal'))
    expect(d1.user).toEqual({ id: 1 })

    const d2 = await handler.upgrade!(new Request('http://localhost/ws?type=full'))
    expect(d2.user.roles).toEqual(['admin', 'user'])

    const d3 = await handler.upgrade!(new Request('http://localhost/ws?type=numeric'))
    expect(d3.user.score).toBe(42.5)

    expect(callCount).toBe(3)
  })

  test('createBroadcast with null server throws', () => {
    const bc = createBroadcast(() => null)
    expect(() => bc.to('ch', 'r').emit('evt', { data: 'test' })).toThrow()
  })

  test('createBroadcast emit with various data types', () => {
    const server = mockServer()
    const bc = createBroadcast(() => server)
    bc.to('ch', 'r').emit('string', 'hello')
    bc.to('ch', 'r').emit('number', 42)
    bc.to('ch', 'r').emit('array', [1, 2, 3])
    bc.to('ch', 'r').emit('null', null)
    expect(server.published).toHaveLength(4)
    expect(parse(server.published[0].data).data).toBe('hello')
    expect(parse(server.published[1].data).data).toBe(42)
    expect(parse(server.published[2].data).data).toEqual([1, 2, 3])
    expect(parse(server.published[3].data).data).toBeNull()
  })
})

// NEW TESTS: Deep edge cases for Channels

describe('PresenceStore — edge cases', () => {
  test('join same socket twice to same topic replaces data', () => {
    const store = new PresenceStore()
    store.join('room', 'sock1', { name: 'Ali' })
    store.join('room', 'sock1', { name: 'Ali Updated' })
    // Depending on implementation, may have 1 or 2 members
    const members = store.members('room')
    // At minimum the latest data should be present
    expect(members.some((m: any) => m.name === 'Ali Updated')).toBe(true)
  })

  test('join to different topics tracks independently', () => {
    const store = new PresenceStore()
    store.join('room-a', 'sock1', { name: 'A' })
    store.join('room-b', 'sock1', { name: 'B' })
    expect(store.count('room-a')).toBe(1)
    expect(store.count('room-b')).toBe(1)
    expect(store.members('room-a')[0].name).toBe('A')
    expect(store.members('room-b')[0].name).toBe('B')
  })

  test('leave from one topic does not affect another', () => {
    const store = new PresenceStore()
    store.join('t1', 's1', { id: 1 })
    store.join('t2', 's1', { id: 1 })
    store.leave('t1', 's1')
    expect(store.count('t1')).toBe(0)
    expect(store.count('t2')).toBe(1)
  })

  test('clear on nonexistent topic is a no-op', () => {
    const store = new PresenceStore()
    expect(() => store.clear('nonexistent')).not.toThrow()
  })

  test('multiple members then clear removes all', () => {
    const store = new PresenceStore()
    for (let i = 0; i < 10; i++) {
      store.join('crowd', `s${i}`, { id: i })
    }
    expect(store.count('crowd')).toBe(10)
    store.clear('crowd')
    expect(store.count('crowd')).toBe(0)
  })
})

describe('Channel — topic format', () => {
  test('topic includes channel name and room', () => {
    class MyChannel extends Channel {}
    const ch = new MyChannel()
    ch.name = 'notifications'
    expect(ch.topic('user-123')).toBe('channel:notifications:user-123')
  })

  test('topic with empty room string', () => {
    class MyChannel extends Channel {}
    const ch = new MyChannel()
    ch.name = 'test'
    expect(ch.topic('')).toBe('channel:test:')
  })
})

describe('ChannelManager — multiple rooms', () => {
  test('joining multiple rooms on same channel works', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class RoomChannel extends Channel {}
    manager.register('rooms', RoomChannel)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'rooms', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'rooms', room: 'r2' }))
    expect(ws.data.__channels.size).toBe(2)
    expect(ws.subscribed.has('channel:rooms:r1')).toBe(true)
    expect(ws.subscribed.has('channel:rooms:r2')).toBe(true)
  })

  test('leaving one room keeps other rooms intact', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class RoomChannel extends Channel {}
    manager.register('multi', RoomChannel)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'multi', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'multi', room: 'r2' }))
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'multi', room: 'r1' }))
    expect(ws.data.__channels.size).toBe(1)
    expect(ws.subscribed.has('channel:multi:r1')).toBe(false)
    expect(ws.subscribed.has('channel:multi:r2')).toBe(true)
  })

  test('close cleans up all rooms from all channels', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class Ch1 extends Channel {}
    class Ch2 extends Channel {}
    manager.register('ch1', Ch1)
    manager.register('ch2', Ch2)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch1', room: 'r1' }))
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'ch2', room: 'r2' }))
    expect(ws.data.__channels.size).toBe(2)
    await handler.close!(ws, 1000, '')
    expect(ws.data.__channels.size).toBe(0)
  })
})

describe('ChannelManager — error handling', () => {
  test('message with unknown type returns error', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class TestCh extends Channel {}
    manager.register('test', TestCh)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'unknown-type', channel: 'test', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.some((m: any) => m.type === 'error')).toBe(true)
  })

  test('leave from non-joined room sends a left or is a no-op (no crash)', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class TestCh extends Channel {}
    manager.register('test', TestCh)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    // Should not throw even if not joined
    await handler.message!(ws, JSON.stringify({ type: 'leave', channel: 'test', room: 'never-joined' }))
    // Just verify no crash happened
    expect(ws.sent.length).toBeGreaterThanOrEqual(0)
  })
})

describe('ChannelManager — malformed messages and topic cleanup', () => {
  test('rejects JSON primitives without throwing', async () => {
    const manager = new ChannelManager()
    class TestChannel extends Channel {}
    manager.register('test', TestChannel)
    const handler = manager.buildHandler()
    const ws = mockWs()

    for (const payload of ['null', '42', '"text"', '[]']) {
      await expect(handler.message!(ws, payload)).resolves.toBeUndefined()
      expect(parse(ws.sent.at(-1)).message).toBe('Invalid message')
    }
  })

  test('disconnect preserves colons in room names', async () => {
    const rooms: string[] = []
    const manager = new ChannelManager()
    class TestChannel extends Channel {
      onLeave(_ws: any, room: string) { rooms.push(room) }
    }
    manager.register('test', TestChannel)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'test', room: 'tenant:room:1' }))
    await handler.close!(ws, 1000, '')
    expect(rooms).toEqual(['tenant:room:1'])
  })
})

describe('PresenceStore — membership queries', () => {
  test('count returns 0 for empty topic', () => {
    const store = new PresenceStore()
    expect(store.count('empty')).toBe(0)
  })

  test('members returns empty array for empty topic', () => {
    const store = new PresenceStore()
    expect(store.members('empty')).toEqual([])
  })

  test('join and leave cycle brings count back to 0', () => {
    const store = new PresenceStore()
    store.join('cycle', 'sock1', { name: 'A' })
    store.join('cycle', 'sock2', { name: 'B' })
    store.leave('cycle', 'sock1')
    store.leave('cycle', 'sock2')
    expect(store.count('cycle')).toBe(0)
  })

  test('members data matches what was joined', () => {
    const store = new PresenceStore()
    store.join('data-check', 's1', { id: 1, role: 'admin' })
    store.join('data-check', 's2', { id: 2, role: 'user' })
    const members = store.members('data-check')
    expect(members).toHaveLength(2)
    expect(members.some((m: any) => m.id === 1 && m.role === 'admin')).toBe(true)
    expect(members.some((m: any) => m.id === 2 && m.role === 'user')).toBe(true)
  })
})

describe('Channel — authorize variations', () => {
  test('authorize returning false denies access', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class DenyAll extends Channel {
      authorize() { return false }
    }
    manager.register('deny', DenyAll)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'deny', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'denied')).toBeTruthy()
  })

  test('authorize returning true allows access', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class AllowAll extends Channel {
      authorize() { return true }
    }
    manager.register('allow', AllowAll)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'allow', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'joined')).toBeTruthy()
  })

  test('async authorize works', async () => {
    const manager = new ChannelManager()
    const server = mockServer()
    class AsyncAuth extends Channel {
      async authorize() { await Promise.resolve(); return true }
    }
    manager.register('async', AsyncAuth)
    manager.setServer(server)
    const handler = manager.buildHandler()
    const ws = mockWs()
    await handler.message!(ws, JSON.stringify({ type: 'join', channel: 'async', room: 'r1' }))
    const msgs = ws.sent.map(parse)
    expect(msgs.find((m: any) => m.type === 'joined')).toBeTruthy()
  })
})

describe('WsManager — basic instantiation', () => {
  test('WsManager can be instantiated', () => {
    const mgr = new WsManager()
    expect(mgr).toBeInstanceOf(WsManager)
  })
})
