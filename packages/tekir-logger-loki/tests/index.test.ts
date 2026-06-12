import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { LokiTransport } from '../src/index'
import type { LokiTransportConfig } from '../src/index'
import type { LogEntry } from '@tekir/logger'

describe('LokiTransport', () => {
  let fetchSpy: ReturnType<typeof mock>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchSpy as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function makeConfig(overrides?: Partial<LokiTransportConfig>): LokiTransportConfig {
    return {
      url: 'http://localhost:3100',
      flushInterval: 0,
      batchSize: 1,
      // Existing tests intentionally target a local Loki over http.
      allowInsecureHost: true,
      ...overrides,
    }
  }

  function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
    return {
      level: 'info',
      msg: 'test message',
      time: 1700000000000,
      name: 'app',
      ...overrides,
    }
  }

  // ── Constructor ──────────────────────────────────────────────────────────

  test('creates transport with url', () => {
    const t = new LokiTransport(makeConfig())
    expect(t).toBeDefined()
  })

  test('creates transport with custom labels', () => {
    const t = new LokiTransport(makeConfig({ labels: { env: 'prod' } }))
    expect(t).toBeDefined()
  })

  test('creates transport with auth', () => {
    const t = new LokiTransport(makeConfig({
      auth: { username: 'user', password: 'pass' },
    }))
    expect(t).toBeDefined()
  })

  test('creates transport with tenantId', () => {
    const t = new LokiTransport(makeConfig({ tenantId: 'tenant-1' }))
    expect(t).toBeDefined()
  })

  // ── write() and flush ───────────────────────────────────────────────────

  test('write() sends to Loki push endpoint', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('write() sends to correct URL', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('http://localhost:3100/loki/api/v1/push')
  })

  test('write() strips trailing slash from base url', () => {
    const t = new LokiTransport(makeConfig({ url: 'http://localhost:3100/' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('http://localhost:3100/loki/api/v1/push')
  })

  test('write() sends POST method', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.method).toBe('POST')
  })

  test('write() sends Content-Type application/json', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  // ── Body format ─────────────────────────────────────────────────────────

  test('body has streams array', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(Array.isArray(body.streams)).toBe(true)
    expect(body.streams).toHaveLength(1)
  })

  test('stream has default app label', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].stream.app).toBe('tekir')
  })

  test('stream includes custom labels', () => {
    const t = new LokiTransport(makeConfig({ labels: { env: 'prod', service: 'api' } }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].stream.env).toBe('prod')
    expect(body.streams[0].stream.service).toBe('api')
  })

  test('custom labels override default app label', () => {
    const t = new LokiTransport(makeConfig({ labels: { app: 'custom' } }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].stream.app).toBe('custom')
  })

  test('values contain timestamp as nanosecond string', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ time: 1700000000000 }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const [ts] = body.streams[0].values[0]
    expect(ts).toBe('1700000000000000000')
  })

  test('values contain JSON-serialized log entry as line', () => {
    const t = new LokiTransport(makeConfig())
    const entry = makeEntry({ msg: 'hello loki' })
    t.write(entry)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const [, line] = body.streams[0].values[0]
    const parsed = JSON.parse(line)
    expect(parsed.msg).toBe('hello loki')
    expect(parsed.level).toBe('info')
  })

  // ── Authentication ──────────────────────────────────────────────────────

  test('sends Basic auth header when auth is configured', () => {
    const t = new LokiTransport(makeConfig({
      auth: { username: 'user', password: 'pass' },
    }))
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    const expected = `Basic ${btoa('user:pass')}`
    expect(opts.headers['Authorization']).toBe(expected)
  })

  test('does not send auth header when auth is not configured', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['Authorization']).toBeUndefined()
  })

  test('sends X-Scope-OrgID header when tenantId is configured', () => {
    const t = new LokiTransport(makeConfig({ tenantId: 'my-org' }))
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['X-Scope-OrgID']).toBe('my-org')
  })

  test('does not send X-Scope-OrgID when tenantId is not configured', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['X-Scope-OrgID']).toBeUndefined()
  })

  // ── Batching ────────────────────────────────────────────────────────────

  test('buffers entries until batchSize is reached', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 3 }))
    t.write(makeEntry())
    t.write(makeEntry())
    expect(fetchSpy).not.toHaveBeenCalled()
    t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('batch contains correct number of values', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 3 }))
    t.write(makeEntry({ msg: 'one' }))
    t.write(makeEntry({ msg: 'two' }))
    t.write(makeEntry({ msg: 'three' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].values).toHaveLength(3)
  })

  test('flush() sends buffered entries', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.write(makeEntry())
    expect(fetchSpy).not.toHaveBeenCalled()
    t.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('flush() does nothing when buffer is empty', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.flush()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('buffer is cleared after flush', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.flush()
    t.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // ── destroy() ───────────────────────────────────────────────────────────

  test('destroy() flushes remaining buffer', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.destroy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('destroy() is safe to call multiple times', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.destroy()
    t.destroy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // ── All log levels ─────────────────────────────────────────────────────

  test('writes trace level entry', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'trace' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.level).toBe('trace')
  })

  test('writes debug level entry', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'debug' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.level).toBe('debug')
  })

  test('writes warn level entry', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'warn' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.level).toBe('warn')
  })

  test('writes error level entry', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'error' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.level).toBe('error')
  })

  test('writes fatal level entry', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'fatal' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.level).toBe('fatal')
  })

  // ── Fetch error does not throw ──────────────────────────────────────────

  test('fetch rejection does not throw from write', () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down'))) as any
    const t = new LokiTransport(makeConfig())
    expect(() => t.write(makeEntry())).not.toThrow()
  })

  // ── Entry without time ─────────────────────────────────────────────────

  test('uses Date.now() when entry has no time field', () => {
    const t = new LokiTransport(makeConfig())
    t.write({ level: 'info', msg: 'no time', name: 'app' } as LogEntry)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const [ts] = body.streams[0].values[0]
    // Should be a nanosecond timestamp string (at least 16 digits)
    expect(ts.length).toBeGreaterThanOrEqual(16)
  })

  // ── Integration with Logger ─────────────────────────────────────────────

  test('works as a LogTransport with Logger', async () => {
    const { Logger } = await import('@tekir/logger')
    const t = new LokiTransport(makeConfig())
    const logger = new Logger({
      level: 'info',
      transports: [t],
    })
    logger.info('via logger')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('works alongside ConsoleTransport', async () => {
    const consoleSpy = mock(() => {})
    console.log = consoleSpy
    const { Logger, ConsoleTransport } = await import('@tekir/logger')
    const loki = new LokiTransport(makeConfig())
    const logger = new Logger({
      level: 'info',
      transports: [new ConsoleTransport(false), loki],
    })
    logger.info('dual output')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore?.()
  })

  // ── Additional tests ──────────────────────────────────────────────────

  test('config with custom url and labels combined', () => {
    const t = new LokiTransport(makeConfig({ url: 'http://loki.internal:3100', labels: { region: 'us-east' } }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].stream.region).toBe('us-east')
  })

  test('config with auth and tenantId combined', () => {
    const t = new LokiTransport(makeConfig({
      auth: { username: 'u', password: 'p' },
      tenantId: 'org-42',
    }))
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['Authorization']).toContain('Basic')
    expect(opts.headers['X-Scope-OrgID']).toBe('org-42')
  })

  test('multiple labels are all included in stream', () => {
    const t = new LokiTransport(makeConfig({ labels: { a: '1', b: '2', c: '3' } }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].stream.a).toBe('1')
    expect(body.streams[0].stream.b).toBe('2')
    expect(body.streams[0].stream.c).toBe('3')
  })

  test('batch of 5 entries sends correct number of values', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 5 }))
    for (let i = 0; i < 5; i++) t.write(makeEntry({ msg: `msg-${i}` }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].values).toHaveLength(5)
  })

  test('batch of 10 with batchSize 5 sends twice', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 5 }))
    for (let i = 0; i < 10; i++) t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('flush after partial batch sends remaining', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 10 }))
    for (let i = 0; i < 7; i++) t.write(makeEntry())
    expect(fetchSpy).not.toHaveBeenCalled()
    t.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].values).toHaveLength(7)
  })

  test('destroy flushes partial batch', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    for (let i = 0; i < 3; i++) t.write(makeEntry())
    t.destroy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.streams[0].values).toHaveLength(3)
  })

  test('write info level preserves msg in JSON line', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ level: 'info', msg: 'specific info' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.msg).toBe('specific info')
  })

  test('write preserves extra fields in JSON line', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ userId: 99 } as any))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.userId).toBe(99)
  })

  test('write preserves name field in JSON line', () => {
    const t = new LokiTransport(makeConfig())
    t.write(makeEntry({ name: 'myapp' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.name).toBe('myapp')
  })

  test('url with path prefix is handled', () => {
    const t = new LokiTransport(makeConfig({ url: 'http://gateway:8080/loki-proxy' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('http://gateway:8080/loki-proxy/loki/api/v1/push')
  })

  test('batchSize 1 sends immediately on each write', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 1 }))
    t.write(makeEntry())
    t.write(makeEntry())
    t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  test('fetch error during flush does not throw', () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network'))) as any
    const t = new LokiTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    expect(() => t.flush()).not.toThrow()
  })

  test('different timestamps produce different nanosecond strings', () => {
    const t = new LokiTransport(makeConfig({ batchSize: 2 }))
    t.write(makeEntry({ time: 1000000000000 }))
    t.write(makeEntry({ time: 2000000000000 }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const ts1 = body.streams[0].values[0][0]
    const ts2 = body.streams[0].values[1][0]
    expect(ts1).not.toBe(ts2)
  })

  test('labels do not include undefined values', () => {
    const t = new LokiTransport(makeConfig({ labels: { env: 'test' } }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const stream = body.streams[0].stream
    for (const val of Object.values(stream)) {
      expect(val).not.toBeUndefined()
    }
  })

  test('multiple transports send to different urls', () => {
    const t1 = new LokiTransport(makeConfig({ url: 'http://loki1:3100' }))
    const t2 = new LokiTransport(makeConfig({ url: 'http://loki2:3100' }))
    t1.write(makeEntry())
    t2.write(makeEntry())
    expect(fetchSpy.mock.calls[0][0]).toBe('http://loki1:3100/loki/api/v1/push')
    expect(fetchSpy.mock.calls[1][0]).toBe('http://loki2:3100/loki/api/v1/push')
  })

  test('transport is defined', () => {
    const t = new LokiTransport(makeConfig())
    expect(t).toBeDefined()
    expect(t).not.toBeNull()
  })

  test('write method exists', () => {
    const t = new LokiTransport(makeConfig())
    expect(typeof t.write).toBe('function')
  })

  test('flush method exists', () => {
    const t = new LokiTransport(makeConfig())
    expect(typeof t.flush).toBe('function')
  })

  test('destroy method exists', () => {
    const t = new LokiTransport(makeConfig())
    expect(typeof t.destroy).toBe('function')
  })
})
