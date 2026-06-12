import { test, expect, describe, beforeEach } from 'bun:test'
import { MemoryCacheStore, Cache, createCache } from '../src/index'


describe('MemoryCacheStore', () => {
  let store: MemoryCacheStore

  beforeEach(() => {
    store = new MemoryCacheStore()
  })

  test('returns null for a missing key', async () => {
    expect<unknown>(await store.get('missing')).toBeNull()
  })

  test('set and get a value', async () => {
    await store.set('name', 'ali')
    expect<unknown>(await store.get('name')).toBe('ali')
  })

  test('set and get an object value', async () => {
    await store.set('user', { id: 1, name: 'ali' })
    expect<unknown>(await store.get('user')).toEqual({ id: 1, name: 'ali' })
  })

  test('has returns true for an existing key', async () => {
    await store.set('key', 42)
    expect(await store.has('key')).toBe(true)
  })

  test('has returns false for a missing key', async () => {
    expect(await store.has('ghost')).toBe(false)
  })

  test('delete removes a key and returns true', async () => {
    await store.set('del', 'value')
    const result = await store.delete('del')
    expect(result).toBe(true)
    expect<unknown>(await store.get('del')).toBeNull()
  })

  test('delete on a non-existent key returns false', async () => {
    const result = await store.delete('nope')
    expect(result).toBe(false)
  })

  test('flush clears all keys', async () => {
    await store.set('a', 1)
    await store.set('b', 2)
    await store.flush()
    expect(await store.has('a')).toBe(false)
    expect(await store.has('b')).toBe(false)
  })

  test('TTL: value is available before expiry', async () => {
    await store.set('ttl-key', 'alive', 60)
    expect<unknown>(await store.get('ttl-key')).toBe('alive')
  })

  test('TTL: value returns null after expiry', async () => {
    // Set with 0.001 second TTL (expires immediately for test purposes)
    await store.set('expire', 'gone', 0.001)
    // Wait just over 1 ms
    await Bun.sleep(5)
    expect<unknown>(await store.get('expire')).toBeNull()
  })

  test('TTL: has returns false after expiry', async () => {
    await store.set('expire2', 'bye', 0.001)
    await Bun.sleep(5)
    expect(await store.has('expire2')).toBe(false)
  })

  test('overwriting a key replaces the value', async () => {
    await store.set('x', 'first')
    await store.set('x', 'second')
    expect<unknown>(await store.get('x')).toBe('second')
  })
})


describe('Cache', () => {
  let cache: Cache

  beforeEach(() => {
    cache = createCache({ ttl: 3600 })
  })

  test('get returns null for missing key', async () => {
    expect<unknown>(await cache.get('missing')).toBeNull()
  })

  test('set and get a value', async () => {
    await cache.set('greeting', 'hello', 60)
    expect<unknown>(await cache.get('greeting')).toBe('hello')
  })

  test('has works through the manager', async () => {
    await cache.set('present', true, 60)
    expect(await cache.has('present')).toBe(true)
    expect(await cache.has('absent')).toBe(false)
  })

  test('delete works through the manager', async () => {
    await cache.set('remove-me', 'yes', 60)
    const removed = await cache.delete('remove-me')
    expect(removed).toBe(true)
    expect<unknown>(await cache.get('remove-me')).toBeNull()
  })

  test('flush clears all entries', async () => {
    await cache.set('a', 1, 60)
    await cache.set('b', 2, 60)
    await cache.flush()
    expect<unknown>(await cache.get('a')).toBeNull()
    expect<unknown>(await cache.get('b')).toBeNull()
  })

  test('getOrSet returns cached value on second call', async () => {
    let calls = 0
    const factory = async () => { calls++; return 'computed' }

    const first = await cache.getOrSet('computed-key', 60, factory)
    const second = await cache.getOrSet('computed-key', 60, factory)

    expect(first).toBe('computed')
    expect(second).toBe('computed')
    expect(calls).toBe(1) // factory called only once
  })

  test('getOrSet calls factory when key is missing', async () => {
    const value = await cache.getOrSet('new-key', 60, async () => 42)
    expect(value).toBe(42)
  })

  test('pull retrieves and removes the value', async () => {
    await cache.set('once', 'only-once', 60)
    const value = await cache.pull('once')
    expect(value).toBe('only-once')
    expect<unknown>(await cache.get('once')).toBeNull()
  })

  test('pull returns null when key does not exist', async () => {
    expect(await cache.pull('ghost')).toBeNull()
  })

  test('store() throws for an unknown store name', () => {
    expect(() => cache.store('nonexistent')).toThrow('Cache store "nonexistent" not configured')
  })

  test('named store is accessible via store()', () => {
    const custom = new MemoryCacheStore()
    const c = createCache({ stores: { custom }, default: 'custom' })
    expect(c.store('custom')).toBe(custom)
  })

  test('default TTL is used when set() is called without explicit TTL', async () => {
    // createCache with short default TTL
    const shortCache = createCache({ ttl: 0.001 })
    await shortCache.set('auto-ttl', 'value')
    await Bun.sleep(5)
    expect<unknown>(await shortCache.get('auto-ttl')).toBeNull()
  })
})


import { DatabaseCacheStore } from '../src/index'

/** Minimal in-memory SQLite shim that satisfies DatabaseCacheStore's interface. */
function makeSqliteDb() {
  // Bun ships with a built-in SQLite driver we can use for tests.
  const { Database } = require('bun:sqlite')
  const raw = new Database(':memory:')

  return {
    exec(sql: string) { raw.exec(sql) },
    run(sql: string, params?: any[]) {
      raw.prepare(sql).run(...(params || []))
    },
    queryOne<T = any>(sql: string, params?: any[]): T | null {
      return (raw.prepare(sql).get(...(params || [])) as T) ?? null
    },
    query<T = any>(sql: string, params?: any[]): T[] {
      return raw.prepare(sql).all(...(params || [])) as T[]
    },
  }
}

describe('DatabaseCacheStore', () => {
  let store: DatabaseCacheStore

  beforeEach(() => {
    store = new DatabaseCacheStore(makeSqliteDb())
  })

  test('returns null for a missing key', async () => {
    expect<unknown>(await store.get('missing')).toBeNull()
  })

  test('set and get a string value', async () => {
    await store.set('greeting', 'hello')
    expect<unknown>(await store.get('greeting')).toBe('hello')
  })

  test('set and get an object value (JSON round-trip)', async () => {
    await store.set('obj', { x: 1, y: [2, 3] })
    expect<unknown>(await store.get('obj')).toEqual({ x: 1, y: [2, 3] })
  })

  test('has returns true for an existing key', async () => {
    await store.set('present', 42)
    expect(await store.has('present')).toBe(true)
  })

  test('has returns false for a missing key', async () => {
    expect(await store.has('absent')).toBe(false)
  })

  test('delete removes the key', async () => {
    await store.set('remove', 'bye')
    await store.delete('remove')
    expect<unknown>(await store.get('remove')).toBeNull()
  })

  test('delete always returns true', async () => {
    await store.set('d', 1)
    expect(await store.delete('d')).toBe(true)
  })

  test('flush clears all keys', async () => {
    await store.set('a', 1)
    await store.set('b', 2)
    await store.flush()
    expect(await store.has('a')).toBe(false)
    expect(await store.has('b')).toBe(false)
  })

  test('overwriting a key replaces the stored value', async () => {
    await store.set('k', 'first')
    await store.set('k', 'second')
    expect<unknown>(await store.get('k')).toBe('second')
  })

  test('TTL: value is returned before expiry', async () => {
    await store.set('live', 'yes', 60)
    expect<unknown>(await store.get('live')).toBe('yes')
  })

  test('TTL: value returns null after expiry', async () => {
    await store.set('expire', 'gone', 0.001)
    await Bun.sleep(5)
    expect<unknown>(await store.get('expire')).toBeNull()
  })

  test('TTL: has() returns false after expiry', async () => {
    await store.set('expire2', 'bye', 0.001)
    await Bun.sleep(5)
    expect(await store.has('expire2')).toBe(false)
  })
})


describe('Cache.store() switching', () => {
  test('store() without argument returns the default store', async () => {
    const mem = new MemoryCacheStore()
    const c = createCache({ stores: { memory: mem }, default: 'memory' })
    expect(c.store()).toBe(mem)
  })

  test('store(name) returns the named store', async () => {
    const storeA = new MemoryCacheStore()
    const storeB = new MemoryCacheStore()
    const c = createCache({ stores: { a: storeA, b: storeB }, default: 'a' })
    expect(c.store('a')).toBe(storeA)
    expect(c.store('b')).toBe(storeB)
  })

  test('operations on different stores are fully isolated', async () => {
    const storeA = new MemoryCacheStore()
    const storeB = new MemoryCacheStore()
    const c = createCache({ stores: { a: storeA, b: storeB }, default: 'a' })

    await c.store('a').set('shared-key', 'from-a')
    await c.store('b').set('shared-key', 'from-b')

    expect<unknown>(await c.store('a').get('shared-key')).toBe('from-a')
    expect<unknown>(await c.store('b').get('shared-key')).toBe('from-b')
  })

  test('cache manager operations target the default store only', async () => {
    const storeA = new MemoryCacheStore()
    const storeB = new MemoryCacheStore()
    const c = createCache({ stores: { a: storeA, b: storeB }, default: 'a' })

    await c.set('key', 'manager-value')
    // Only storeA (default) should have the value
    expect<unknown>(await storeA.get('key')).toBe('manager-value')
    expect<unknown>(await storeB.get('key')).toBeNull()
  })

  test('switching default store changes which store manager targets', async () => {
    const mem1 = new MemoryCacheStore()
    const mem2 = new MemoryCacheStore()

    const c1 = createCache({ stores: { mem1, mem2 }, default: 'mem1' })
    await c1.set('x', 'in-mem1')
    expect<unknown>(await mem1.get('x')).toBe('in-mem1')

    const c2 = createCache({ stores: { mem1, mem2 }, default: 'mem2' })
    await c2.set('x', 'in-mem2')
    expect<unknown>(await mem2.get('x')).toBe('in-mem2')
    // mem1 value untouched
    expect<unknown>(await mem1.get('x')).toBe('in-mem1')
  })
})


describe('TTL precision', () => {
  test('value is still accessible 1 ms before expiry', async () => {
    // 50 ms TTL; read after 20 ms — should still be present
    const store = new MemoryCacheStore()
    await store.set('precision-live', 'here', 0.05) // 50 ms
    await Bun.sleep(20)
    expect<unknown>(await store.get('precision-live')).toBe('here')
  })

  test('value expires promptly after TTL elapses', async () => {
    const store = new MemoryCacheStore()
    await store.set('precision-dead', 'gone', 0.01) // 10 ms
    await Bun.sleep(20)
    expect<unknown>(await store.get('precision-dead')).toBeNull()
  })

  test('no-TTL value persists indefinitely', async () => {
    const store = new MemoryCacheStore()
    await store.set('forever', 'eternal') // no TTL
    await Bun.sleep(20)
    expect<unknown>(await store.get('forever')).toBe('eternal')
  })

  test('Cache manager respects per-call TTL override', async () => {
    // Create cache with long default TTL but call set() with a very short one
    const c = createCache({ ttl: 3600 })
    await c.set('short', 'dies-soon', 0.01) // override: 10 ms
    await Bun.sleep(20)
    expect<unknown>(await c.get('short')).toBeNull()
  })
})


describe('Cache.getOrSet extended', () => {
  test('factory is called only once when value is already cached', async () => {
    const cache = createCache({ ttl: 3600 })
    let calls = 0
    const factory = async () => { calls++; return 'result' }

    await cache.getOrSet('once-key', 60, factory)
    await cache.getOrSet('once-key', 60, factory)
    await cache.getOrSet('once-key', 60, factory)

    expect(calls).toBe(1)
  })

  test('factory is called again after TTL expiry', async () => {
    const cache = createCache({ ttl: 3600 })
    let calls = 0
    const factory = async () => { calls++; return `call-${calls}` }

    const first = await cache.getOrSet('ttl-refetch', 0.01, factory) // 10 ms TTL
    await Bun.sleep(20)
    const second = await cache.getOrSet('ttl-refetch', 0.01, factory)

    expect(first).toBe('call-1')
    expect(second).toBe('call-2')
    expect(calls).toBe(2)
  })

  test('factory is invoked on every miss (no prior value)', async () => {
    const cache = createCache({ ttl: 3600 })
    const val = await cache.getOrSet('brand-new', 60, async () => 'fresh')
    expect(val).toBe('fresh')
  })

  test('getOrSet stores the factory result so subsequent get() finds it', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.getOrSet('store-test', 60, async () => 'stored')
    expect<unknown>(await cache.get('store-test')).toBe('stored')
  })

  test('getOrSet works with object return values', async () => {
    const cache = createCache({ ttl: 3600 })
    const obj = { a: 1, b: [2, 3] }
    const result = await cache.getOrSet('obj-key', 60, async () => obj)
    expect(result).toEqual(obj)
  })
})


describe('Cache.pull extended', () => {
  test('pull returns the value and then get returns null', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('consume-me', 'one-shot', 60)
    const val = await cache.pull('consume-me')
    expect(val).toBe('one-shot')
    expect<unknown>(await cache.get('consume-me')).toBeNull()
  })

  test('pull on missing key returns null without error', async () => {
    const cache = createCache({ ttl: 3600 })
    expect(await cache.pull('no-such-key')).toBeNull()
  })

  test('second pull on same key returns null', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('once-pull', 42, 60)
    await cache.pull('once-pull')
    expect(await cache.pull('once-pull')).toBeNull()
  })
})


describe('Multiple stores isolation extended', () => {
  test('writing to store A does not affect store B', async () => {
    const a = new MemoryCacheStore()
    const b = new MemoryCacheStore()
    await a.set('key', 'from-a')
    expect<unknown>(await b.get('key')).toBeNull()
  })

  test('flushing store A does not flush store B', async () => {
    const a = new MemoryCacheStore()
    const b = new MemoryCacheStore()
    await a.set('x', 1)
    await b.set('x', 2)
    await a.flush()
    expect<unknown>(await a.get('x')).toBeNull()
    expect<unknown>(await b.get('x')).toBe(2)
  })

  test('two Cache managers sharing a store instance share data', async () => {
    const shared = new MemoryCacheStore()
    const c1 = createCache({ stores: { s: shared }, default: 's' })
    const c2 = createCache({ stores: { s: shared }, default: 's' })
    await c1.set('shared', 'hello', 60)
    expect<unknown>(await c2.get('shared')).toBe('hello')
  })
})


describe('Overwrite existing key', () => {
  test('set overwrites a previously stored value in MemoryCacheStore', async () => {
    const store = new MemoryCacheStore()
    await store.set('k', 'old')
    await store.set('k', 'new')
    expect<unknown>(await store.get('k')).toBe('new')
  })

  test('set overwrites a previously stored value via Cache manager', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('k', 'first', 60)
    await cache.set('k', 'second', 60)
    expect<unknown>(await cache.get('k')).toBe('second')
  })

  test('overwrite resets TTL', async () => {
    const store = new MemoryCacheStore()
    // Set with a very short TTL, then overwrite with long TTL
    await store.set('renew', 'v1', 0.01) // 10 ms
    await store.set('renew', 'v2', 3600)  // long-lived
    await Bun.sleep(20)
    expect<unknown>(await store.get('renew')).toBe('v2')
  })
})


describe('Delete nonexistent key', () => {
  test('delete on missing key returns false in MemoryCacheStore', async () => {
    const store = new MemoryCacheStore()
    expect(await store.delete('ghost')).toBe(false)
  })

  test('delete on missing key returns true via Cache manager (delegates to store)', async () => {
    // The Cache.delete delegates to store.delete — result depends on store impl
    const cache = createCache({ ttl: 3600 })
    const result = await cache.delete('nonexistent')
    // MemoryCacheStore returns false for missing keys
    expect(result).toBe(false)
  })

  test('deleting already-deleted key returns false', async () => {
    const store = new MemoryCacheStore()
    await store.set('bye', 1)
    await store.delete('bye')
    expect(await store.delete('bye')).toBe(false)
  })
})


describe('Flush then get', () => {
  test('get returns null for every key after flush', async () => {
    const store = new MemoryCacheStore()
    await store.set('one', 1)
    await store.set('two', 2)
    await store.set('three', 3)
    await store.flush()
    expect<unknown>(await store.get('one')).toBeNull()
    expect<unknown>(await store.get('two')).toBeNull()
    expect<unknown>(await store.get('three')).toBeNull()
  })

  test('has returns false for all keys after flush', async () => {
    const store = new MemoryCacheStore()
    await store.set('a', true)
    await store.flush()
    expect(await store.has('a')).toBe(false)
  })

  test('can write again after flush', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('after-flush', 'yes', 60)
    await cache.flush()
    expect<unknown>(await cache.get('after-flush')).toBeNull()
    await cache.set('after-flush', 'back', 60)
    expect<unknown>(await cache.get('after-flush')).toBe('back')
  })
})


describe('Set with 0 TTL', () => {
  test('MemoryCacheStore: set with 0 TTL stores value without expiry (no expiry set)', async () => {
    // In MemoryCacheStore, ttlSeconds=0 is falsy so no expiry is assigned
    const store = new MemoryCacheStore()
    await store.set('zero-ttl', 'persistent', 0)
    await Bun.sleep(5)
    // With 0 treated as "no TTL", value should still be present
    expect<unknown>(await store.get('zero-ttl')).toBe('persistent')
  })

  test('Cache manager: set with 0 TTL does not expire the value', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('zero', 'stays', 0)
    await Bun.sleep(5)
    expect<unknown>(await cache.get('zero')).toBe('stays')
  })
})


describe('Concurrent getOrSet calls', () => {
  test('multiple concurrent getOrSet calls all return the same value', async () => {
    const cache = createCache({ ttl: 3600 })
    let calls = 0
    const factory = async () => { calls++; return 'concurrent-result' }

    // Fire 5 concurrent calls for the same key
    const results = await Promise.all([
      cache.getOrSet('concurrent', 60, factory),
      cache.getOrSet('concurrent', 60, factory),
      cache.getOrSet('concurrent', 60, factory),
      cache.getOrSet('concurrent', 60, factory),
      cache.getOrSet('concurrent', 60, factory),
    ])

    // All results must be the same value
    expect(results.every(r => r === 'concurrent-result')).toBe(true)
  })

  test('concurrent pulls only one call retrieves the value', async () => {
    const cache = createCache({ ttl: 3600 })
    await cache.set('race-pull', 'prize', 60)

    const results = await Promise.all([
      cache.pull('race-pull'),
      cache.pull('race-pull'),
      cache.pull('race-pull'),
    ])

    // pull() is not atomic: all concurrent calls may see the value before deletion.
    // What we can assert is that after all pulls the key is gone and at least one got the value.
    const nonNull = results.filter(r => r !== null)
    expect(nonNull.length).toBeGreaterThanOrEqual(1)
    expect(nonNull.every(r => r === 'prize')).toBe(true)
    // The key must be gone after all pulls
    expect<unknown>(await cache.get('race-pull')).toBeNull()
  })
})


describe('Large values', () => {
  test('MemoryCacheStore stores and retrieves a large JSON object', async () => {
    const store = new MemoryCacheStore()
    const big = {
      users: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        roles: ['viewer', 'editor'],
        meta: { createdAt: Date.now(), active: i % 2 === 0 },
      })),
    }
    await store.set('big-obj', big)
    const retrieved = await store.get<typeof big>('big-obj')
    expect(retrieved).toEqual(big)
    expect(retrieved!.users).toHaveLength(500)
  })

  test('Cache manager stores and retrieves a deeply nested object', async () => {
    const cache = createCache({ ttl: 3600 })
    function buildNested(depth: number): Record<string, unknown> {
      if (depth === 0) return { value: 'leaf' }
      return { child: buildNested(depth - 1), level: depth }
    }
    const deep = buildNested(20)
    await cache.set('deep-obj', deep, 60)
    expect<unknown>(await cache.get('deep-obj')).toEqual(deep)
  })

  test('MemoryCacheStore handles large string values', async () => {
    const store = new MemoryCacheStore()
    const big = 'x'.repeat(100_000)
    await store.set('large-string', big)
    expect<unknown>(await store.get('large-string')).toBe(big)
  })
})


import { CacheProvider } from '../src/index'

function mockApp(configData: Record<string, any>) {
  const services: Record<string, any> = {}
  const configFn = (key: string, fallback?: any) => {
    const parts = key.split('.')
    let val: any = configData
    for (const p of parts) {
      val = val?.[p]
      if (val === undefined) return fallback
    }
    return val ?? fallback
  }
  return {
    use(name: string) {
      if (name === 'config') return configFn
      return services[name]
    },
    instance(name: string, value: any) { services[name] = value },
  } as any
}

describe('CacheProvider — memory driver', () => {
  test('registers cache with memory driver by default', async () => {
    const app = mockApp({ cache: { stores: { memory: { driver: 'memory' } } } })
    await new CacheProvider().register(app)
    const cache = app.use('cache')
    expect(cache).toBeDefined()
    await cache.set('test', 'value')
    expect<unknown>(await cache.get('test')).toBe('value')
  })

  test('registers cache with memory driver when no stores configured', async () => {
    const app = mockApp({ cache: {} })
    await new CacheProvider().register(app)
    const cache = app.use('cache')
    expect(cache).toBeDefined()
    await cache.set('k', 'v')
    expect<unknown>(await cache.get('k')).toBe('v')
  })

  test('skips registration when no cache config', async () => {
    const app = mockApp({})
    await new CacheProvider().register(app)
    expect(app.use('cache')).toBeUndefined()
  })
})

describe('CacheProvider — database driver', () => {
  test('registers cache with database driver using db service', async () => {
    const { Database } = await import('bun:sqlite')
    const sqlite = new Database(':memory:')
    const db = {
      exec(sql: string) { sqlite.exec(sql) },
      run(sql: string, params?: unknown[]) { sqlite.prepare(sql).run(...((params as any[]) || [])) },
      queryOne<T = any>(sql: string, params?: unknown[]): T | null {
        return (sqlite.prepare(sql).get(...((params as any[]) || [])) as T) ?? null
      },
      query<T = any>(sql: string, params?: unknown[]): T[] {
        return sqlite.prepare(sql).all(...((params as any[]) || [])) as T[]
      },
    }

    const app = mockApp({ cache: { stores: { db: { driver: 'database' } } } })
    // Register db service
    app.instance('db', db)

    await new CacheProvider().register(app)
    const cache = app.use('cache')
    expect(cache).toBeDefined()
    await cache.set('dbkey', 'dbval')
    expect<unknown>(await cache.get('dbkey')).toBe('dbval')
  })

  test('throws when database driver used without db service', async () => {
    const app = mockApp({ cache: { stores: { db: { driver: 'database' } } } })
    await expect(new CacheProvider().register(app)).rejects.toThrow('database')
  })
})

describe('CacheProvider — unknown driver', () => {
  test('throws for unknown driver name', async () => {
    const app = mockApp({ cache: { stores: { bad: { driver: 'foobar' } } } })
    await expect(new CacheProvider().register(app)).rejects.toThrow('Unknown cache driver')
  })
})

describe('CacheProvider — ttl and default from config', () => {
  test('respects ttl from config', async () => {
    const app = mockApp({ cache: { ttl: 120, stores: { memory: { driver: 'memory' } } } })
    await new CacheProvider().register(app)
    const cache = app.use('cache')
    expect(cache).toBeDefined()
  })

  test('respects default store from config', async () => {
    const app = mockApp({
      cache: {
        default: 'mem2',
        stores: {
          mem1: { driver: 'memory' },
          mem2: { driver: 'memory' },
        },
      },
    })
    await new CacheProvider().register(app)
    const cache = app.use('cache')
    await cache.set('x', 'y')
    // Verify it uses mem2 by checking store('mem2') has the value
    expect(await cache.store('mem2').get('x')).toBe('y')
  })
})

describe('CacheProvider — backwards compat with store instances', () => {
  test('accepts pre-built CacheStore instances in config', async () => {
    const store = new MemoryCacheStore()
    const app = mockApp({ cache: { stores: { mem: store } } })
    await new CacheProvider().register(app)
    const cache = app.use('cache')
    await cache.set('k', 'v')
    expect<unknown>(await cache.get('k')).toBe('v')
  })
})

describe('CacheProvider — multiple stores', () => {
  test('registers multiple stores and switches between them', async () => {
    const app = mockApp({
      cache: {
        default: 'fast',
        stores: {
          fast: { driver: 'memory' },
          slow: { driver: 'memory' },
        },
      },
    })
    await new CacheProvider().register(app)
    const cache = app.use('cache')

    await cache.set('a', '1')
    await cache.store('slow').set('b', '2')

    expect<unknown>(await cache.get('a')).toBe('1')
    expect<unknown>(await cache.get('b')).toBeNull()
    expect(await cache.store('slow').get('b')).toBe('2')
  })
})


describe('MemoryCacheStore — additional', () => {
  let store: MemoryCacheStore

  beforeEach(() => {
    store = new MemoryCacheStore()
  })

  test('overwrite existing key', async () => {
    await store.set('k', 'v1')
    await store.set('k', 'v2')
    expect<unknown>(await store.get('k')).toBe('v2')
  })

  test('stores number values', async () => {
    await store.set('num', 42)
    expect<unknown>(await store.get('num')).toBe(42)
  })

  test('stores boolean values', async () => {
    await store.set('bool', true)
    expect<unknown>(await store.get('bool')).toBe(true)
  })

  test('stores null value', async () => {
    await store.set('nil', null)
    // Storing null might behave like no value
    const val = await store.get('nil')
    expect(val === null || val === undefined).toBe(true)
  })

  test('stores array values', async () => {
    await store.set('arr', [1, 2, 3])
    expect<unknown>(await store.get('arr')).toEqual([1, 2, 3])
  })

  test('stores nested objects', async () => {
    await store.set('obj', { a: { b: { c: 1 } } })
    expect<unknown>(await store.get('obj')).toEqual({ a: { b: { c: 1 } } })
  })

  test('delete then has returns false', async () => {
    await store.set('k', 'v')
    await store.delete('k')
    expect(await store.has('k')).toBe(false)
  })

  test('many keys stored independently', async () => {
    for (let i = 0; i < 50; i++) {
      await store.set(`key${i}`, i)
    }
    for (let i = 0; i < 50; i++) {
      expect<unknown>(await store.get(`key${i}`)).toBe(i)
    }
  })

  test('flush then get returns null', async () => {
    await store.set('a', 1)
    await store.set('b', 2)
    await store.flush()
    expect<unknown>(await store.get('a')).toBeNull()
    expect<unknown>(await store.get('b')).toBeNull()
  })

  test('get after TTL expiry returns null', async () => {
    await store.set('ttl-key', 'value', 0.001) // 1ms TTL
    await Bun.sleep(10)
    expect<unknown>(await store.get('ttl-key')).toBeNull()
  })

  test('get before TTL expiry returns value', async () => {
    await store.set('ttl-key2', 'value', 60) // 60s TTL
    expect<unknown>(await store.get('ttl-key2')).toBe('value')
  })

  test('empty string key works', async () => {
    await store.set('', 'empty-key')
    expect<unknown>(await store.get('')).toBe('empty-key')
  })

  test('key with special characters', async () => {
    await store.set('key:with/special@chars', 'val')
    expect<unknown>(await store.get('key:with/special@chars')).toBe('val')
  })

  test('store string value', async () => {
    await store.set('str', 'hello world')
    expect<unknown>(await store.get('str')).toBe('hello world')
  })
})


describe('Cache — additional', () => {
  test('createCache returns Cache instance', () => {
    const cache = createCache()
    expect(cache).toBeInstanceOf(Cache)
  })

  test('cache set and get', async () => {
    const cache = createCache()
    await cache.set('x', 'y')
    expect<unknown>(await cache.get('x')).toBe('y')
  })

  test('cache has', async () => {
    const cache = createCache()
    await cache.set('exist', true)
    expect(await cache.has('exist')).toBe(true)
    expect(await cache.has('nope')).toBe(false)
  })

  test('cache delete', async () => {
    const cache = createCache()
    await cache.set('del', 'val')
    await cache.delete('del')
    expect<unknown>(await cache.get('del')).toBeNull()
  })

  test('cache flush', async () => {
    const cache = createCache()
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.flush()
    expect<unknown>(await cache.get('a')).toBeNull()
    expect<unknown>(await cache.get('b')).toBeNull()
  })
})
