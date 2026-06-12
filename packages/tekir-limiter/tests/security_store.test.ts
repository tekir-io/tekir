import { test, expect, describe } from 'bun:test'
import { RedisStore } from '../src/store'

function createMockRedis() {
  const data: Record<string, { value: number; ttl: number }> = {}
  return {
    incr: async (key: string) => {
      if (!data[key]) data[key] = { value: 0, ttl: -1 }
      data[key].value++
      return data[key].value
    },
    incrby: async (key: string, n: number) => {
      if (!data[key]) data[key] = { value: 0, ttl: -1 }
      data[key].value += n
      return data[key].value
    },
    decrby: async (key: string, n: number) => {
      if (!data[key]) data[key] = { value: 0, ttl: -1 }
      data[key].value -= n
      return data[key].value
    },
    set: async (key: string, value: string, ..._rest: any[]) => {
      if (!data[key]) data[key] = { value: 0, ttl: -1 }
      data[key].value = Number(value)
    },
    expire: async (key: string, sec: number) => { if (data[key]) data[key].ttl = sec },
    ttl: async (key: string) => data[key]?.ttl ?? -2,
    get: async (key: string) => (data[key] ? String(data[key].value) : null),
    del: async (key: string) => { delete data[key] },
    _data: data,
  }
}

describe('RedisStore TTL always set', () => {
  test('check sets TTL when key has none', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('k', 5, 30_000)
    expect(redis._data['rl:k'].ttl).toBe(30)
  })

  test('increment with amount > 1 still sets TTL on first call', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    // count becomes 3 on the first call; the old `count === amount` check would
    // have failed to set TTL in some paths. ttl must be set regardless.
    await store.increment('k', 10, 30_000, 3)
    expect(redis._data['rl:k'].ttl).toBe(30)
  })

  test('check re-sets TTL if the key lost it (ttl < 0)', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    redis._data['rl:k'] = { value: 4, ttl: -1 } // existing key, no TTL
    await store.check('k', 10, 45_000)
    expect(redis._data['rl:k'].ttl).toBe(45)
  })
})

describe('RedisStore decrement floors at 0', () => {
  test('decrement past zero does not leave a negative counter', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    redis._data['rl:k'] = { value: 1, ttl: 30 }
    await store.decrement('k', 5) // would go to -4
    expect(redis._data['rl:k'].value).toBe(0)
  })
})
