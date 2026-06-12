import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { DatadogTransport } from '../src/index'
import type { DatadogTransportConfig } from '../src/index'
import type { LogEntry } from '@tekir/logger'

describe('DatadogTransport', () => {
  let fetchSpy: ReturnType<typeof mock>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 202 })))
    globalThis.fetch = fetchSpy as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function makeConfig(overrides?: Partial<DatadogTransportConfig>): DatadogTransportConfig {
    return {
      apiKey: 'test-api-key',
      flushInterval: 0,
      batchSize: 1,
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

  test('creates transport with default site (us1)', () => {
    const t = new DatadogTransport(makeConfig())
    expect(t).toBeDefined()
  })

  test('creates transport with eu site', () => {
    const t = new DatadogTransport(makeConfig({ site: 'eu' }))
    expect(t).toBeDefined()
  })

  test('creates transport with us3 site', () => {
    const t = new DatadogTransport(makeConfig({ site: 'us3' }))
    expect(t).toBeDefined()
  })

  test('creates transport with us5 site', () => {
    const t = new DatadogTransport(makeConfig({ site: 'us5' }))
    expect(t).toBeDefined()
  })

  test('creates transport with ap1 site', () => {
    const t = new DatadogTransport(makeConfig({ site: 'ap1' }))
    expect(t).toBeDefined()
  })

  test('creates transport with gov site', () => {
    const t = new DatadogTransport(makeConfig({ site: 'gov' }))
    expect(t).toBeDefined()
  })

  // ── write() and flush ───────────────────────────────────────────────────

  test('write() sends to Datadog when batchSize is 1', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('write() sends to correct US1 endpoint', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
  })

  test('write() sends to correct EU endpoint', () => {
    const t = new DatadogTransport(makeConfig({ site: 'eu' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
  })

  test('write() sends to correct US3 endpoint', () => {
    const t = new DatadogTransport(makeConfig({ site: 'us3' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('https://http-intake.logs.us3.datadoghq.com/api/v2/logs')
  })

  test('write() sends to correct AP1 endpoint', () => {
    const t = new DatadogTransport(makeConfig({ site: 'ap1' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('https://http-intake.logs.ap1.datadoghq.com/api/v2/logs')
  })

  test('write() sends to correct GOV endpoint', () => {
    const t = new DatadogTransport(makeConfig({ site: 'gov' }))
    t.write(makeEntry())
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toBe('https://http-intake.logs.ddog-gov.com/api/v2/logs')
  })

  test('write() sends DD-API-KEY header', () => {
    const t = new DatadogTransport(makeConfig({ apiKey: 'my-key-123' }))
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['DD-API-KEY']).toBe('my-key-123')
  })

  test('write() sends Content-Type application/json', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  test('write() sends POST method', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const opts = fetchSpy.mock.calls[0][1]
    expect(opts.method).toBe('POST')
  })

  test('write() body contains message field', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ msg: 'hello datadog' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].message).toBe('hello datadog')
  })

  test('write() body contains status field from log level', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'error' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('error')
  })

  test('write() body contains service from config', () => {
    const t = new DatadogTransport(makeConfig({ service: 'my-api' }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].service).toBe('my-api')
  })

  test('write() uses logger name as service when service not configured', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ name: 'web-server' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].service).toBe('web-server')
  })

  test('write() includes hostname from config', () => {
    const t = new DatadogTransport(makeConfig({ hostname: 'prod-01' }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].hostname).toBe('prod-01')
  })

  test('write() includes ddtags from config', () => {
    const t = new DatadogTransport(makeConfig({ tags: 'env:prod,version:1.0' }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].ddtags).toBe('env:prod,version:1.0')
  })

  test('write() includes ddsource from config', () => {
    const t = new DatadogTransport(makeConfig({ source: 'bun' }))
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].ddsource).toBe('bun')
  })

  test('write() includes timestamp as ISO string', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ time: 1700000000000 }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].timestamp).toBe(new Date(1700000000000).toISOString())
  })

  test('write() includes extra fields from entry', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ userId: 42, action: 'login' } as any))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].userId).toBe(42)
    expect(body[0].action).toBe('login')
  })

  // ── Batching ────────────────────────────────────────────────────────────

  test('buffers entries until batchSize is reached', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 3 }))
    t.write(makeEntry())
    t.write(makeEntry())
    expect(fetchSpy).not.toHaveBeenCalled()
    t.write(makeEntry())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('batch contains correct number of entries', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 3 }))
    t.write(makeEntry({ msg: 'one' }))
    t.write(makeEntry({ msg: 'two' }))
    t.write(makeEntry({ msg: 'three' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body).toHaveLength(3)
  })

  test('flush() sends buffered entries', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.write(makeEntry())
    expect(fetchSpy).not.toHaveBeenCalled()
    t.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body).toHaveLength(2)
  })

  test('flush() does nothing when buffer is empty', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 100 }))
    t.flush()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('buffer is cleared after flush', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.flush()
    t.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // ── destroy() ───────────────────────────────────────────────────────────

  test('destroy() flushes remaining buffer', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.destroy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('destroy() is safe to call multiple times', () => {
    const t = new DatadogTransport(makeConfig({ batchSize: 100 }))
    t.write(makeEntry())
    t.destroy()
    t.destroy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // ── All log levels ─────────────────────────────────────────────────────

  test('maps trace level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'trace' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('trace')
  })

  test('maps debug level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'debug' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('debug')
  })

  test('maps info level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'info' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('info')
  })

  test('maps warn level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'warn' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('warn')
  })

  test('maps error level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'error' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('error')
  })

  test('maps fatal level to status', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry({ level: 'fatal' }))
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].status).toBe('fatal')
  })

  // ── Entry without msg ──────────────────────────────────────────────────

  test('write() uses JSON stringified rest when no msg', () => {
    const t = new DatadogTransport(makeConfig())
    t.write({ level: 'info', name: 'app', time: 1700000000000, action: 'deploy' } as LogEntry)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].message).toContain('deploy')
  })

  // ── Fetch error does not throw ──────────────────────────────────────────

  test('fetch rejection does not throw from write', () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down'))) as any
    const t = new DatadogTransport(makeConfig())
    expect(() => t.write(makeEntry())).not.toThrow()
  })

  // ── No hostname/tags/source when not configured ────────────────────────

  test('omits hostname when not configured', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].hostname).toBeUndefined()
  })

  test('omits ddtags when not configured', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].ddtags).toBeUndefined()
  })

  test('omits ddsource when not configured', () => {
    const t = new DatadogTransport(makeConfig())
    t.write(makeEntry())
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].ddsource).toBeUndefined()
  })

  // ── Integration with Logger ─────────────────────────────────────────────

  test('works as a LogTransport with Logger', async () => {
    const { Logger } = await import('@tekir/logger')
    const t = new DatadogTransport(makeConfig())
    const logger = new Logger({
      level: 'info',
      transports: [t],
    })
    logger.info('via logger')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body[0].message).toBe('via logger')
  })

  test('works alongside ConsoleTransport', async () => {
    const consoleSpy = mock(() => {})
    console.log = consoleSpy
    const { Logger, ConsoleTransport } = await import('@tekir/logger')
    const dd = new DatadogTransport(makeConfig())
    const logger = new Logger({
      level: 'info',
      transports: [new ConsoleTransport(false), dd],
    })
    logger.info('dual output')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore?.()
  })
})
