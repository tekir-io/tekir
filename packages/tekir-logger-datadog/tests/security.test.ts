import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { DatadogTransport } from '../src/index'
import type { LogEntry } from '@tekir/logger'

describe('DatadogTransport buffer / error visibility', () => {
  let fetchSpy: ReturnType<typeof mock>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy = mock(() => Promise.resolve(new Response(null, { status: 202 })))
    globalThis.fetch = fetchSpy as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function entry(): LogEntry {
    return { level: 'info', msg: 'm', time: 1700000000000, name: 'app' }
  }

  // ── Bounded buffer ─────────────────────────────────────────────────────────

  test('drops oldest entries past maxBufferSize when flush disabled', () => {
    const t = new DatadogTransport({
      apiKey: 'k',
      flushInterval: 0,
      batchSize: 1000000,
      maxBufferSize: 10,
    })
    for (let i = 0; i < 50; i++) t.write(entry())
    expect(t.droppedCount).toBeGreaterThan(0)
  })

  test('does not drop under the bound', () => {
    const t = new DatadogTransport({
      apiKey: 'k',
      flushInterval: 0,
      batchSize: 1000000,
      maxBufferSize: 10000,
    })
    t.write(entry())
    expect(t.droppedCount).toBe(0)
  })

  // ── Flush error visibility ─────────────────────────────────────────────────

  test('onError invoked on network failure', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('down'))) as any
    let err: unknown
    const t = new DatadogTransport({
      apiKey: 'k',
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

  test('onError invoked on non-2xx (e.g. 403 invalid API key)', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 403 }))) as any
    let err: unknown
    const t = new DatadogTransport({
      apiKey: 'k',
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
    const t = new DatadogTransport({
      apiKey: 'k',
      flushInterval: 0,
      batchSize: 1,
    })
    t.write(entry())
    await Promise.resolve()
    await Promise.resolve()
    expect(t.errorCount).toBe(0)
  })

  // ── Site → URL mapping ─────────────────────────────────────────────────────

  test('eu site targets datadoghq.eu', () => {
    const t = new DatadogTransport({ apiKey: 'k', site: 'eu', flushInterval: 0, batchSize: 1 })
    t.write(entry())
    expect(fetchSpy.mock.calls[0][0]).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
  })

  test('default site is us1', () => {
    const t = new DatadogTransport({ apiKey: 'k', flushInterval: 0, batchSize: 1 })
    t.write(entry())
    expect(fetchSpy.mock.calls[0][0]).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
  })
})
