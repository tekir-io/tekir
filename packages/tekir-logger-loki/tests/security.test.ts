import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { LokiTransport } from '../src/index'
import type { LokiTransportConfig } from '../src/index'
import type { LogEntry } from '@tekir/logger'

describe('LokiTransport SSRF / security', () => {
  let fetchSpy: ReturnType<typeof mock>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchSpy as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function entry(): LogEntry {
    return { level: 'info', msg: 'm', time: 1700000000000, name: 'app' }
  }

  // ── SSRF host rejection ────────────────────────────────────────────────────

  test('rejects cloud metadata host', () => {
    expect(() => new LokiTransport({ url: 'http://169.254.169.254/' })).toThrow(/internal\/metadata/)
  })

  test('rejects metadata.google.internal', () => {
    expect(() => new LokiTransport({ url: 'http://metadata.google.internal/' })).toThrow()
  })

  test('rejects localhost by default', () => {
    expect(() => new LokiTransport({ url: 'http://localhost:3100' })).toThrow()
  })

  test('rejects 127.0.0.1 by default', () => {
    expect(() => new LokiTransport({ url: 'http://127.0.0.1:3100' })).toThrow()
  })

  test('rejects private 10.x range by default', () => {
    expect(() => new LokiTransport({ url: 'http://10.0.0.5:3100' })).toThrow()
  })

  test('rejects private 192.168.x range by default', () => {
    expect(() => new LokiTransport({ url: 'http://192.168.1.10:3100' })).toThrow()
  })

  test('rejects 172.16-31 private range by default', () => {
    expect(() => new LokiTransport({ url: 'http://172.20.0.1:3100' })).toThrow()
  })

  test('allows public host', () => {
    expect(() => new LokiTransport({ url: 'https://loki.example.com' })).not.toThrow()
  })

  test('allowInsecureHost permits localhost', () => {
    expect(() => new LokiTransport({ url: 'http://localhost:3100', allowInsecureHost: true })).not.toThrow()
  })

  test('rejects unsupported scheme', () => {
    expect(() => new LokiTransport({ url: 'ftp://loki.example.com' })).toThrow(/scheme/)
  })

  test('rejects invalid url', () => {
    expect(() => new LokiTransport({ url: 'not a url' })).toThrow(/invalid url/)
  })

  // ── TLS / auth over plaintext ──────────────────────────────────────────────

  test('rejects Basic auth over plaintext http', () => {
    expect(() => new LokiTransport({
      url: 'http://loki.example.com',
      auth: { username: 'u', password: 'p' },
    })).toThrow(/plaintext http/)
  })

  test('allows Basic auth over https', () => {
    expect(() => new LokiTransport({
      url: 'https://loki.example.com',
      auth: { username: 'u', password: 'p' },
    })).not.toThrow()
  })

  test('allowInsecureHost permits Basic auth over http', () => {
    expect(() => new LokiTransport({
      url: 'http://loki.example.com',
      auth: { username: 'u', password: 'p' },
      allowInsecureHost: true,
    })).not.toThrow()
  })

  // ── Bounded buffer ─────────────────────────────────────────────────────────

  test('drops oldest entries past maxBufferSize when flush disabled', () => {
    // No fetch since batchSize never reached; flushInterval 0 means no timer.
    const t = new LokiTransport({
      url: 'https://loki.example.com',
      flushInterval: 0,
      batchSize: 1000000,
      maxBufferSize: 10,
    })
    for (let i = 0; i < 50; i++) t.write(entry())
    expect(t.droppedCount).toBeGreaterThan(0)
  })

  // ── Flush error visibility ─────────────────────────────────────────────────

  test('onError invoked on network failure', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('down'))) as any
    let err: unknown
    const t = new LokiTransport({
      url: 'https://loki.example.com',
      flushInterval: 0,
      batchSize: 1,
      onError: (e) => { err = e },
    })
    t.write(entry())
    await Promise.resolve()
    await Promise.resolve()
    expect(err).toBeInstanceOf(Error)
    expect(t.errorCount).toBe(1)
  })

  test('onError invoked on non-2xx response', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 403 }))) as any
    let err: unknown
    const t = new LokiTransport({
      url: 'https://loki.example.com',
      flushInterval: 0,
      batchSize: 1,
      onError: (e) => { err = e },
    })
    t.write(entry())
    await Promise.resolve()
    await Promise.resolve()
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('403')
  })

  test('no error reported on 2xx', async () => {
    const t = new LokiTransport({
      url: 'https://loki.example.com',
      flushInterval: 0,
      batchSize: 1,
    })
    t.write(entry())
    await Promise.resolve()
    await Promise.resolve()
    expect(t.errorCount).toBe(0)
  })

  test('supports non-ASCII Basic auth credentials without throwing', () => {
    let authorization = ''
    globalThis.fetch = (async (_url: string, init: any) => {
      authorization = init.headers.Authorization
      return new Response('', { status: 204 })
    }) as any
    const transport = new LokiTransport({
      url: 'https://logs.example.com',
      auth: { username: 'kullanıcı', password: 'şifre' },
      batchSize: 1,
      flushInterval: 0,
    })
    expect(() => transport.write({ level: 'info', name: 'app', msg: 'ok' })).not.toThrow()
    expect(authorization).toStartWith('Basic ')
  })
})
