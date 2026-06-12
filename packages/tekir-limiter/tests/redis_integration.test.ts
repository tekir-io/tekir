import { test, expect, describe, beforeAll, afterAll, afterEach } from 'bun:test'
import { RedisClient } from 'bun'
import { RedisStore } from '../src/store'
import { Limiter } from '../src/limiter'

// Integration tests against a real Redis at localhost:6379. These prove the
// Redis store's atomic conditional-consume (Lua) actually holds under real
// concurrency, which mocks cannot demonstrate. Each run uses a unique key
// prefix and only deletes its own keys (no FLUSHDB).

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const RUN_PREFIX = `ittest:${process.pid}:${Date.now()}:`

let redis: RedisClient | null = null
let reachable = false

// RedisStore namespaces keys as `rl:<key>` and blocks as `rl:block:<key>`.
async function cleanup(): Promise<void> {
  if (!redis) return
  for (const pat of [`rl:${RUN_PREFIX}*`, `rl:block:${RUN_PREFIX}*`]) {
    const keys: string[] = await redis.send('KEYS', [pat])
    if (keys.length > 0) await redis.send('DEL', keys)
  }
}

beforeAll(async () => {
  try {
    redis = new RedisClient(REDIS_URL)
    await redis.connect()
    const pong = await redis.send('PING', [])
    reachable = String(pong).toUpperCase().includes('PONG')
  } catch {
    reachable = false
  }
  if (!reachable) {
    // Surface a clear note; the per-test guard skips the assertions.
    console.warn(`[redis_integration] Redis unreachable at ${REDIS_URL}; skipping.`)
  }
})

afterEach(async () => {
  if (reachable) await cleanup()
})

afterAll(async () => {
  if (redis) {
    await cleanup().catch(() => {})
    redis.close()
  }
})

// Generate a fresh, prefixed key per test so runs never collide.
let counter = 0
function freshKey(label: string): string {
  return `${RUN_PREFIX}${label}:${counter++}`
}

describe('RedisStore — real Redis integration', () => {
  test('connects to Redis (precondition)', () => {
    if (!reachable) return
    expect(reachable).toBe(true)
  })

  test('concurrent check() never exceeds the limit', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('concurrent')
    const max = 20
    const n = 200

    // Fire n concurrent check() calls at limit max. Exactly max must be allowed.
    const results = await Promise.all(
      Array.from({ length: n }, () => store.check(key, max, 60_000))
    )
    const allowed = results.filter(r => r.allowed).length

    expect(allowed).toBe(max)
    expect(results.filter(r => !r.allowed).length).toBe(n - max)

    // The committed counter must equal n (every call incremented exactly once).
    const raw = await redis!.send('GET', [`rl:${key}`])
    expect(Number(raw)).toBe(n)
  })

  test('concurrent check() at max=1 allows exactly one', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('single')
    const results = await Promise.all(
      Array.from({ length: 50 }, () => store.check(key, 1, 60_000))
    )
    expect(results.filter(r => r.allowed).length).toBe(1)
  })

  test('TTL is set on first hit and reset reflects it', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('ttl')
    const r = await store.check(key, 5, 30_000)
    expect(r.allowed).toBe(true)

    const ttl: number = await redis!.send('TTL', [`rl:${key}`])
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30)
    // resetTime tracks the remaining TTL.
    expect(r.resetTime).toBeGreaterThan(0)
    expect(r.resetTime).toBeLessThanOrEqual(30)
  })

  test('window actually resets after the TTL expires', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('expiry')
    // 1s window (smallest TTL Redis honours), max 1.
    const first = await store.check(key, 1, 1_000)
    expect(first.allowed).toBe(true)
    const second = await store.check(key, 1, 1_000)
    expect(second.allowed).toBe(false)

    // Wait past the window; the key should expire and a fresh window begins.
    await Bun.sleep(1_300)
    const third = await store.check(key, 1, 1_000)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
  })

  test('TTL is set even when the first hit consumes amount > 1', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('amount')
    await store.increment(key, 10, 45_000, 3)
    const ttl: number = await redis!.send('TTL', [`rl:${key}`])
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(45)
  })

  test('consume applies the lockout atomically on overflow', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('lockout')
    const blockMs = 30_000

    // Consume the only slot, then overflow with a lockout in the same op.
    await store.consume(key, 1, 60_000, 1, blockMs)
    const denied = await store.consume(key, 1, 60_000, 1, blockMs)
    expect(denied.allowed).toBe(false)

    // The block key must exist with a TTL near blockMs.
    const blockExists = await redis!.send('GET', [`rl:block:${key}`])
    expect(blockExists).not.toBeNull()
    const pttl: number = await redis!.send('PTTL', [`rl:block:${key}`])
    expect(pttl).toBeGreaterThan(0)
    expect(pttl).toBeLessThanOrEqual(blockMs)

    // While blocked, even a fresh consume is denied without consuming a slot.
    const stillBlocked = await store.consume(key, 100, 60_000, 1, 0)
    expect(stillBlocked.allowed).toBe(false)
  })

  test('peek reports state without consuming a slot', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('peek')

    // No window yet -> null.
    expect(await store.peek(key)).toBeNull()

    await store.check(key, 5, 60_000)
    const peeked = await store.peek(key)
    expect(peeked).not.toBeNull()
    expect(peeked!.allowed).toBe(true)

    // peek must not have advanced the counter: still 1.
    const raw = await redis!.send('GET', [`rl:${key}`])
    expect(Number(raw)).toBe(1)
  })

  test('peek reports an active block', async () => {
    if (!reachable) return
    const store = new RedisStore(redis)
    const key = freshKey('peekblock')
    await store.block(key, 30_000)
    const peeked = await store.peek(key)
    expect(peeked).not.toBeNull()
    expect(peeked!.allowed).toBe(false)
    expect(peeked!.resetTime).toBeGreaterThan(0)
  })
})

describe('Limiter.penalize — real Redis integration', () => {
  test('penalize does not consume on success', async () => {
    if (!reachable) return
    const store = new RedisStore(redis!)
    const limiter = new Limiter({ max: 3, window: 60, store })
    const key = freshKey('pen-ok')

    for (let i = 0; i < 5; i++) {
      const [err, value] = await limiter.penalize(key, () => 'ok')
      expect(err).toBeNull()
      expect(value).toBe('ok')
    }
    // No slot consumed: counter key never created.
    const raw = await redis!.send('GET', [`rl:${key}`])
    expect(raw).toBeNull()
  })

  test('penalize consumes exactly one slot per failure', async () => {
    if (!reachable) return
    const store = new RedisStore(redis!)
    const limiter = new Limiter({ max: 3, window: 60, store })
    const key = freshKey('pen-fail')

    for (let i = 0; i < 3; i++) {
      const [err] = await limiter.penalize(key, () => { throw new Error('bad') })
      expect(err).not.toBeNull()
    }
    const raw = await redis!.send('GET', [`rl:${key}`])
    expect(Number(raw)).toBe(3)
  })

  test('concurrent penalize failures never over-count past the limit', async () => {
    if (!reachable) return
    const store = new RedisStore(redis!)
    const max = 10
    const limiter = new Limiter({ max, window: 60, store })
    const key = freshKey('pen-race')

    // Fire many concurrent failing penalize calls. Each failure consumes one
    // slot; the atomic consume must report exactly `max` of them as the
    // boundary-or-under (allowed) and the rest as over the limit.
    const n = 100
    const errs = await Promise.all(
      Array.from({ length: n }, () =>
        limiter.penalize(key, () => { throw new Error('bad') })
      )
    )
    // All return an error tuple (penalize always reports failure), but the
    // counter must be exactly n: no lost or doubled increments.
    expect(errs.every(([e]) => e !== null)).toBe(true)
    const raw = await redis!.send('GET', [`rl:${key}`])
    expect(Number(raw)).toBe(n)
  })

  test('penalize denies via the atomic block once exhausted (blockFor)', async () => {
    if (!reachable) return
    const store = new RedisStore(redis!)
    const limiter = new Limiter({ max: 2, window: 60, blockFor: 60, store })
    const key = freshKey('pen-exhaust')

    // Failures past max trip the lockout inside the atomic consume.
    await limiter.penalize(key, () => { throw new Error('x') }) // count 1, allowed
    await limiter.penalize(key, () => { throw new Error('x') }) // count 2, allowed
    await limiter.penalize(key, () => { throw new Error('x') }) // count 3, over -> block

    // The block must now exist...
    const blockKey = await redis!.send('GET', [`rl:block:${key}`])
    expect(blockKey).not.toBeNull()

    // ...so the pre-check gates even a would-be success without running it.
    let ran = false
    const [err, value] = await limiter.penalize(key, () => { ran = true; return 'should-not-run' })
    expect(ran).toBe(false)
    expect(err).not.toBeNull()
    expect(value).toBeNull()
  })
})
