import { test, expect, describe } from 'bun:test'
import { limiter } from '../src/limiter'
import { MemoryStore } from '../src/store'

function mockCtx(opts: { ip?: string; xff?: string } = {}) {
  const headers: Record<string, string> = {}
  return {
    request: {
      ip: opts.ip ?? '',
      header: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? (opts.xff ?? null) : null),
    },
    response: { header: (n: string, v: string) => { headers[n] = v } },
    route: { pattern: '/login' },
    auth: undefined,
    _headers: headers,
  }
}

describe('X-Forwarded-For trust', () => {
  test('without trustProxy, rotating XFF does NOT create new buckets (uses socket IP)', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    const mw = limiter({ max: 2, window: 60, store }) // trustProxy defaults false

    // Same socket IP, attacker rotates XFF on every request.
    await mw(mockCtx({ ip: '10.0.0.1', xff: '1.1.1.1' }) as any, async () => {})
    await mw(mockCtx({ ip: '10.0.0.1', xff: '2.2.2.2' }) as any, async () => {})

    let blocked = false
    try {
      await mw(mockCtx({ ip: '10.0.0.1', xff: '3.3.3.3' }) as any, async () => {})
    } catch {
      blocked = true
    }
    // All three share the same socket-IP bucket, so the 3rd is rejected.
    expect(blocked).toBe(true)
    store.stop()
  })

  test('with trustProxy:true, left-most XFF entry is used', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    const mw = limiter({ max: 1, window: 60, store, trustProxy: true })

    // Distinct clients behind the proxy get distinct buckets.
    let firstBlocked = false
    try { await mw(mockCtx({ ip: '10.0.0.1', xff: '1.1.1.1, 10.0.0.1' }) as any, async () => {}) } catch { firstBlocked = true }
    let secondBlocked = false
    try { await mw(mockCtx({ ip: '10.0.0.1', xff: '2.2.2.2, 10.0.0.1' }) as any, async () => {}) } catch { secondBlocked = true }

    expect(firstBlocked).toBe(false)
    expect(secondBlocked).toBe(false)

    // Same client (1.1.1.1) again -> exceeds its own bucket.
    let repeatBlocked = false
    try { await mw(mockCtx({ ip: '10.0.0.1', xff: '1.1.1.1, 10.0.0.1' }) as any, async () => {}) } catch { repeatBlocked = true }
    expect(repeatBlocked).toBe(true)
    store.stop()
  })

  test('with trustProxy:1, picks the entry one hop from the right', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    const mw = limiter({ max: 1, window: 60, store, trustProxy: 1 })
    // XFF: client, proxy. With 1 trusted proxy, the client (left of the proxy) is used.
    let blocked = false
    await mw(mockCtx({ ip: '10.0.0.1', xff: '9.9.9.9, 10.0.0.1' }) as any, async () => {})
    try { await mw(mockCtx({ ip: '10.0.0.1', xff: '9.9.9.9, 10.0.0.1' }) as any, async () => {}) } catch { blocked = true }
    expect(blocked).toBe(true)
    store.stop()
  })
})

describe('MemoryStore eviction', () => {
  test('expired entries are swept, bounding memory', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    // Tiny 1ms window so entries expire almost immediately.
    for (let i = 0; i < 50; i++) {
      await store.check(`unique-key-${i}`, 5, 1)
    }
    expect(store.size).toBe(50)
    await new Promise(r => setTimeout(r, 10))
    store.sweep()
    expect(store.size).toBe(0)
  })

  test('get() lazily evicts an expired entry', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    await store.check('k', 5, 1)
    expect(store.size).toBe(1)
    await new Promise(r => setTimeout(r, 10))
    const r = await store.get('k')
    expect(r).toBeNull()
    expect(store.size).toBe(0)
  })

  test('blocked entries are not swept until block expires', async () => {
    const store = new MemoryStore({ sweepIntervalMs: 0 })
    await store.check('blk', 1, 1)
    await store.block('blk', 10_000)
    await new Promise(r => setTimeout(r, 10))
    store.sweep()
    expect(store.size).toBe(1) // still blocked, retained
    store.stop()
  })
})
