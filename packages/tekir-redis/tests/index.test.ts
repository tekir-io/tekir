import { test, expect, describe, afterEach } from 'bun:test'
import { Redis } from '../src/index'
import type { RedisConfig } from '../src/index'


describe('Redis constructor', () => {
  const instances: Redis[] = []
  afterEach(() => {
    for (const r of instances) { try { r.close() } catch {} }
    instances.length = 0
  })

  test('creates an instance with default config', () => {
    const redis = new Redis()
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
  })

  test('creates an instance with empty config', () => {
    const redis = new Redis({})
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
  })

  test('creates an instance with custom url', () => {
    const redis = new Redis({ url: 'redis://myhost:6380' })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
  })

  test('creates an instance with all config options', () => {
    const redis = new Redis({
      url: 'redis://localhost:6379',
      prefix: 'app',
      connectionTimeout: 5000,
      idleTimeout: 30000,
      autoReconnect: false,
      maxRetries: 3,
      enableAutoPipelining: false,
      tls: false,
    })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
  })

  test('getClient returns the underlying client', () => {
    const redis = new Redis()
    instances.push(redis)
    const client = redis.getClient()
    expect(client).toBeDefined()
    expect(typeof client).toBe('object')
  })
})


describe('RedisConfig interface', () => {
  test('url is optional string', () => {
    const config: RedisConfig = { url: 'redis://localhost:6379' }
    expect(config.url).toBe('redis://localhost:6379')
  })

  test('prefix is optional string', () => {
    const config: RedisConfig = { prefix: 'myapp' }
    expect(config.prefix).toBe('myapp')
  })

  test('connectionTimeout is optional number', () => {
    const config: RedisConfig = { connectionTimeout: 5000 }
    expect(config.connectionTimeout).toBe(5000)
  })

  test('idleTimeout is optional number', () => {
    const config: RedisConfig = { idleTimeout: 30000 }
    expect(config.idleTimeout).toBe(30000)
  })

  test('autoReconnect is optional boolean', () => {
    const config: RedisConfig = { autoReconnect: false }
    expect(config.autoReconnect).toBe(false)
  })

  test('maxRetries is optional number', () => {
    const config: RedisConfig = { maxRetries: 5 }
    expect(config.maxRetries).toBe(5)
  })

  test('enableAutoPipelining is optional boolean', () => {
    const config: RedisConfig = { enableAutoPipelining: true }
    expect(config.enableAutoPipelining).toBe(true)
  })

  test('tls accepts boolean', () => {
    const config: RedisConfig = { tls: true }
    expect(config.tls).toBe(true)
  })

  test('tls accepts object', () => {
    const config: RedisConfig = { tls: { rejectUnauthorized: false } }
    expect(typeof config.tls).toBe('object')
  })

  test('empty config is valid', () => {
    const config: RedisConfig = {}
    expect(config).toEqual({})
  })
})


describe('Redis key prefix logic', () => {
  const keyFn = (Redis.prototype as any).key

  test('returns bare key when prefix is empty', () => {
    const context = { prefix: '' }
    expect(keyFn.call(context, 'session:abc')).toBe('session:abc')
  })

  test('prepends prefix with colon separator', () => {
    const context = { prefix: 'app' }
    expect(keyFn.call(context, 'user:1')).toBe('app:user:1')
  })

  test('handles nested key with prefix', () => {
    const context = { prefix: 'v2' }
    expect(keyFn.call(context, 'cache:posts:latest')).toBe('v2:cache:posts:latest')
  })

  test('handles empty key string with prefix', () => {
    const context = { prefix: 'pre' }
    expect(keyFn.call(context, '')).toBe('pre:')
  })

  test('handles empty key string without prefix', () => {
    const context = { prefix: '' }
    expect(keyFn.call(context, '')).toBe('')
  })
})


describe('Redis constructor — additional configs', () => {
  const instances: Redis[] = []
  const cleanup = () => {
    for (const r of instances) { try { r.close() } catch {} }
    instances.length = 0
  }

  test('creates instance with only prefix', () => {
    const redis = new Redis({ prefix: 'test' })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with tls object', () => {
    const redis = new Redis({ tls: { rejectUnauthorized: false } })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with tls true', () => {
    const redis = new Redis({ tls: true })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with autoReconnect true', () => {
    const redis = new Redis({ autoReconnect: true })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with maxRetries 0', () => {
    const redis = new Redis({ maxRetries: 0 })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with enableAutoPipelining true', () => {
    const redis = new Redis({ enableAutoPipelining: true })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with connectionTimeout 0', () => {
    const redis = new Redis({ connectionTimeout: 0 })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with idleTimeout 0', () => {
    const redis = new Redis({ idleTimeout: 0 })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })
})

describe('RedisConfig — combined options', () => {
  test('prefix + url combined', () => {
    const config: RedisConfig = { url: 'redis://localhost:6379', prefix: 'app' }
    expect(config.url).toBe('redis://localhost:6379')
    expect(config.prefix).toBe('app')
  })

  test('url + tls combined', () => {
    const config: RedisConfig = { url: 'rediss://secure:6380', tls: true }
    expect(config.tls).toBe(true)
  })

  test('all timeouts set', () => {
    const config: RedisConfig = { connectionTimeout: 3000, idleTimeout: 10000 }
    expect(config.connectionTimeout).toBe(3000)
    expect(config.idleTimeout).toBe(10000)
  })

  test('maxRetries with autoReconnect', () => {
    const config: RedisConfig = { maxRetries: 10, autoReconnect: true }
    expect(config.maxRetries).toBe(10)
    expect(config.autoReconnect).toBe(true)
  })

  test('config with all boolean fields false', () => {
    const config: RedisConfig = { autoReconnect: false, enableAutoPipelining: false, tls: false }
    expect(config.autoReconnect).toBe(false)
    expect(config.enableAutoPipelining).toBe(false)
    expect(config.tls).toBe(false)
  })

  test('config with all boolean fields true', () => {
    const config: RedisConfig = { autoReconnect: true, enableAutoPipelining: true, tls: true }
    expect(config.autoReconnect).toBe(true)
    expect(config.enableAutoPipelining).toBe(true)
    expect(config.tls).toBe(true)
  })

  test('config with large maxRetries', () => {
    const config: RedisConfig = { maxRetries: 1000 }
    expect(config.maxRetries).toBe(1000)
  })
})

describe('Redis key prefix — additional cases', () => {
  const keyFn = (Redis.prototype as any).key

  test('key with special characters', () => {
    const context = { prefix: 'app' }
    expect(keyFn.call(context, 'user:{123}:profile')).toBe('app:user:{123}:profile')
  })

  test('key with dots', () => {
    const context = { prefix: 'v1' }
    expect(keyFn.call(context, 'cache.users.list')).toBe('v1:cache.users.list')
  })

  test('prefix with special characters', () => {
    const context = { prefix: 'app-v2' }
    expect(keyFn.call(context, 'key')).toBe('app-v2:key')
  })

  test('very long key with prefix', () => {
    const context = { prefix: 'p' }
    const longKey = 'a'.repeat(200)
    expect(keyFn.call(context, longKey)).toBe('p:' + longKey)
  })

  test('key with colons and prefix', () => {
    const context = { prefix: 'ns' }
    expect(keyFn.call(context, 'a:b:c:d')).toBe('ns:a:b:c:d')
  })

  test('numeric-like key with prefix', () => {
    const context = { prefix: 'db' }
    expect(keyFn.call(context, '12345')).toBe('db:12345')
  })

  test('key with spaces', () => {
    const context = { prefix: 'test' }
    expect(keyFn.call(context, 'hello world')).toBe('test:hello world')
  })

  test('single character key with prefix', () => {
    const context = { prefix: 'x' }
    expect(keyFn.call(context, 'k')).toBe('x:k')
  })

  test('single character key without prefix', () => {
    const context = { prefix: '' }
    expect(keyFn.call(context, 'k')).toBe('k')
  })

  test('prefix with colon does not double colon', () => {
    const context = { prefix: 'ns:sub' }
    expect(keyFn.call(context, 'key')).toBe('ns:sub:key')
  })
})

describe('Redis — getClient returns consistently', () => {
  test('getClient returns same reference on repeated calls', () => {
    const redis = new Redis()
    const c1 = redis.getClient()
    const c2 = redis.getClient()
    expect(c1).toBe(c2)
    try { redis.close() } catch {}
  })

  test('getClient is not null', () => {
    const redis = new Redis()
    expect(redis.getClient()).not.toBeNull()
    try { redis.close() } catch {}
  })

  test('getClient is an object', () => {
    const redis = new Redis()
    expect(typeof redis.getClient()).toBe('object')
    try { redis.close() } catch {}
  })
})

describe('RedisConfig — edge values', () => {
  test('connectionTimeout as very large number', () => {
    const config: RedisConfig = { connectionTimeout: 999999 }
    expect(config.connectionTimeout).toBe(999999)
  })

  test('idleTimeout as very large number', () => {
    const config: RedisConfig = { idleTimeout: 999999 }
    expect(config.idleTimeout).toBe(999999)
  })

  test('url with redis:// protocol', () => {
    const config: RedisConfig = { url: 'redis://host:6379' }
    expect(config.url).toContain('redis://')
  })

  test('url with rediss:// protocol', () => {
    const config: RedisConfig = { url: 'rediss://secure-host:6380' }
    expect(config.url).toContain('rediss://')
  })

  test('prefix with uppercase', () => {
    const config: RedisConfig = { prefix: 'APP_V2' }
    expect(config.prefix).toBe('APP_V2')
  })

  test('tls with ca option', () => {
    const config: RedisConfig = { tls: { ca: 'cert-content' } }
    expect(typeof config.tls).toBe('object')
  })
})


describe('Redis key prefix — boundary and unicode', () => {
  const keyFn = (Redis.prototype as any).key

  test('key with unicode characters', () => {
    const context = { prefix: 'app' }
    expect(keyFn.call(context, 'user:名前')).toBe('app:user:名前')
  })

  test('prefix with unicode characters', () => {
    const context = { prefix: 'アプリ' }
    expect(keyFn.call(context, 'key')).toBe('アプリ:key')
  })

  test('key with newlines', () => {
    const context = { prefix: 'ns' }
    expect(keyFn.call(context, 'line1\nline2')).toBe('ns:line1\nline2')
  })

  test('key with tab characters', () => {
    const context = { prefix: 'ns' }
    expect(keyFn.call(context, 'a\tb')).toBe('ns:a\tb')
  })

  test('prefix is undefined-like empty string', () => {
    const context = { prefix: '' }
    expect(keyFn.call(context, 'test:key')).toBe('test:key')
  })
})

describe('Redis constructor — URL parsing', () => {
  const instances: Redis[] = []
  const cleanup = () => {
    for (const r of instances) { try { r.close() } catch {} }
    instances.length = 0
  }

  test('creates instance with url containing password', () => {
    const redis = new Redis({ url: 'redis://:secret@localhost:6379' })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with url containing username and password', () => {
    const redis = new Redis({ url: 'redis://user:pass@localhost:6379' })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })

  test('creates instance with url containing db number', () => {
    const redis = new Redis({ url: 'redis://localhost:6379/2' })
    instances.push(redis)
    expect(redis).toBeInstanceOf(Redis)
    cleanup()
  })
})

describe('Redis — method existence', () => {
  test('has get method', () => {
    expect(typeof Redis.prototype.get).toBe('function')
  })

  test('has set method', () => {
    expect(typeof Redis.prototype.set).toBe('function')
  })

  test('has del method', () => {
    expect(typeof Redis.prototype.del).toBe('function')
  })

  test('has publish method', () => {
    expect(typeof Redis.prototype.publish).toBe('function')
  })

  test('has subscribe method', () => {
    expect(typeof Redis.prototype.subscribe).toBe('function')
  })

  test('has getJSON method', () => {
    expect(typeof Redis.prototype.getJSON).toBe('function')
  })

  test('has setJSON method', () => {
    expect(typeof Redis.prototype.setJSON).toBe('function')
  })

  test('has remember method', () => {
    expect(typeof Redis.prototype.remember).toBe('function')
  })

  test('has flushdb method', () => {
    expect(typeof Redis.prototype.flushdb).toBe('function')
  })

  test('has incr and decr methods', () => {
    expect(typeof Redis.prototype.incr).toBe('function')
    expect(typeof Redis.prototype.decr).toBe('function')
  })

  test('has hash operation methods', () => {
    expect(typeof Redis.prototype.hget).toBe('function')
    expect(typeof Redis.prototype.hmset).toBe('function')
    expect(typeof Redis.prototype.hmget).toBe('function')
    expect(typeof Redis.prototype.hincrby).toBe('function')
  })

  test('has set operation methods', () => {
    expect(typeof Redis.prototype.sadd).toBe('function')
    expect(typeof Redis.prototype.srem).toBe('function')
    expect(typeof Redis.prototype.sismember).toBe('function')
    expect(typeof Redis.prototype.smembers).toBe('function')
  })

  test('has expire and ttl methods', () => {
    expect(typeof Redis.prototype.expire).toBe('function')
    expect(typeof Redis.prototype.ttl).toBe('function')
  })

  test('has exists method', () => {
    expect(typeof Redis.prototype.exists).toBe('function')
  })

  test('has send method for raw commands', () => {
    expect(typeof Redis.prototype.send).toBe('function')
  })
})

describe('RedisConfig — multi-connection config', () => {
  test('config with default connection name', () => {
    const config: RedisConfig = { default: 'main' }
    expect(config.default).toBe('main')
  })

  test('config with connections map', () => {
    const config: RedisConfig = {
      default: 'cache',
      connections: {
        cache: { url: 'redis://cache-host:6379', prefix: 'cache' },
        session: { url: 'redis://session-host:6379', prefix: 'sess' },
      },
    }
    expect(config.connections).toBeDefined()
    expect(Object.keys(config.connections!)).toHaveLength(2)
    expect(config.connections!.cache.prefix).toBe('cache')
    expect(config.connections!.session.prefix).toBe('sess')
  })

  test('config connections can have different TLS settings', () => {
    const config: RedisConfig = {
      connections: {
        local: { url: 'redis://localhost:6379', tls: false },
        remote: { url: 'rediss://remote:6380', tls: true },
      },
    }
    expect(config.connections!.local.tls).toBe(false)
    expect(config.connections!.remote.tls).toBe(true)
  })
})
