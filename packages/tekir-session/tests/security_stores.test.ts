import { test, expect, describe, beforeEach } from 'bun:test'
import { MemorySessionStore } from '../src/stores/memory'
import { Session } from '../src/session'

describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => { store = new MemorySessionStore() })

  test('write and read roundtrip', async () => {
    await store.write('s1', { user: 'ali' }, 60)
    expect(await store.read('s1')).toEqual({ user: 'ali' })
  })

  test('read returns null for missing session', async () => {
    expect(await store.read('nonexistent')).toBeNull()
  })

  test('destroy removes session', async () => {
    await store.write('s2', { a: 1 }, 60)
    await store.destroy('s2')
    expect(await store.read('s2')).toBeNull()
  })

  test('touch updates expiry', async () => {
    await store.write('s3', { b: 2 }, 1)
    await store.touch('s3', 3600)
    expect(await store.read('s3')).toEqual({ b: 2 })
  })

  test('expired session returns null', async () => {
    await store.write('expired', { c: 3 }, -1)
    expect(await store.read('expired')).toBeNull()
  })

  test('multiple sessions are isolated', async () => {
    await store.write('a', { x: 1 }, 60)
    await store.write('b', { y: 2 }, 60)
    expect(await store.read('a')).toEqual({ x: 1 })
    expect(await store.read('b')).toEqual({ y: 2 })
  })

  test('overwrite existing session', async () => {
    await store.write('ow', { v: 1 }, 60)
    await store.write('ow', { v: 2 }, 60)
    expect(await store.read('ow')).toEqual({ v: 2 })
  })

  test('destroy nonexistent does not throw', async () => {
    await expect(store.destroy('ghost')).resolves.toBeUndefined()
  })
})

describe('Session object', () => {
  let store: MemorySessionStore

  beforeEach(() => { store = new MemorySessionStore() })

  test('get/put works', () => {
    const sess = new Session('id1', store, 60)
    sess.put('key', 'value')
    expect<unknown>(sess.get('key')).toBe('value')
  })

  test('has returns true for existing key', () => {
    const sess = new Session('id2', store, 60)
    sess.put('exists', true)
    expect(sess.has('exists')).toBe(true)
  })

  test('has returns false for missing key', () => {
    const sess = new Session('id3', store, 60)
    expect(sess.has('missing')).toBe(false)
  })

  test('forget removes key', () => {
    const sess = new Session('id4', store, 60)
    sess.put('temp', 'data')
    sess.forget('temp')
    expect<unknown>(sess.get('temp')).toBeUndefined()
  })

  test('all returns all data', () => {
    const sess = new Session('id5', store, 60)
    sess.put('a', 1)
    sess.put('b', 2)
    const all = sess.all()
    expect(all.a).toBe(1)
    expect(all.b).toBe(2)
  })

  test('clear clears all data', () => {
    const sess = new Session('id6', store, 60)
    sess.put('x', 1)
    sess.clear()
    expect<unknown>(sess.get('x')).toBeUndefined()
  })

  test('flash/getFlash roundtrip', () => {
    const sess = new Session('id7', store, 60)
    sess.flash('msg', 'hello')
    expect<unknown>(sess.getFlash('msg')).toBe('hello')
    expect<unknown>(sess.getFlash('msg')).toBeUndefined() // consumed
  })

  test('regenerate creates new ID', async () => {
    const sess = new Session('old-id', store, 60)
    sess.put('data', 'kept')
    const newId = await sess.regenerate()
    expect(newId).not.toBe('old-id')
    expect(sess.id).toBe(newId)
  })

  test('save persists to store', async () => {
    const sess = new Session('save-id', store, 60)
    sess.put('saved', true)
    await sess.save()
    const data = await store.read('save-id') as any
    expect(data?.data?.saved).toBe(true)
  })

  test('pull gets and removes', () => {
    const sess = new Session('pull-id', store, 60)
    sess.put('temp', 'value')
    expect<unknown>(sess.pull('temp')).toBe('value')
    expect<unknown>(sess.get('temp')).toBeUndefined()
  })

  test('increment works', () => {
    const sess = new Session('inc-id', store, 60)
    sess.put('count', 5)
    sess.increment('count')
    expect<unknown>(sess.get('count')).toBe(6)
  })

  test('decrement works', () => {
    const sess = new Session('dec-id', store, 60)
    sess.put('count', 5)
    sess.decrement('count')
    expect<unknown>(sess.get('count')).toBe(4)
  })

  test('increment with amount', () => {
    const sess = new Session('inc2-id', store, 60)
    sess.put('count', 10)
    sess.increment('count', 5)
    expect<unknown>(sess.get('count')).toBe(15)
  })

  test('id property returns session ID', () => {
    const sess = new Session('my-id', store, 60)
    expect(sess.id).toBe('my-id')
  })

  test('constructor with initial data', () => {
    const sess = new Session('init-id', store, 60, { data: { preloaded: true }, flash: {} })
    expect<unknown>(sess.get('preloaded')).toBe(true)
  })
})
