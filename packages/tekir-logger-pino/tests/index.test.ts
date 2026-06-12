import { test, expect, describe, mock, beforeEach } from 'bun:test'
import { PinoTransport } from '../src/index'
import type { LogEntry } from '@tekir/logger'

describe('PinoTransport', () => {
  function makePino() {
    return {
      trace: mock((..._args: any[]) => {}),
      debug: mock((..._args: any[]) => {}),
      info: mock((..._args: any[]) => {}),
      warn: mock((..._args: any[]) => {}),
      error: mock((..._args: any[]) => {}),
      fatal: mock((..._args: any[]) => {}),
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

  test('creates transport with pino instance', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    expect(t).toBeDefined()
  })

  // ── Level mapping ───────────────────────────────────────────────────────

  test('write() calls pino.trace for trace level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'trace' }))
    expect(pino.trace).toHaveBeenCalledTimes(1)
  })

  test('write() calls pino.debug for debug level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'debug' }))
    expect(pino.debug).toHaveBeenCalledTimes(1)
  })

  test('write() calls pino.info for info level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'info' }))
    expect(pino.info).toHaveBeenCalledTimes(1)
  })

  test('write() calls pino.warn for warn level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'warn' }))
    expect(pino.warn).toHaveBeenCalledTimes(1)
  })

  test('write() calls pino.error for error level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'error' }))
    expect(pino.error).toHaveBeenCalledTimes(1)
  })

  test('write() calls pino.fatal for fatal level', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'fatal' }))
    expect(pino.fatal).toHaveBeenCalledTimes(1)
  })

  // ── Message passing ─────────────────────────────────────────────────────

  test('passes msg to pino method', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ msg: 'hello pino' }))
    expect(pino.info.mock.calls[0][0]).toBe('hello pino')
  })

  test('passes empty string when msg is undefined', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write({ level: 'info', name: 'app', time: 1700000000000 } as LogEntry)
    expect(pino.info.mock.calls[0][0]).toBe('')
  })

  // ── Extra fields ────────────────────────────────────────────────────────

  test('passes extra fields as first arg when present', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ userId: 42, action: 'login' } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.userId).toBe(42)
    expect(firstArg.action).toBe('login')
  })

  test('msg is second arg when extra fields present', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ userId: 42 } as any))
    const secondArg = pino.info.mock.calls[0][1]
    expect(secondArg).toBe('test message')
  })

  test('strips level, time, and name from extra fields', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ userId: 42 } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.level).toBeUndefined()
    expect(firstArg.time).toBeUndefined()
    expect(firstArg.name).toBeUndefined()
  })

  test('when no extra fields msg is the only argument', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry())
    expect(pino.info.mock.calls[0]).toHaveLength(1)
    expect(pino.info.mock.calls[0][0]).toBe('test message')
  })

  // ── Does not call other levels ──────────────────────────────────────────

  test('info entry does not call pino.error', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'info' }))
    expect(pino.error).not.toHaveBeenCalled()
  })

  test('error entry does not call pino.info', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'error' }))
    expect(pino.info).not.toHaveBeenCalled()
  })

  test('warn entry does not call pino.debug', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'warn' }))
    expect(pino.debug).not.toHaveBeenCalled()
  })

  // ── Multiple writes ─────────────────────────────────────────────────────

  test('multiple writes call pino correct number of times', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'info' }))
    t.write(makeEntry({ level: 'info' }))
    t.write(makeEntry({ level: 'info' }))
    expect(pino.info).toHaveBeenCalledTimes(3)
  })

  test('mixed levels route to correct pino methods', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'info' }))
    t.write(makeEntry({ level: 'error' }))
    t.write(makeEntry({ level: 'warn' }))
    expect(pino.info).toHaveBeenCalledTimes(1)
    expect(pino.error).toHaveBeenCalledTimes(1)
    expect(pino.warn).toHaveBeenCalledTimes(1)
  })

  // ── Integration with Logger ─────────────────────────────────────────────

  test('works as a LogTransport with Logger', async () => {
    const { Logger } = await import('@tekir/logger')
    const pino = makePino()
    const t = new PinoTransport({ pino })
    const logger = new Logger({
      level: 'info',
      transports: [t],
    })
    logger.info('via logger')
    expect(pino.info).toHaveBeenCalledTimes(1)
  })

  test('works alongside ConsoleTransport', async () => {
    const consoleSpy = mock((..._args: any[]) => {})
    console.log = consoleSpy
    const { Logger, ConsoleTransport } = await import('@tekir/logger')
    const pino = makePino()
    const pt = new PinoTransport({ pino })
    const logger = new Logger({
      level: 'info',
      transports: [new ConsoleTransport(false), pt],
    })
    logger.info('dual output')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(pino.info).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore?.()
  })

  test('child logger entries also go through PinoTransport', async () => {
    const { Logger } = await import('@tekir/logger')
    const pino = makePino()
    const t = new PinoTransport({ pino })
    const logger = new Logger({
      level: 'info',
      transports: [t],
    })
    const child = logger.child({ requestId: 'abc' })
    child.info('child log')
    expect(pino.info).toHaveBeenCalledTimes(1)
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.requestId).toBe('abc')
  })

  // ── Additional tests ──────────────────────────────────────────────────

  test('trace entry does not call pino.info', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'trace' }))
    expect(pino.info).not.toHaveBeenCalled()
  })

  test('fatal entry does not call pino.warn', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'fatal' }))
    expect(pino.warn).not.toHaveBeenCalled()
  })

  test('debug entry does not call pino.error', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'debug' }))
    expect(pino.error).not.toHaveBeenCalled()
  })

  test('trace entry does not call pino.fatal', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ level: 'trace' }))
    expect(pino.fatal).not.toHaveBeenCalled()
  })

  test('multiple extra fields are all passed', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ reqId: 'r1', method: 'GET', path: '/api' } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.reqId).toBe('r1')
    expect(firstArg.method).toBe('GET')
    expect(firstArg.path).toBe('/api')
  })

  test('extra field with nested object', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ user: { id: 1, name: 'Alice' } } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.user).toEqual({ id: 1, name: 'Alice' })
  })

  test('extra field with array value', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ tags: ['http', 'request'] } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.tags).toEqual(['http', 'request'])
  })

  test('extra field with numeric value', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ duration: 123.45 } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.duration).toBe(123.45)
  })

  test('extra field with boolean value', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ cached: true } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.cached).toBe(true)
  })

  test('msg field is stripped from extra fields', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ userId: 5 } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.msg).toBeUndefined()
  })

  test('write 10 entries counts correctly', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    for (let i = 0; i < 10; i++) t.write(makeEntry({ level: 'info' }))
    expect(pino.info).toHaveBeenCalledTimes(10)
  })

  test('all six levels call exactly one pino method each', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    for (const level of levels) {
      const pino = makePino()
      const t = new PinoTransport({ pino })
      t.write(makeEntry({ level }))
      expect(pino[level]).toHaveBeenCalledTimes(1)
      // Others should not be called
      for (const other of levels) {
        if (other !== level) expect(pino[other]).not.toHaveBeenCalled()
      }
    }
  })

  test('empty msg with extra fields still passes msg correctly', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ msg: '', userId: 1 } as any))
    const secondArg = pino.info.mock.calls[0][1]
    expect(secondArg).toBe('')
  })

  test('very long msg is passed through', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    const longMsg = 'x'.repeat(10000)
    t.write(makeEntry({ msg: longMsg }))
    expect(pino.info.mock.calls[0][0]).toBe(longMsg)
  })

  test('entry with only level and name (minimal)', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write({ level: 'warn', name: 'app', time: 0 } as LogEntry)
    expect(pino.warn).toHaveBeenCalledTimes(1)
  })

  test('transport can be instantiated multiple times independently', () => {
    const pino1 = makePino()
    const pino2 = makePino()
    const t1 = new PinoTransport({ pino: pino1 })
    const t2 = new PinoTransport({ pino: pino2 })
    t1.write(makeEntry({ level: 'info' }))
    expect(pino1.info).toHaveBeenCalledTimes(1)
    expect(pino2.info).not.toHaveBeenCalled()
  })

  test('mixed writes across two transports', () => {
    const pino1 = makePino()
    const pino2 = makePino()
    const t1 = new PinoTransport({ pino: pino1 })
    const t2 = new PinoTransport({ pino: pino2 })
    t1.write(makeEntry({ level: 'error' }))
    t2.write(makeEntry({ level: 'info' }))
    t2.write(makeEntry({ level: 'info' }))
    expect(pino1.error).toHaveBeenCalledTimes(1)
    expect(pino2.info).toHaveBeenCalledTimes(2)
  })

  test('write with null extra field value', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ nullField: null } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.nullField).toBeNull()
  })

  test('write with undefined extra field value', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ undefField: undefined } as any))
    expect(pino.info).toHaveBeenCalledTimes(1)
  })

  test('write with empty object extra field', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    t.write(makeEntry({ meta: {} } as any))
    const firstArg = pino.info.mock.calls[0][0]
    expect(firstArg.meta).toEqual({})
  })

  test('write 100 entries performance', () => {
    const pino = makePino()
    const t = new PinoTransport({ pino })
    for (let i = 0; i < 100; i++) t.write(makeEntry())
    expect(pino.info).toHaveBeenCalledTimes(100)
  })
})
