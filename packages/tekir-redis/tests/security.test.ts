import { test, expect, describe, mock } from 'bun:test'
import { Redis } from '../src/index'

/**
 * These tests exercise the wrapper logic against a fake in-memory client so they
 * do not require a live Redis server. The fake records the raw commands issued
 * via client.send so we can assert atomicity (SET ... EX) and lock behaviour.
 */
function fakeRedis(config: any = {}) {
  const store = new Map<string, string>()
  const sent: any[][] = []
  const client: any = {
    connected: true,
    sent,
    store,
    async get(k: string) { return store.has(k) ? store.get(k)! : null },
    async set(k: string, v: string) { store.set(k, v) },
    async del(...keys: string[]) { let n = 0; for (const k of keys) { if (store.delete(k)) n++ } return n },
    async expire() {},
    async send(cmd: string, args: string[]) {
      sent.push([cmd, ...args])
      const c = cmd.toUpperCase()
      if (c === 'SET') {
        const [key, val, ...rest] = args
        const nx = rest.includes('NX')
        if (nx && store.has(key)) return null
        store.set(key, val)
        return 'OK'
      }
      if (c === 'DEL') { let n = 0; for (const k of args) { if (store.delete(k)) n++ } return n }
      if (c === 'SCAN') {
        const matchIdx = args.indexOf('MATCH')
        const pattern = matchIdx >= 0 ? args[matchIdx + 1] : '*'
        const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
        const keys = [...store.keys()].filter(k => re.test(k))
        return ['0', keys]
      }
      if (c === 'FLUSHDB') { store.clear(); return 'OK' }
      return null
    },
  }
  const redis = new Redis(config)
  ;(redis as any).client = client
  return { redis, client, store, sent }
}

describe('setJSON atomicity', () => {
  test('uses a single SET ... EX command when a TTL is given', async () => {
    const { redis, sent } = fakeRedis({ prefix: 'app' })
    await redis.setJSON('user:1', { name: 'Alice' }, 60)
    const setCmd = sent.find(c => c[0] === 'SET')
    expect(setCmd).toBeDefined()
    expect(setCmd).toEqual(['SET', 'app:user:1', JSON.stringify({ name: 'Alice' }), 'EX', '60'])
    // No separate EXPIRE call should be issued.
    expect(sent.find(c => c[0] === 'EXPIRE')).toBeUndefined()
  })

  test('floors fractional TTL seconds', async () => {
    const { redis, sent } = fakeRedis()
    await redis.setJSON('k', 1, 5.9)
    const setCmd = sent.find(c => c[0] === 'SET')
    expect(setCmd![4]).toBe('5')
  })

  test('uses plain set when no TTL', async () => {
    const { redis, sent, store } = fakeRedis()
    await redis.setJSON('k', { a: 1 })
    expect(sent.find(c => c[0] === 'SET')).toBeUndefined()
    expect(store.get('k')).toBe(JSON.stringify({ a: 1 }))
  })
})

describe('getJSON', () => {
  test('returns null and warns on corrupt payload', async () => {
    const { redis, store } = fakeRedis()
    store.set('bad', '{not json')
    const warn = mock(() => {})
    const orig = console.warn
    console.warn = warn as any
    try {
      const v = await redis.getJSON('bad')
      expect(v).toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      console.warn = orig
    }
  })

  test('parses valid payload', async () => {
    const { redis, store } = fakeRedis()
    store.set('good', JSON.stringify({ ok: true }))
    expect(await redis.getJSON<{ ok: boolean }>('good')).toEqual({ ok: true })
  })
})

describe('remember stampede protection', () => {
  test('only one of many concurrent callers runs the callback', async () => {
    const { redis } = fakeRedis({ prefix: 'app' })
    let calls = 0
    const factory = async () => { calls++; await new Promise(r => setTimeout(r, 50)); return { v: calls } }
    const results = await Promise.all([
      redis.remember('hot', 60, factory),
      redis.remember('hot', 60, factory),
      redis.remember('hot', 60, factory),
    ])
    expect(calls).toBe(1)
    // All callers receive the same populated value.
    for (const r of results) expect(r).toEqual({ v: 1 })
  })

  test('acquires lock via SET NX and releases it afterwards', async () => {
    const { redis, sent, store } = fakeRedis({ prefix: 'app' })
    await redis.remember('k', 30, async () => ({ ok: 1 }))
    const lockSet = sent.find(c => c[0] === 'SET' && c.includes('NX'))
    expect(lockSet).toBeDefined()
    // Lock key is removed in the finally block.
    expect(store.has('app:k:__lock')).toBe(false)
  })

  test('returns cached value without invoking callback', async () => {
    const { redis } = fakeRedis()
    await redis.setJSON('k', { cached: true })
    let called = false
    const v = await redis.remember('k', 60, async () => { called = true; return { cached: false } })
    expect(called).toBe(false)
    expect(v).toEqual({ cached: true })
  })
})

describe('clearPrefix scoping', () => {
  test('only deletes keys under the configured prefix', async () => {
    const { redis, store } = fakeRedis({ prefix: 'cache' })
    store.set('cache:a', '1')
    store.set('cache:b', '2')
    store.set('session:x', '3')
    const deleted = await redis.clearPrefix()
    expect(deleted).toBe(2)
    expect(store.has('cache:a')).toBe(false)
    expect(store.has('cache:b')).toBe(false)
    // Other stores sharing the DB are untouched.
    expect(store.has('session:x')).toBe(true)
  })

  test('deletes nothing when no prefix is configured', async () => {
    const { redis, store } = fakeRedis({})
    store.set('a', '1')
    const deleted = await redis.clearPrefix()
    expect(deleted).toBe(0)
    expect(store.has('a')).toBe(true)
  })
})

describe('URL credential masking', () => {
  test('maskUrl hides userinfo', () => {
    const mask = (Redis as any).maskUrl
    expect(mask('redis://user:secret@host:6379')).toBe('redis://***@host:6379')
    expect(mask('rediss://:pass@host:6380/0')).toBe('rediss://***@host:6380/0')
    expect(mask('redis://host:6379')).toBe('redis://host:6379')
  })
})

describe('clearPrefix vs flushdb', () => {
  test('both methods exist', () => {
    expect(typeof Redis.prototype.clearPrefix).toBe('function')
    expect(typeof Redis.prototype.flushdb).toBe('function')
  })
})
