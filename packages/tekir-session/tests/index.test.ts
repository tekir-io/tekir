import { test, expect, describe, beforeEach } from 'bun:test'
import { MemorySessionStore, Session } from '../src/index'


describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => {
    store = new MemorySessionStore()
  })

  test('read returns null for a missing session', async () => {
    expect(await store.read('unknown-id')).toBeNull()
  })

  test('write and read a session', async () => {
    await store.write('sess-1', { userId: 42 }, 3600)
    const data = await store.read('sess-1')
    expect(data).toEqual({ userId: 42 })
  })

  test('write overwrites an existing session', async () => {
    await store.write('sess-2', { step: 1 }, 3600)
    await store.write('sess-2', { step: 2 }, 3600)
    expect(await store.read('sess-2')).toEqual({ step: 2 })
  })

  test('destroy removes the session', async () => {
    await store.write('sess-3', { x: 1 }, 3600)
    await store.destroy('sess-3')
    expect(await store.read('sess-3')).toBeNull()
  })

  test('destroy on a non-existent session does not throw', async () => {
    await expect(store.destroy('ghost')).resolves.toBeUndefined()
  })

  test('touch extends the TTL', async () => {
    // Write with a tiny TTL (will expire fast)
    await store.write('sess-touch', { alive: true }, 0.001)
    // Touch before expiry to extend
    await store.touch('sess-touch', 3600)
    // Small wait to confirm original TTL would have expired
    await Bun.sleep(5)
    // Should still be readable because touch extended TTL
    expect(await store.read('sess-touch')).toEqual({ alive: true })
  })

  test('touch on a non-existent key is a no-op', async () => {
    await expect(store.touch('phantom', 3600)).resolves.toBeUndefined()
  })

  test('read returns null after TTL expires', async () => {
    await store.write('sess-expire', { temp: true }, 0.001)
    await Bun.sleep(5)
    expect(await store.read('sess-expire')).toBeNull()
  })

  test('multiple sessions are stored independently', async () => {
    await store.write('s1', { user: 'alice' }, 3600)
    await store.write('s2', { user: 'bob' }, 3600)
    expect(await store.read('s1')).toEqual({ user: 'alice' })
    expect(await store.read('s2')).toEqual({ user: 'bob' })
  })
})


describe('Session', () => {
  let store: MemorySessionStore
  let session: Session

  beforeEach(() => {
    store = new MemorySessionStore()
    session = new Session('test-id', store, 3600)
  })

  test('get returns undefined for a missing key', () => {
    expect<unknown>(session.get('missing')).toBeUndefined()
  })

  test('get returns the default value for a missing key', () => {
    expect<unknown>(session.get('missing', 'default')).toBe('default')
  })

  test('put and get a value', () => {
    session.put('name', 'ali')
    expect<unknown>(session.get('name')).toBe('ali')
  })

  test('has returns true for an existing key', () => {
    session.put('x', 1)
    expect(session.has('x')).toBe(true)
  })

  test('has returns false for a missing key', () => {
    expect(session.has('y')).toBe(false)
  })

  test('all returns a copy of all data', () => {
    session.put('a', 1)
    session.put('b', 2)
    expect(session.all()).toEqual({ a: 1, b: 2 })
  })

  test('pull gets and removes the key', () => {
    session.put('temp', 'once')
    const val = session.pull('temp')
    expect(val).toBe('once')
    expect(session.has('temp')).toBe(false)
  })

  test('pull returns default when key is missing', () => {
    expect<unknown>(session.pull('nope', 'fallback')).toBe('fallback')
  })

  test('forget removes a key', () => {
    session.put('gone', true)
    session.forget('gone')
    expect(session.has('gone')).toBe(false)
  })

  test('clear removes all keys', () => {
    session.put('a', 1)
    session.put('b', 2)
    session.clear()
    expect(session.all()).toEqual({})
  })

  test('increment increments a key by 1', () => {
    session.put('count', 5)
    const result = session.increment('count')
    expect(result).toBe(6)
    expect<unknown>(session.get('count')).toBe(6)
  })

  test('increment starts from 0 if key is missing', () => {
    expect(session.increment('fresh')).toBe(1)
  })

  test('increment accepts a custom amount', () => {
    session.put('score', 10)
    expect(session.increment('score', 5)).toBe(15)
  })

  test('decrement decrements a key by 1', () => {
    session.put('lives', 3)
    expect(session.decrement('lives')).toBe(2)
  })

  test('decrement accepts a custom amount', () => {
    session.put('hp', 100)
    expect(session.decrement('hp', 25)).toBe(75)
  })

  test('flash stores a one-time value', () => {
    session.flash('msg', 'success')
    expect(session.hasFlash('msg')).toBe(true)
  })

  test('getFlash retrieves and removes the flash value', () => {
    session.flash('notice', 'saved')
    const val = session.getFlash('notice')
    expect(val).toBe('saved')
    expect(session.hasFlash('notice')).toBe(false)
  })

  test('getFlash returns default for missing key', () => {
    expect<unknown>(session.getFlash('absent', 'none')).toBe('none')
  })

  test('flashAll returns all flash messages', () => {
    session.flash('k1', 'v1')
    session.flash('k2', 'v2')
    expect(session.flashAll()).toEqual({ k1: 'v1', k2: 'v2' })
  })

  test('save persists data to the store', async () => {
    session.put('userId', 99)
    await session.save()
    const raw = await store.read('test-id')
    expect(raw).not.toBeNull()
    expect<unknown>((raw!.data as any).userId).toBe(99)
  })

  test('save is a no-op when nothing is dirty', async () => {
    // Force an initial save to mark dirty = false
    session.put('k', 'v')
    await session.save()

    // Now create a fresh session from the same store without touching anything
    const sess2 = new Session('clean-id', store, 3600)
    // No puts — should save nothing
    await sess2.save()
    expect(await store.read('clean-id')).toBeNull()
  })

  test('destroy clears data and removes from store', async () => {
    session.put('secret', 'data')
    await session.save()
    await session.destroy()
    expect(await store.read('test-id')).toBeNull()
    expect(session.all()).toEqual({})
  })

  test('regenerate issues a new session ID and destroys the old one', async () => {
    session.put('before', true)
    await session.save()

    const oldId = session.id
    const newId = await session.regenerate()

    expect(newId).not.toBe(oldId)
    expect(session.id).toBe(newId)
    expect(await store.read(oldId)).toBeNull()
  })

  test('session is initialised from stored data', async () => {
    await store.write('init-id', { data: { role: 'admin' }, flash: {} }, 3600)
    const loaded = new Session('init-id', store, 3600, {
      data: { role: 'admin' },
      flash: {},
    })
    expect<unknown>(loaded.get('role')).toBe('admin')
  })
})


describe('Flash data save/read cycle', () => {
  test('flash data survives a save and can be read back from raw store', async () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-cycle', store, 3600)
    session.flash('notice', 'record saved')
    await session.save()

    const raw = await store.read('flash-cycle')
    expect(raw).not.toBeNull()
    expect((raw as any).flash.notice).toBe('record saved')
  })

  test('flash data loaded into a new Session instance is accessible', async () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-load', store, 3600)
    session.flash('alert', 'danger')
    await session.save()

    const raw = await store.read('flash-load')
    const reloaded = new Session('flash-load', store, 3600, raw as Record<string, unknown>)
    expect(reloaded.hasFlash('alert')).toBe(true)
    expect<unknown>(reloaded.getFlash('alert')).toBe('danger')
  })

  test('flash data is consumed (removed) after getFlash', () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-consume', store, 3600)
    session.flash('msg', 'hi')
    session.getFlash('msg')
    expect(session.hasFlash('msg')).toBe(false)
  })
})


describe('Session regenerate', () => {
  test('regenerate returns a string ID', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-1', store, 3600)
    const newId = await session.regenerate()
    expect(typeof newId).toBe('string')
    expect(newId.length).toBeGreaterThan(0)
  })

  test('new ID differs from old ID', async () => {
    const store = new MemorySessionStore()
    const session = new Session('old-id-42', store, 3600)
    session.put('x', 1)
    await session.save()
    const newId = await session.regenerate()
    expect(newId).not.toBe('old-id-42')
  })

  test('old session entry is destroyed after regenerate', async () => {
    const store = new MemorySessionStore()
    const session = new Session('pre-regen', store, 3600)
    session.put('secret', 'data')
    await session.save()
    await session.regenerate()
    expect(await store.read('pre-regen')).toBeNull()
  })

  test('data is retained on the session object after regenerate', async () => {
    const store = new MemorySessionStore()
    const session = new Session('keep-data', store, 3600)
    session.put('user', 'alice')
    await session.save()
    await session.regenerate()
    expect<unknown>(session.get('user')).toBe('alice')
  })
})


describe('Session destroy', () => {
  test('destroy clears all in-memory data', async () => {
    const store = new MemorySessionStore()
    const session = new Session('destroy-1', store, 3600)
    session.put('a', 1)
    session.put('b', 2)
    await session.destroy()
    expect(session.all()).toEqual({})
  })

  test('destroy removes the session from the store', async () => {
    const store = new MemorySessionStore()
    const session = new Session('destroy-2', store, 3600)
    session.put('key', 'val')
    await session.save()
    await session.destroy()
    expect(await store.read('destroy-2')).toBeNull()
  })

  test('destroy also clears flash data', async () => {
    const store = new MemorySessionStore()
    const session = new Session('destroy-3', store, 3600)
    session.flash('notice', 'hello')
    await session.destroy()
    expect(session.flashAll()).toEqual({})
  })
})


describe('Session increment/decrement edge cases', () => {
  test('increment on a missing key starts from 0', () => {
    const store = new MemorySessionStore()
    const session = new Session('inc-1', store, 3600)
    expect(session.increment('counter')).toBe(1)
  })

  test('increment by large amount', () => {
    const store = new MemorySessionStore()
    const session = new Session('inc-2', store, 3600)
    session.put('score', 0)
    expect(session.increment('score', 1000)).toBe(1000)
  })

  test('decrement below zero is allowed', () => {
    const store = new MemorySessionStore()
    const session = new Session('dec-1', store, 3600)
    session.put('hp', 5)
    expect(session.decrement('hp', 10)).toBe(-5)
  })

  test('decrement on missing key starts from 0 and goes negative', () => {
    const store = new MemorySessionStore()
    const session = new Session('dec-2', store, 3600)
    expect(session.decrement('missing')).toBe(-1)
  })

  test('increment then decrement returns to original', () => {
    const store = new MemorySessionStore()
    const session = new Session('inc-dec', store, 3600)
    session.put('val', 10)
    session.increment('val', 5)
    session.decrement('val', 5)
    expect<unknown>(session.get('val')).toBe(10)
  })
})


describe('Session pull removes key after getting', () => {
  test('pull returns value and removes it', () => {
    const store = new MemorySessionStore()
    const session = new Session('pull-1', store, 3600)
    session.put('temp', 'one-time')
    expect<unknown>(session.pull('temp')).toBe('one-time')
    expect(session.has('temp')).toBe(false)
  })

  test('pull on missing key with default returns default', () => {
    const store = new MemorySessionStore()
    const session = new Session('pull-2', store, 3600)
    expect<unknown>(session.pull('nope', 'fallback')).toBe('fallback')
  })

  test('pull on missing key without default returns undefined', () => {
    const store = new MemorySessionStore()
    const session = new Session('pull-3', store, 3600)
    expect<unknown>(session.pull('absent')).toBeUndefined()
  })

  test('has returns false after pull', () => {
    const store = new MemorySessionStore()
    const session = new Session('pull-4', store, 3600)
    session.put('x', 99)
    session.pull('x')
    expect(session.has('x')).toBe(false)
  })
})


describe('Session all() returns copy not reference', () => {
  test('mutating the result of all() does not affect session data', () => {
    const store = new MemorySessionStore()
    const session = new Session('all-copy', store, 3600)
    session.put('name', 'alice')
    const copy = session.all()
    copy['name'] = 'bob'
    // Session should still have 'alice'
    expect<unknown>(session.get('name')).toBe('alice')
  })

  test('adding keys to the result of all() does not affect session', () => {
    const store = new MemorySessionStore()
    const session = new Session('all-copy-2', store, 3600)
    const snapshot = session.all()
    snapshot['injected'] = true
    expect(session.has('injected')).toBe(false)
  })
})


describe('Session nested objects', () => {
  test('can store and retrieve a deeply nested object', () => {
    const store = new MemorySessionStore()
    const session = new Session('nested-1', store, 3600)
    const nested = { user: { profile: { address: { city: 'Istanbul' } } } }
    session.put('nested', nested)
    expect<unknown>(session.get('nested')).toEqual(nested)
  })

  test('can store and retrieve an array value', () => {
    const store = new MemorySessionStore()
    const session = new Session('nested-2', store, 3600)
    session.put('tags', ['a', 'b', 'c'])
    expect<unknown>(session.get('tags')).toEqual(['a', 'b', 'c'])
  })

  test('nested object survives save/reload cycle', async () => {
    const store = new MemorySessionStore()
    const session = new Session('nested-3', store, 3600)
    const obj = { level1: { level2: { value: 42 } } }
    session.put('deep', obj)
    await session.save()

    const raw = await store.read('nested-3')
    const reloaded = new Session('nested-3', store, 3600, raw as Record<string, unknown>)
    expect(reloaded.get<typeof obj>('deep')).toEqual(obj)
  })
})


describe('MemorySessionStore expiry', () => {
  test('session expires and read returns null after TTL', async () => {
    const store = new MemorySessionStore()
    await store.write('exp-1', { data: { x: 1 }, flash: {} }, 0.001) // 1 ms
    await Bun.sleep(5)
    expect(await store.read('exp-1')).toBeNull()
  })

  test('session is still readable before TTL expires', async () => {
    const store = new MemorySessionStore()
    await store.write('exp-2', { data: { y: 2 }, flash: {} }, 3600)
    expect(await store.read('exp-2')).not.toBeNull()
  })

  test('touch extends TTL preventing expiry', async () => {
    const store = new MemorySessionStore()
    await store.write('exp-3', { data: { z: 3 }, flash: {} }, 0.005) // 5 ms
    await store.touch('exp-3', 3600) // extend before expiry
    await Bun.sleep(10)
    expect(await store.read('exp-3')).not.toBeNull()
  })

  test('write after expiry creates a fresh entry', async () => {
    const store = new MemorySessionStore()
    await store.write('exp-4', { data: { a: 1 }, flash: {} }, 0.001)
    await Bun.sleep(5)
    // Now write again with long TTL
    await store.write('exp-4', { data: { a: 2 }, flash: {} }, 3600)
    const result = await store.read('exp-4')
    expect(result).not.toBeNull()
    expect((result as any).data.a).toBe(2)
  })

  test('multiple independent sessions expire independently', async () => {
    const store = new MemorySessionStore()
    await store.write('short', { data: { v: 1 }, flash: {} }, 0.001)
    await store.write('long', { data: { v: 2 }, flash: {} }, 3600)
    await Bun.sleep(5)
    expect(await store.read('short')).toBeNull()
    expect(await store.read('long')).not.toBeNull()
  })
})

// Additional: Session get/put/has/all/pull/forget/clear — extended

describe('Session — data operations extended', () => {
  test('put overwrites an existing key', () => {
    const store = new MemorySessionStore()
    const session = new Session('overwrite-1', store, 3600)
    session.put('key', 'first')
    session.put('key', 'second')
    expect<unknown>(session.get('key')).toBe('second')
  })

  test('has returns false after forget', () => {
    const store = new MemorySessionStore()
    const session = new Session('forget-has', store, 3600)
    session.put('x', 1)
    session.forget('x')
    expect(session.has('x')).toBe(false)
    expect<unknown>(session.get('x')).toBeUndefined()
  })

  test('clear followed by put works correctly', () => {
    const store = new MemorySessionStore()
    const session = new Session('clear-put', store, 3600)
    session.put('a', 1)
    session.put('b', 2)
    session.clear()
    session.put('c', 3)
    expect(session.all()).toEqual({ c: 3 })
  })

  test('all returns empty object for a fresh session', () => {
    const store = new MemorySessionStore()
    const session = new Session('empty-all', store, 3600)
    expect(session.all()).toEqual({})
  })

  test('pull returns value and subsequent get returns undefined', () => {
    const store = new MemorySessionStore()
    const session = new Session('pull-get', store, 3600)
    session.put('token', 'abc123')
    expect<unknown>(session.pull('token')).toBe('abc123')
    expect<unknown>(session.get('token')).toBeUndefined()
  })
})

// Additional: Session flash/getFlash — flash data cleared after read

describe('Session — flash data lifecycle', () => {
  test('flash value is available via getFlash', () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-lc-1', store, 3600)
    session.flash('msg', 'hello')
    expect<unknown>(session.getFlash('msg')).toBe('hello')
  })

  test('getFlash clears the flash value after reading', () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-lc-2', store, 3600)
    session.flash('notice', 'saved')
    session.getFlash('notice')
    expect(session.hasFlash('notice')).toBe(false)
    expect<unknown>(session.getFlash('notice')).toBeUndefined()
  })

  test('flash does not affect regular session data', () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-regular', store, 3600)
    session.put('user', 'alice')
    session.flash('msg', 'welcome')
    expect<unknown>(session.get('user')).toBe('alice')
    expect<unknown>(session.getFlash('msg')).toBe('welcome')
    // user is still there
    expect<unknown>(session.get('user')).toBe('alice')
  })

  test('multiple flash values are independent', () => {
    const store = new MemorySessionStore()
    const session = new Session('flash-multi', store, 3600)
    session.flash('a', 'val-a')
    session.flash('b', 'val-b')
    expect<unknown>(session.getFlash('a')).toBe('val-a')
    expect(session.hasFlash('b')).toBe(true)
    expect<unknown>(session.getFlash('b')).toBe('val-b')
  })
})

// Additional: MemorySessionStore — create/read/update/destroy

describe('MemorySessionStore — CRUD operations extended', () => {
  test('write creates a new entry that can be read', async () => {
    const store = new MemorySessionStore()
    await store.write('crud-1', { data: { x: 1 }, flash: {} }, 3600)
    const result = await store.read('crud-1')
    expect(result).not.toBeNull()
    expect((result as any).data.x).toBe(1)
  })

  test('write updates an existing entry', async () => {
    const store = new MemorySessionStore()
    await store.write('crud-2', { data: { v: 'old' }, flash: {} }, 3600)
    await store.write('crud-2', { data: { v: 'new' }, flash: {} }, 3600)
    const result = await store.read('crud-2')
    expect((result as any).data.v).toBe('new')
  })

  test('destroy removes the entry completely', async () => {
    const store = new MemorySessionStore()
    await store.write('crud-3', { data: {}, flash: {} }, 3600)
    await store.destroy('crud-3')
    expect(await store.read('crud-3')).toBeNull()
  })

  test('destroy on non-existent key does not throw', async () => {
    const store = new MemorySessionStore()
    await expect(store.destroy('non-existent')).resolves.toBeUndefined()
  })
})

// Additional: createSession factory function

describe('createSession factory', () => {
  test('createSession returns a middleware function', async () => {
    const { createSession } = await import('../src/index')
    const middleware = createSession()
    expect(typeof middleware).toBe('function')
  })

  test('createSession with config returns a middleware function', async () => {
    const { createSession } = await import('../src/index')
    const middleware = createSession({ age: 1800 })
    expect(typeof middleware).toBe('function')
  })
})

// Additional: Session regenerate creates new ID

describe('Session — regenerate extended', () => {
  test('regenerate produces a unique ID each time', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-unique', store, 3600)
    session.put('k', 'v')
    await session.save()

    const id1 = await session.regenerate()
    session.put('k2', 'v2')
    await session.save()

    const id2 = await session.regenerate()
    expect(id1).not.toBe(id2)
    expect(id1).not.toBe('regen-unique')
    expect(id2).not.toBe('regen-unique')
  })

  test('regenerate preserves session data across ID change', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-preserve', store, 3600)
    session.put('role', 'admin')
    session.put('lang', 'en')
    await session.save()

    await session.regenerate()
    expect<unknown>(session.get('role')).toBe('admin')
    expect<unknown>(session.get('lang')).toBe('en')
  })

  test('session.id is updated to the new value after regenerate', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-id-update', store, 3600)
    await session.save()

    const newId = await session.regenerate()
    expect(session.id).toBe(newId)
    expect(session.id).not.toBe('regen-id-update')
  })
})

// Additional Session tests

describe('Session — additional data operations', () => {
  test('put and get string value', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s1', store, 3600)
    session.put('name', 'Alice')
    expect<unknown>(session.get('name')).toBe('Alice')
  })

  test('put and get number value', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s2', store, 3600)
    session.put('count', 42)
    expect<unknown>(session.get('count')).toBe(42)
  })

  test('put and get object value', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s3', store, 3600)
    session.put('user', { id: 1, name: 'Ali' })
    expect<unknown>(session.get('user')).toEqual({ id: 1, name: 'Ali' })
  })

  test('get returns default for missing key', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s4', store, 3600)
    expect<unknown>(session.get('missing', 'default')).toBe('default')
  })

  test('has returns true for existing key', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s5', store, 3600)
    session.put('exists', true)
    expect(session.has('exists')).toBe(true)
  })

  test('has returns false for missing key', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s6', store, 3600)
    expect(session.has('nope')).toBe(false)
  })

  test('forget removes a key', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s7', store, 3600)
    session.put('temp', 'value')
    session.forget('temp')
    expect(session.has('temp')).toBe(false)
  })

  test('clear removes all data', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s8', store, 3600)
    session.put('a', 1)
    session.put('b', 2)
    session.clear()
    expect(session.has('a')).toBe(false)
    expect(session.has('b')).toBe(false)
  })

  test('save persists data to store', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s9', store, 3600)
    session.put('persisted', 'yes')
    await session.save()
    const data = await store.read('s9')
    expect(data).not.toBeNull()
  })

  test('multiple puts overwrite correctly', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s10', store, 3600)
    session.put('key', 'first')
    session.put('key', 'second')
    session.put('key', 'third')
    expect<unknown>(session.get('key')).toBe('third')
  })

  test('session id is accessible', () => {
    const store = new MemorySessionStore()
    const session = new Session('my-session-id', store, 3600)
    expect(session.id).toBe('my-session-id')
  })

  test('put boolean value', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s11', store, 3600)
    session.put('active', true)
    session.put('deleted', false)
    expect<unknown>(session.get('active')).toBe(true)
    expect<unknown>(session.get('deleted')).toBe(false)
  })

  test('put array value', async () => {
    const store = new MemorySessionStore()
    const session = new Session('s12', store, 3600)
    session.put('items', [1, 2, 3])
    expect<unknown>(session.get('items')).toEqual([1, 2, 3])
  })
})

describe('MemorySessionStore — additional', () => {
  test('write and read multiple sessions', async () => {
    const store = new MemorySessionStore()
    await store.write('a', { x: 1 }, 3600)
    await store.write('b', { y: 2 }, 3600)
    expect(await store.read('a')).toEqual({ x: 1 })
    expect(await store.read('b')).toEqual({ y: 2 })
  })

  test('destroy non-existent session does not throw', async () => {
    const store = new MemorySessionStore()
    await store.destroy('nonexistent') // should not throw
    expect(await store.read('nonexistent')).toBeNull()
  })

  test('read after destroy returns null', async () => {
    const store = new MemorySessionStore()
    await store.write('del-me', { data: true }, 3600)
    await store.destroy('del-me')
    expect(await store.read('del-me')).toBeNull()
  })

  test('write with different TTL values', async () => {
    const store = new MemorySessionStore()
    await store.write('short', { ttl: 'short' }, 1)
    await store.write('long', { ttl: 'long' }, 86400)
    expect(await store.read('short')).toEqual({ ttl: 'short' })
    expect(await store.read('long')).toEqual({ ttl: 'long' })
  })
})

// NEW TESTS: Deep edge cases for Session

describe('Session — flash data lifecycle deep', () => {
  test('flash overwrites existing flash key', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-1', store, 3600)
    session.flash('msg', 'first')
    session.flash('msg', 'second')
    expect<unknown>(session.getFlash('msg')).toBe('second')
  })

  test('getFlash returns undefined for never-set key', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-2', store, 3600)
    expect<unknown>(session.getFlash('never-set')).toBeUndefined()
  })

  test('hasFlash returns false for never-set key', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-3', store, 3600)
    expect(session.hasFlash('ghost')).toBe(false)
  })

  test('flashAll returns empty object when no flash data', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-4', store, 3600)
    expect(session.flashAll()).toEqual({})
  })

  test('flash data does not pollute regular data', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-5', store, 3600)
    session.flash('msg', 'flash-value')
    expect<unknown>(session.get('msg')).toBeUndefined()
  })

  test('regular data does not pollute flash data', () => {
    const store = new MemorySessionStore()
    const session = new Session('fo-6', store, 3600)
    session.put('msg', 'regular-value')
    expect(session.hasFlash('msg')).toBe(false)
  })
})

describe('Session — destroy edge cases', () => {
  test('destroy then put then save creates a new session', async () => {
    const store = new MemorySessionStore()
    const session = new Session('dest-1', store, 3600)
    session.put('key', 'val')
    await session.save()
    await session.destroy()
    session.put('new-key', 'new-val')
    await session.save()
    const raw = await store.read('dest-1')
    expect(raw).not.toBeNull()
    expect((raw as any).data['new-key']).toBe('new-val')
  })

  test('destroy clears flash and regular data', async () => {
    const store = new MemorySessionStore()
    const session = new Session('dest-2', store, 3600)
    session.put('a', 1)
    session.flash('b', 2)
    await session.destroy()
    expect(session.all()).toEqual({})
    expect(session.flashAll()).toEqual({})
  })
})

describe('Session — regenerate edge cases', () => {
  test('regenerate preserves flash data', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-flash', store, 3600)
    session.flash('notice', 'important')
    session.put('user', 'alice')
    await session.save()
    await session.regenerate()
    expect(session.hasFlash('notice')).toBe(true)
    expect<unknown>(session.get('user')).toBe('alice')
  })

  test('regenerate multiple times produces unique IDs each time', async () => {
    const store = new MemorySessionStore()
    const session = new Session('regen-multi', store, 3600)
    session.put('x', 1)
    await session.save()
    const ids = new Set<string>()
    ids.add(session.id)
    for (let i = 0; i < 5; i++) {
      const newId = await session.regenerate()
      ids.add(newId)
      session.put('x', i)
      await session.save()
    }
    expect(ids.size).toBe(6)
  })
})

describe('MemorySessionStore — write and read complex data', () => {
  test('stores nested objects correctly', async () => {
    const store = new MemorySessionStore()
    const data = { user: { profile: { name: 'Ali', settings: { theme: 'dark' } } } }
    await store.write('complex-1', data, 3600)
    const result = await store.read('complex-1')
    expect(result).toEqual(data)
  })

  test('stores arrays correctly', async () => {
    const store = new MemorySessionStore()
    const data = { items: [1, 2, 3], tags: ['a', 'b'] }
    await store.write('arr-1', data, 3600)
    expect(await store.read('arr-1')).toEqual(data)
  })

  test('overwrite with completely different structure works', async () => {
    const store = new MemorySessionStore()
    await store.write('ow-1', { a: 1 }, 3600)
    await store.write('ow-1', { b: 'hello', c: [1, 2] }, 3600)
    expect(await store.read('ow-1')).toEqual({ b: 'hello', c: [1, 2] })
  })
})

describe('Session — put/get type preservation', () => {
  test('stores and retrieves Date-like string', () => {
    const store = new MemorySessionStore()
    const session = new Session('types-1', store, 3600)
    session.put('date', '2025-01-01T00:00:00.000Z')
    expect<unknown>(session.get('date')).toBe('2025-01-01T00:00:00.000Z')
  })

  test('stores and retrieves null (has may return false for null)', () => {
    const store = new MemorySessionStore()
    const session = new Session('types-2', store, 3600)
    session.put('nil', null)
    // get returns undefined for null values (session stores may treat null as absent)
    const val = session.get('nil')
    // Accept either null or undefined depending on implementation
    expect(val === null || val === undefined).toBe(true)
  })

  test('stores and retrieves deeply nested object', () => {
    const store = new MemorySessionStore()
    const session = new Session('types-3', store, 3600)
    const deep = { a: { b: { c: { d: [1, 2, 3] } } } }
    session.put('deep', deep)
    expect<unknown>(session.get('deep')).toEqual(deep)
  })

  test('stores and retrieves empty object', () => {
    const store = new MemorySessionStore()
    const session = new Session('types-4', store, 3600)
    session.put('empty', {})
    expect<unknown>(session.get('empty')).toEqual({})
  })

  test('stores and retrieves empty array', () => {
    const store = new MemorySessionStore()
    const session = new Session('types-5', store, 3600)
    session.put('arr', [])
    expect<unknown>(session.get('arr')).toEqual([])
  })
})

describe('Session — many keys', () => {
  test('storing and retrieving 100 keys works', () => {
    const store = new MemorySessionStore()
    const session = new Session('many-1', store, 3600)
    for (let i = 0; i < 100; i++) {
      session.put(`key-${i}`, i)
    }
    for (let i = 0; i < 100; i++) {
      expect<unknown>(session.get(`key-${i}`)).toBe(i)
    }
    expect(Object.keys(session.all()).length).toBe(100)
  })

  test('forget specific key among many', () => {
    const store = new MemorySessionStore()
    const session = new Session('many-2', store, 3600)
    for (let i = 0; i < 10; i++) {
      session.put(`k${i}`, i)
    }
    session.forget('k5')
    expect(session.has('k5')).toBe(false)
    expect(session.has('k4')).toBe(true)
    expect(session.has('k6')).toBe(true)
  })
})

describe('MemorySessionStore — many sessions', () => {
  test('100 independent sessions work correctly', async () => {
    const store = new MemorySessionStore()
    for (let i = 0; i < 100; i++) {
      await store.write(`sess-${i}`, { id: i }, 3600)
    }
    for (let i = 0; i < 100; i++) {
      const data = await store.read(`sess-${i}`)
      expect(data).toEqual({ id: i })
    }
  })

  test('destroying one session does not affect others', async () => {
    const store = new MemorySessionStore()
    await store.write('keep', { v: 1 }, 3600)
    await store.write('remove', { v: 2 }, 3600)
    await store.destroy('remove')
    expect(await store.read('keep')).toEqual({ v: 1 })
    expect(await store.read('remove')).toBeNull()
  })
})
