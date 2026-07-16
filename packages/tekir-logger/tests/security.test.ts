import { test, expect, describe, mock, beforeEach } from 'bun:test'
import { Logger, ConsoleTransport, sanitizeLogString, FileTransport } from '../src/index'
import type { LogEntry } from '../src/index'
import { join } from 'path'
import { rmSync, readFileSync } from 'fs'

// ── Pretty-mode log injection sanitization ───────────────────────────────────

describe('Pretty-mode log injection sanitization', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('sanitizeLogString strips CRLF', () => {
    expect(sanitizeLogString('a\r\nb')).toBe('a\\nb')
    expect(sanitizeLogString('a\nb')).toBe('a\\nb')
    expect(sanitizeLogString('a\rb')).toBe('a\\nb')
  })

  test('sanitizeLogString strips ANSI escape sequences', () => {
    expect(sanitizeLogString('\x1b[31mred\x1b[0m')).toBe('red')
  })

  test('sanitizeLogString strips other control chars', () => {
    expect(sanitizeLogString('a\x00\x07b')).toBe('ab')
  })

  test('pretty output does not contain raw newline from msg', () => {
    const logger = new Logger({ level: 'info', pretty: true, timestamp: false })
    logger.info('line1\r\nINJECTED fake log line')
    const out = spy.mock.calls[0][0] as string
    // No raw CR/LF should survive into the rendered line.
    expect(out.includes('\n')).toBe(false)
    expect(out.includes('\r')).toBe(false)
    expect(out).toContain('INJECTED')
  })

  test('pretty output strips ANSI escapes embedded in msg', () => {
    const logger = new Logger({ level: 'info', pretty: true, timestamp: false })
    logger.info('hello\x1b[31mEVIL\x1b[0m')
    const out = spy.mock.calls[0][0] as string
    // The only ANSI codes present should be the logger's own colour wrappers,
    // not the attacker's. The injected red sequence must be gone.
    expect(out).toContain('EVIL')
    expect(out).not.toContain('\x1b[31mEVIL')
  })

  test('pretty output sanitizes string fields in extra object', () => {
    const logger = new Logger({ level: 'info', pretty: true, timestamp: false })
    logger.info('msg', { evil: 'a\r\nb' })
    const out = spy.mock.calls[0][0] as string
    expect(out.includes('\r')).toBe(false)
    expect(out.includes('\n')).toBe(false)
    expect(out).toContain('evil')
  })

  test('JSON mode remains intact and parseable with injection attempt', () => {
    const logger = new Logger({ level: 'info', pretty: false })
    logger.info('a\r\nb')
    const out = JSON.parse(spy.mock.calls[0][0])
    // JSON.stringify already escapes; msg preserved as data.
    expect(out.msg).toBe('a\r\nb')
  })
})

// ── Deep redaction ───────────────────────────────────────────────────────────

describe('Deep redaction', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('redacts nested fields', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    logger.info({ user: { name: 'ali', password: 'secret' } }, 'login')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.user.password).toBe('[REDACTED]')
    expect(out.user.name).toBe('ali')
  })

  test('redacts deeply nested fields', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['token'] })
    logger.info({ a: { b: { c: { token: 'abc' } } } }, 'deep')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.a.b.c.token).toBe('[REDACTED]')
  })

  test('redacts fields inside arrays', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['secret'] })
    logger.info({ items: [{ secret: 'x' }, { secret: 'y' }] }, 'arr')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.items[0].secret).toBe('[REDACTED]')
    expect(out.items[1].secret).toBe('[REDACTED]')
  })

  test('redacts sensitive fields coming from context', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['authorization'] })
    const child = logger.child({ headers: { authorization: 'Bearer abc' } })
    child.info('request')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.headers.authorization).toBe('[REDACTED]')
  })

  test('top-level redaction still works', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    logger.info({ password: 'secret', user: 'ali' }, 'login')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.password).toBe('[REDACTED]')
    expect(out.user).toBe('ali')
  })

  test('non-redacted nested fields pass through', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    logger.info({ user: { name: 'ali', age: 30 } }, 'x')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.user.name).toBe('ali')
    expect(out.user.age).toBe(30)
  })

  test('redaction does not mutate the caller object', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    const obj = { user: { password: 'secret' } }
    logger.info(obj, 'x')
    expect(obj.user.password).toBe('secret')
  })

  test('handles circular references without throwing', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    const obj: any = { password: 'x' }
    obj.self = obj
    expect(() => logger.info(obj, 'circular')).not.toThrow()
  })

  test('structured data cannot forge the selected log level', () => {
    const logger = new Logger({ level: 'info', pretty: false, timestamp: false })
    logger.error({ level: 'trace', event: 'failed' } as any, 'boom')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('error')
  })
})

// ── FileTransport bounded queue ──────────────────────────────────────────────

describe('FileTransport bounded queue', () => {
  const testDir = join(process.cwd(), 'tmp-logger-queue-test')
  const logPath = join(testDir, 'q.log')

  test('drops oldest lines when queue exceeds maxQueueSize', async () => {
    rmSync(testDir, { recursive: true, force: true })
    const ft = new FileTransport({ path: logPath, maxQueueSize: 5 })
    // Synchronously enqueue far more than the bound before any flush completes.
    for (let i = 0; i < 100; i++) {
      ft.write({ level: 'info', msg: `m${i}`, name: 'app' })
    }
    expect(ft.droppedCount).toBeGreaterThan(0)
    await ft.flush()
    rmSync(testDir, { recursive: true, force: true })
  })

  test('does not drop when under the bound', () => {
    rmSync(testDir, { recursive: true, force: true })
    const ft = new FileTransport({ path: logPath, maxQueueSize: 10000 })
    ft.write({ level: 'info', msg: 'one', name: 'app' })
    expect(ft.droppedCount).toBe(0)
    rmSync(testDir, { recursive: true, force: true })
  })

  test('maxQueueSize 0 disables the bound', () => {
    rmSync(testDir, { recursive: true, force: true })
    const ft = new FileTransport({ path: logPath, maxQueueSize: 0 })
    for (let i = 0; i < 50; i++) {
      ft.write({ level: 'info', msg: `m${i}`, name: 'app' })
    }
    expect(ft.droppedCount).toBe(0)
    rmSync(testDir, { recursive: true, force: true })
  })

  test('background write failures are observed instead of becoming unhandled rejections', async () => {
    rmSync(testDir, { recursive: true, force: true })
    let observed: unknown
    const ft = new FileTransport({
      path: logPath,
      onError: (error) => { observed = error },
    })
    ;(ft as any)._dirReady = Promise.reject(new Error('disk unavailable'))
    ft.write({ level: 'info', msg: 'one', name: 'app' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(ft.errorCount).toBe(1)
    expect(observed).toBeInstanceOf(Error)
  })
})

// ── Child level mapping ──────────────────────────────────────────────────────

describe('Child logger level mapping', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('child preserves each parent level correctly', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    for (const lvl of levels) {
      spy.mockClear?.()
      const parent = new Logger({ level: lvl, pretty: false })
      const child = parent.child({ ctx: 1 })
      // The exact-threshold level must pass through the child.
      ;(child as any)[lvl](`at-${lvl}`)
      expect(spy).toHaveBeenCalledTimes(1)
    }
  })
})
