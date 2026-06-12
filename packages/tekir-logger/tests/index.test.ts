import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { Logger, ConsoleTransport, createLogger, FileTransport } from '../src/index'
import type { LogLevel, LoggerConfig, LogTransport, LogEntry } from '../src/index'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

describe('Logger', () => {
  let consoleSpy: ReturnType<typeof mock>

  beforeEach(() => {
    consoleSpy = mock(() => {})
    console.log = consoleSpy
  })

  afterEach(() => {
    consoleSpy.mockRestore?.()
  })

  describe('constructor defaults', () => {
    test('creates logger with default config', () => {
      const logger = new Logger()
      expect(logger).toBeInstanceOf(Logger)
    })

    test('createLogger factory returns Logger instance', () => {
      const logger = createLogger()
      expect(logger).toBeInstanceOf(Logger)
    })

    test('createLogger accepts config', () => {
      const logger = createLogger({ name: 'test', level: 'debug' })
      expect(logger).toBeInstanceOf(Logger)
    })
  })

  describe('isLevelEnabled', () => {
    test('info level enables info, warn, error, fatal', () => {
      const logger = new Logger({ level: 'info' })
      expect(logger.isLevelEnabled('info')).toBe(true)
      expect(logger.isLevelEnabled('warn')).toBe(true)
      expect(logger.isLevelEnabled('error')).toBe(true)
      expect(logger.isLevelEnabled('fatal')).toBe(true)
    })

    test('info level disables trace and debug', () => {
      const logger = new Logger({ level: 'info' })
      expect(logger.isLevelEnabled('trace')).toBe(false)
      expect(logger.isLevelEnabled('debug')).toBe(false)
    })

    test('debug level enables debug and above', () => {
      const logger = new Logger({ level: 'debug' })
      expect(logger.isLevelEnabled('debug')).toBe(true)
      expect(logger.isLevelEnabled('trace')).toBe(false)
    })

    test('trace level enables all levels', () => {
      const logger = new Logger({ level: 'trace' })
      expect(logger.isLevelEnabled('trace')).toBe(true)
      expect(logger.isLevelEnabled('debug')).toBe(true)
      expect(logger.isLevelEnabled('info')).toBe(true)
    })

    test('fatal level disables everything below fatal', () => {
      const logger = new Logger({ level: 'fatal' })
      expect(logger.isLevelEnabled('error')).toBe(false)
      expect(logger.isLevelEnabled('fatal')).toBe(true)
    })

    test('disabled logger reports all levels as disabled', () => {
      const logger = new Logger({ enabled: false })
      expect(logger.isLevelEnabled('info')).toBe(false)
      expect(logger.isLevelEnabled('error')).toBe(false)
    })
  })

  describe('logging methods', () => {
    test('info() logs when level is info', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      logger.info('hello world')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.level).toBe('info')
      expect(output.msg).toBe('hello world')
    })

    test('debug() is suppressed when level is info', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      logger.debug('debug msg')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    test('warn() logs at warn level', () => {
      const logger = new Logger({ level: 'warn', pretty: false })
      logger.warn('warning')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.level).toBe('warn')
    })

    test('error() logs at error level', () => {
      const logger = new Logger({ level: 'error', pretty: false })
      logger.error('something broke')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.level).toBe('error')
    })

    test('fatal() logs at fatal level', () => {
      const logger = new Logger({ level: 'fatal', pretty: false })
      logger.fatal('crash')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.level).toBe('fatal')
    })

    test('trace() logs when level is trace', () => {
      const logger = new Logger({ level: 'trace', pretty: false })
      logger.trace('trace msg')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.level).toBe('trace')
    })

    test('no output when enabled is false', () => {
      const logger = new Logger({ enabled: false, pretty: false })
      logger.info('should not log')
      logger.error('should not log')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('structured logging', () => {
    test('logs object as first argument with message as second', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      logger.info({ userId: 42 }, 'user action')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.userId).toBe(42)
      expect(output.msg).toBe('user action')
    })

    test('logs string first argument, object as extra', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      logger.info('msg', { extra: true })
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.msg).toBe('msg')
      expect(output.extra).toBe(true)
    })

    test('includes name in log entry', () => {
      const logger = new Logger({ level: 'info', pretty: false, name: 'myapp' })
      logger.info('test')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.name).toBe('myapp')
    })

    test('includes timestamp when timestamp is true', () => {
      const logger = new Logger({ level: 'info', pretty: false, timestamp: true })
      logger.info('test')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(typeof output.time).toBe('number')
    })

    test('omits timestamp when timestamp is false', () => {
      const logger = new Logger({ level: 'info', pretty: false, timestamp: false })
      logger.info('test')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.time).toBeUndefined()
    })
  })

  describe('redaction', () => {
    test('redacts specified fields', () => {
      const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
      logger.info({ username: 'ali', password: 'secret' }, 'login')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.password).toBe('[REDACTED]')
      expect(output.username).toBe('ali')
    })

    test('redacts multiple fields', () => {
      const logger = new Logger({ level: 'info', pretty: false, redact: ['password', 'token'] })
      logger.info({ password: 'x', token: 'y', user: 'z' }, 'auth')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.password).toBe('[REDACTED]')
      expect(output.token).toBe('[REDACTED]')
      expect(output.user).toBe('z')
    })

    test('does not redact fields not in redact list', () => {
      const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
      logger.info({ apiKey: 'abc' }, 'test')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.apiKey).toBe('abc')
    })
  })

  describe('child logger', () => {
    test('child() returns a Logger instance', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      const child = logger.child({ requestId: '123' })
      expect(child).toBeInstanceOf(Logger)
    })

    test('child logger includes parent context in output', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      const child = logger.child({ requestId: 'abc' })
      child.info('handling request')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.requestId).toBe('abc')
    })

    test('child logger merges additional context', () => {
      const logger = new Logger({ level: 'info', pretty: false })
      const child = logger.child({ service: 'auth' })
      const grandchild = child.child({ userId: 99 })
      grandchild.info('nested')
      const output = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(output.service).toBe('auth')
      expect(output.userId).toBe(99)
    })

    test('child inherits level from parent', () => {
      const logger = new Logger({ level: 'warn', pretty: false })
      const child = logger.child({ ctx: true })
      child.debug('should be suppressed')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    test('child inherits enabled state from parent', () => {
      const logger = new Logger({ enabled: false, pretty: false })
      const child = logger.child({ ctx: true })
      child.info('should not log')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('pretty mode', () => {
    test('pretty mode calls console.log with string (not JSON)', () => {
      const logger = new Logger({ level: 'info', pretty: true })
      logger.info('pretty message')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      // pretty output is a plain string, not parseable as JSON
      const output = consoleSpy.mock.calls[0][0]
      expect(typeof output).toBe('string')
    })
  })
})


describe('All 6 log levels produce output', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('trace() emits a log entry with level "trace"', () => {
    const logger = new Logger({ level: 'trace', pretty: false })
    logger.trace('trace-msg')
    expect(spy).toHaveBeenCalledTimes(1)
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('trace')
    expect(out.msg).toBe('trace-msg')
  })

  test('debug() emits a log entry with level "debug"', () => {
    const logger = new Logger({ level: 'debug', pretty: false })
    logger.debug('debug-msg')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('debug')
    expect(out.msg).toBe('debug-msg')
  })

  test('info() emits a log entry with level "info"', () => {
    const logger = new Logger({ level: 'info', pretty: false })
    logger.info('info-msg')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('info')
    expect(out.msg).toBe('info-msg')
  })

  test('warn() emits a log entry with level "warn"', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.warn('warn-msg')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('warn')
    expect(out.msg).toBe('warn-msg')
  })

  test('error() emits a log entry with level "error"', () => {
    const logger = new Logger({ level: 'error', pretty: false })
    logger.error('error-msg')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('error')
    expect(out.msg).toBe('error-msg')
  })

  test('fatal() emits a log entry with level "fatal"', () => {
    const logger = new Logger({ level: 'fatal', pretty: false })
    logger.fatal('fatal-msg')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('fatal')
    expect(out.msg).toBe('fatal-msg')
  })
})


describe('Level filtering', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('setting level to "error" suppresses trace, debug, info, warn', () => {
    const logger = new Logger({ level: 'error', pretty: false })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    expect(spy).not.toHaveBeenCalled()
  })

  test('setting level to "error" allows error and fatal', () => {
    const logger = new Logger({ level: 'error', pretty: false })
    logger.error('e')
    logger.fatal('f')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('setting level to "warn" suppresses debug and info', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.debug('d')
    logger.info('i')
    expect(spy).not.toHaveBeenCalled()
  })

  test('setting level to "warn" allows warn, error, fatal', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.warn('w')
    logger.error('e')
    logger.fatal('f')
    expect(spy).toHaveBeenCalledTimes(3)
  })

  test('setting level to "fatal" suppresses everything except fatal', () => {
    const logger = new Logger({ level: 'fatal', pretty: false })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(spy).not.toHaveBeenCalled()
    logger.fatal('f')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('setting level to "trace" allows all 6 levels', () => {
    const logger = new Logger({ level: 'trace', pretty: false })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    logger.fatal('f')
    expect(spy).toHaveBeenCalledTimes(6)
  })
})


describe('Child logger inherits parent level', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('child of a "warn" logger suppresses info', () => {
    const parent = new Logger({ level: 'warn', pretty: false })
    const child = parent.child({ req: 1 })
    child.info('should not appear')
    expect(spy).not.toHaveBeenCalled()
  })

  test('child of a "warn" logger allows warn and above', () => {
    const parent = new Logger({ level: 'warn', pretty: false })
    const child = parent.child({ req: 2 })
    child.warn('visible')
    child.error('also visible')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('child of a "trace" logger allows all levels', () => {
    const parent = new Logger({ level: 'trace', pretty: false })
    const child = parent.child({ ctx: true })
    child.trace('t')
    child.debug('d')
    child.info('i')
    expect(spy).toHaveBeenCalledTimes(3)
  })

  test('child of disabled parent produces no output', () => {
    const parent = new Logger({ enabled: false, pretty: false })
    const child = parent.child({ x: 1 })
    child.error('should be silent')
    expect(spy).not.toHaveBeenCalled()
  })
})


describe('Child logger adds context', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('child context keys appear in every log entry', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    const child = parent.child({ requestId: 'req-abc' })
    child.info('handling')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.requestId).toBe('req-abc')
  })

  test('grandchild merges parent and child context', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    const child = parent.child({ service: 'api' })
    const grand = child.child({ userId: 7 })
    grand.info('deep')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.service).toBe('api')
    expect(out.userId).toBe(7)
  })

  test('child context does not bleed back into parent', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    parent.child({ injected: true })
    parent.info('parent log')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.injected).toBeUndefined()
  })

  test('per-call object keys override context keys', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    const child = parent.child({ env: 'prod' })
    child.info({ env: 'test' }, 'override')
    const out = JSON.parse(spy.mock.calls[0][0])
    // Per-call obj is spread after context, so it wins
    expect(out.env).toBe('test')
  })
})


describe('Redaction extended', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('redacts a single top-level key', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['ssn'] })
    // Use 'username' instead of 'name' — the logger always writes name: this.name
    // (the logger instance name, default 'app') which overwrites any 'name' field.
    logger.info({ ssn: '123-45-6789', username: 'alice' }, 'user')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.ssn).toBe('[REDACTED]')
    expect(out.username).toBe('alice')
  })

  test('redacts multiple keys in one log call', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password', 'token', 'secret'] })
    logger.info({ password: 'p', token: 't', secret: 's', user: 'u' }, 'auth')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.password).toBe('[REDACTED]')
    expect(out.token).toBe('[REDACTED]')
    expect(out.secret).toBe('[REDACTED]')
    expect(out.user).toBe('u')
  })

  test('non-redacted keys pass through untouched', () => {
    const logger = new Logger({ level: 'info', pretty: false, redact: ['password'] })
    logger.info({ apiKey: 'open', password: 'closed' }, 'test')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.apiKey).toBe('open')
  })

  test('child logger inherits redact list from parent', () => {
    const parent = new Logger({ level: 'info', pretty: false, redact: ['creditCard'] })
    const child = parent.child({ service: 'payment' })
    child.info({ creditCard: '4111-1111-1111-1111' }, 'charge')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.creditCard).toBe('[REDACTED]')
  })
})


describe('Structured logging with Error objects', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('logging an Error object as the first arg is handled', () => {
    const logger = new Logger({ level: 'error', pretty: false })
    const err = new Error('something broke')
    // Error passed as first arg (object path)
    logger.error(err, 'caught error')
    expect(spy).toHaveBeenCalledTimes(1)
    const raw = spy.mock.calls[0][0]
    expect(typeof raw).toBe('string')
  })

  test('logging with an error in an object field includes the message', () => {
    const logger = new Logger({ level: 'error', pretty: false })
    const err = new Error('db timeout')
    logger.error({ error: err.message, code: 500 }, 'request failed')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.error).toBe('db timeout')
    expect(out.code).toBe(500)
    expect(out.msg).toBe('request failed')
  })

  test('structured error log includes level and name fields', () => {
    const logger = new Logger({ level: 'error', pretty: false, name: 'api' })
    logger.error({ err: 'oops' }, 'failure')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('error')
    expect(out.name).toBe('api')
  })
})


describe('Pretty vs JSON output mode', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('JSON mode output is valid JSON', () => {
    const logger = new Logger({ level: 'info', pretty: false })
    logger.info('json-test')
    const raw = spy.mock.calls[0][0]
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test('JSON mode output contains level field', () => {
    const logger = new Logger({ level: 'info', pretty: false })
    logger.info('level-check')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.level).toBe('info')
  })

  test('pretty mode output is a plain string', () => {
    const logger = new Logger({ level: 'info', pretty: true })
    logger.info('pretty-test')
    const raw = spy.mock.calls[0][0]
    expect(typeof raw).toBe('string')
  })

  test('pretty mode output contains the message text', () => {
    const logger = new Logger({ level: 'info', pretty: true })
    logger.info('hello pretty')
    const raw = spy.mock.calls[0][0] as string
    expect(raw).toContain('hello pretty')
  })

  test('pretty mode output contains the level name', () => {
    const logger = new Logger({ level: 'warn', pretty: true })
    logger.warn('watch out')
    const raw = spy.mock.calls[0][0] as string
    expect(raw.toLowerCase()).toContain('warn')
  })
})


describe('isLevelEnabled for all levels', () => {
  test('isLevelEnabled returns correct results at each threshold', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    for (let i = 0; i < levels.length; i++) {
      const threshold = levels[i]
      const logger = new Logger({ level: threshold, pretty: false })
      for (let j = 0; j < levels.length; j++) {
        const queried = levels[j]
        const expected = j >= i
        expect(logger.isLevelEnabled(queried)).toBe(expected)
      }
    }
  })

  test('disabled logger returns false for isLevelEnabled at every level', () => {
    const logger = new Logger({ enabled: false, level: 'trace', pretty: false })
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    for (const level of levels) {
      expect(logger.isLevelEnabled(level)).toBe(false)
    }
  })

  test('isLevelEnabled returns true for exact threshold level', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    expect(logger.isLevelEnabled('warn')).toBe(true)
  })

  test('isLevelEnabled returns false one level below threshold', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    expect(logger.isLevelEnabled('info')).toBe(false)
  })
})

// Additional: Logger level filtering — debug suppressed at warn level

describe('Logger level filtering — debug suppressed at warn', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('debug() is suppressed when level is warn', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.debug('should not appear')
    expect(spy).not.toHaveBeenCalled()
  })

  test('info() is suppressed when level is warn', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.info('should not appear')
    expect(spy).not.toHaveBeenCalled()
  })

  test('trace() is suppressed when level is warn', () => {
    const logger = new Logger({ level: 'warn', pretty: false })
    logger.trace('should not appear')
    expect(spy).not.toHaveBeenCalled()
  })
})

// Additional: Logger.child() creates child logger

describe('Logger.child() — extended', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('child logger is a separate Logger instance', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    const child = parent.child({ module: 'auth' })
    expect(child).toBeInstanceOf(Logger)
    expect(child).not.toBe(parent)
  })

  test('child logger context does not mutate parent output', () => {
    const parent = new Logger({ level: 'info', pretty: false })
    parent.child({ injected: 'value' })
    parent.info('parent message')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.injected).toBeUndefined()
  })

  test('deeply nested child inherits all ancestor context', () => {
    const root = new Logger({ level: 'info', pretty: false })
    const child = root.child({ a: 1 })
    const grandchild = child.child({ b: 2 })
    const great = grandchild.child({ c: 3 })
    great.info('deep')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.a).toBe(1)
    expect(out.b).toBe(2)
    expect(out.c).toBe(3)
  })
})

// Additional: Logger enabled=false suppresses all output

describe('Logger enabled=false — complete suppression', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('all 6 levels produce no output when enabled is false', () => {
    const logger = new Logger({ enabled: false, level: 'trace', pretty: false })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    logger.fatal('f')
    expect(spy).not.toHaveBeenCalled()
  })

  test('child of disabled logger also produces no output', () => {
    const parent = new Logger({ enabled: false, pretty: false })
    const child = parent.child({ ctx: true })
    child.error('should be silent')
    child.fatal('also silent')
    expect(spy).not.toHaveBeenCalled()
  })
})

// Additional: createLogger factory with config

describe('createLogger factory — extended', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('createLogger with no args returns a working Logger', () => {
    const logger = createLogger()
    expect(logger).toBeInstanceOf(Logger)
  })

  test('createLogger with name and level respects config', () => {
    const logger = createLogger({ name: 'myservice', level: 'error', pretty: false })
    logger.info('suppressed')
    expect(spy).not.toHaveBeenCalled()
    logger.error('visible')
    expect(spy).toHaveBeenCalledTimes(1)
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.name).toBe('myservice')
    expect(out.level).toBe('error')
  })
})

// Additional: Logger name appears in output

describe('Logger name — in output', () => {
  let spy: ReturnType<typeof mock>

  beforeEach(() => {
    spy = mock(() => {})
    console.log = spy
  })

  test('name field appears in JSON output', () => {
    const logger = new Logger({ name: 'api-server', level: 'info', pretty: false })
    logger.info('request handled')
    const out = JSON.parse(spy.mock.calls[0][0])
    expect(out.name).toBe('api-server')
  })

  test('default name appears when no name is configured', () => {
    const logger = new Logger({ level: 'info', pretty: false })
    logger.info('test')
    const out = JSON.parse(spy.mock.calls[0][0])
    // Default name should be present (likely 'app' or similar)
    expect(out.name).toBeDefined()
  })
})

// Additional: All 6 log levels exist as methods

describe('All 6 log level methods exist', () => {
  test('Logger instance has trace, debug, info, warn, error, fatal methods', () => {
    const logger = new Logger()
    expect(typeof logger.trace).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.fatal).toBe('function')
  })

  test('createLogger instance also has all 6 methods', () => {
    const logger = createLogger()
    expect(typeof logger.trace).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.fatal).toBe('function')
  })
})

// Transport system

describe('Transport system', () => {
  test('addTransport adds a custom transport', () => {
    const entries: LogEntry[] = []
    const transport: LogTransport = { write: (e) => { entries.push(e) } }
    const logger = new Logger({ level: 'info', transports: [] })
    logger.addTransport(transport)
    logger.info('test')
    expect(entries).toHaveLength(1)
    expect(entries[0].msg).toBe('test')
  })

  test('removeTransport removes a transport', () => {
    const entries: LogEntry[] = []
    const transport: LogTransport = { write: (e) => { entries.push(e) } }
    const logger = new Logger({ level: 'info', transports: [transport] })
    logger.removeTransport(transport)
    logger.info('test')
    expect(entries).toHaveLength(0)
  })

  test('removeTransport is safe when transport not found', () => {
    const transport: LogTransport = { write: () => {} }
    const logger = new Logger({ level: 'info', transports: [] })
    expect(() => logger.removeTransport(transport)).not.toThrow()
  })

  test('multiple transports all receive entries', () => {
    const a: LogEntry[] = []
    const b: LogEntry[] = []
    const logger = new Logger({
      level: 'info',
      transports: [
        { write: (e) => { a.push(e) } },
        { write: (e) => { b.push(e) } },
      ],
    })
    logger.info('multi')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  test('passing transports in config replaces default ConsoleTransport', () => {
    const consoleSpy = mock((..._args: any[]) => {})
    console.log = consoleSpy
    const entries: LogEntry[] = []
    const logger = new Logger({
      level: 'info',
      transports: [{ write: (e) => { entries.push(e) } }],
    })
    logger.info('custom only')
    expect(entries).toHaveLength(1)
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore?.()
  })

  test('child logger inherits transports from parent', () => {
    const entries: LogEntry[] = []
    const logger = new Logger({
      level: 'info',
      transports: [{ write: (e) => { entries.push(e) } }],
    })
    const child = logger.child({ ctx: true })
    child.info('child msg')
    expect(entries).toHaveLength(1)
    expect(entries[0].ctx).toBe(true)
  })

  test('ConsoleTransport JSON mode outputs valid JSON', () => {
    const consoleSpy = mock((..._args: any[]) => {})
    console.log = consoleSpy
    const ct = new ConsoleTransport(false)
    ct.write({ level: 'info', msg: 'test', name: 'app', time: Date.now() })
    expect(() => JSON.parse(consoleSpy.mock.calls[0][0])).not.toThrow()
    consoleSpy.mockRestore?.()
  })

  test('ConsoleTransport pretty mode outputs string', () => {
    const consoleSpy = mock((..._args: any[]) => {})
    console.log = consoleSpy
    const ct = new ConsoleTransport(true)
    ct.write({ level: 'info', msg: 'pretty', name: 'app', time: Date.now() })
    expect(typeof consoleSpy.mock.calls[0][0]).toBe('string')
    expect(consoleSpy.mock.calls[0][0]).toContain('pretty')
    consoleSpy.mockRestore?.()
  })
})

// FileTransport

describe('FileTransport', () => {
  const testDir = join(process.cwd(), 'tmp-logger-test')
  const logPath = join(testDir, 'test.log')

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('creates directory if it does not exist', async () => {
    const ft = new FileTransport({ path: logPath })
    ft.write({ level: 'info', msg: 'init', name: 'app' })
    await ft.flush()
    expect(existsSync(testDir)).toBe(true)
  })

  test('writes JSON line to file', async () => {
    const ft = new FileTransport({ path: logPath })
    ft.write({ level: 'info', msg: 'hello file', name: 'app', time: Date.now() })
    await ft.flush()
    const content = readFileSync(logPath, 'utf-8').trim()
    const parsed = JSON.parse(content)
    expect(parsed.msg).toBe('hello file')
  })

  test('appends multiple entries as separate lines', async () => {
    const ft = new FileTransport({ path: logPath })
    ft.write({ level: 'info', msg: 'line1', name: 'app' })
    await ft.flush()
    ft.write({ level: 'info', msg: 'line2', name: 'app' })
    await ft.flush()
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  test('includes prefix and suffix', async () => {
    const ft = new FileTransport({ path: logPath, prefix: '[P]', suffix: '[S]' })
    ft.write({ level: 'info', msg: 'test', name: 'app' })
    await ft.flush()
    const content = readFileSync(logPath, 'utf-8').trim()
    expect(content.startsWith('[P]')).toBe(true)
    expect(content.endsWith('[S]')).toBe(true)
  })

  test('rotates file when maxSize is exceeded', async () => {
    const ft = new FileTransport({ path: logPath, maxSize: 50, maxFiles: 3 })
    // Write enough to exceed 50 bytes
    for (let i = 0; i < 5; i++) {
      ft.write({ level: 'info', msg: `message-${i}-padding-data`, name: 'app' })
      await ft.flush()
    }
    const rotated = join(testDir, 'test.1.log')
    expect(existsSync(rotated)).toBe(true)
  })

  test('deletes files beyond maxFiles', async () => {
    const ft = new FileTransport({ path: logPath, maxSize: 50, maxFiles: 2 })
    for (let i = 0; i < 20; i++) {
      ft.write({ level: 'info', msg: `message-${i}-padding-data-extra`, name: 'app' })
      await ft.flush()
    }
    const beyond = join(testDir, 'test.3.log')
    expect(existsSync(beyond)).toBe(false)
  })

  test('works as Logger transport', async () => {
    const ft = new FileTransport({ path: logPath })
    const logger = new Logger({ level: 'info', transports: [ft] })
    logger.info('via logger')
    await ft.flush()
    const content = readFileSync(logPath, 'utf-8').trim()
    const parsed = JSON.parse(content)
    expect(parsed.msg).toBe('via logger')
  })

  test('works alongside ConsoleTransport', async () => {
    const consoleSpy = mock((..._args: any[]) => {})
    console.log = consoleSpy
    const ft = new FileTransport({ path: logPath })
    const logger = new Logger({
      level: 'info',
      transports: [new ConsoleTransport(false), ft],
    })
    logger.info('dual')
    await ft.flush()
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const content = readFileSync(logPath, 'utf-8').trim()
    expect(JSON.parse(content).msg).toBe('dual')
    consoleSpy.mockRestore?.()
  })

  test('default maxSize is 10MB', async () => {
    const ft = new FileTransport({ path: logPath })
    // Just verify it doesn't rotate on small writes
    ft.write({ level: 'info', msg: 'small', name: 'app' })
    await ft.flush()
    const rotated = join(testDir, 'test.1.log')
    expect(existsSync(rotated)).toBe(false)
  })

  test('default maxFiles is 5', async () => {
    // Create fake rotated files
    mkdirSync(testDir, { recursive: true })
    for (let i = 1; i <= 7; i++) {
      writeFileSync(join(testDir, `test.${i}.log`), 'old')
    }
    writeFileSync(logPath, 'x'.repeat(100))
    const ft = new FileTransport({ path: logPath, maxSize: 50 })
    ft.write({ level: 'info', msg: 'trigger rotation', name: 'app' })
    await ft.flush()
    // Files 5, 6, 7 should be cleaned up
    expect(existsSync(join(testDir, 'test.6.log'))).toBe(false)
    expect(existsSync(join(testDir, 'test.7.log'))).toBe(false)
  })
})

// Additional Logger tests

describe('Logger — additional', () => {
  test('Logger has info method', () => {
    const logger = new Logger()
    expect(typeof logger.info).toBe('function')
  })

  test('Logger has warn method', () => {
    const logger = new Logger()
    expect(typeof logger.warn).toBe('function')
  })

  test('Logger has error method', () => {
    const logger = new Logger()
    expect(typeof logger.error).toBe('function')
  })

  test('Logger has debug method', () => {
    const logger = new Logger()
    expect(typeof logger.debug).toBe('function')
  })

  test('Logger has trace method', () => {
    const logger = new Logger()
    expect(typeof logger.trace).toBe('function')
  })

  test('Logger has fatal method', () => {
    const logger = new Logger()
    expect(typeof logger.fatal).toBe('function')
  })

  test('isLevelEnabled for debug level', () => {
    const logger = new Logger({ level: 'debug' })
    expect(logger.isLevelEnabled('debug')).toBe(true)
    expect(logger.isLevelEnabled('info')).toBe(true)
    expect(logger.isLevelEnabled('error')).toBe(true)
  })

  test('isLevelEnabled for error level', () => {
    const logger = new Logger({ level: 'error' })
    expect(logger.isLevelEnabled('error')).toBe(true)
    expect(logger.isLevelEnabled('fatal')).toBe(true)
    expect(logger.isLevelEnabled('info')).toBe(false)
    expect(logger.isLevelEnabled('debug')).toBe(false)
  })

  test('isLevelEnabled for trace level enables all', () => {
    const logger = new Logger({ level: 'trace' })
    expect(logger.isLevelEnabled('trace')).toBe(true)
    expect(logger.isLevelEnabled('debug')).toBe(true)
    expect(logger.isLevelEnabled('info')).toBe(true)
    expect(logger.isLevelEnabled('warn')).toBe(true)
    expect(logger.isLevelEnabled('error')).toBe(true)
    expect(logger.isLevelEnabled('fatal')).toBe(true)
  })

  test('child logger inherits parent config', () => {
    const parent = new Logger({ name: 'parent', level: 'debug' })
    const child = parent.child({ name: 'child' })
    expect(child).toBeInstanceOf(Logger)
  })

  test('multiple createLogger calls return independent instances', () => {
    const l1 = createLogger({ name: 'a' })
    const l2 = createLogger({ name: 'b' })
    expect(l1).not.toBe(l2)
  })

  test('logger with custom name', () => {
    const logger = new Logger({ name: 'myapp' })
    expect(logger).toBeInstanceOf(Logger)
  })
})

describe('ConsoleTransport — additional', () => {
  test('ConsoleTransport is constructable', () => {
    const transport = new ConsoleTransport()
    expect(transport).toBeInstanceOf(ConsoleTransport)
  })

  test('ConsoleTransport with pretty=false', () => {
    const transport = new ConsoleTransport(false)
    expect(transport).toBeInstanceOf(ConsoleTransport)
  })

  test('ConsoleTransport with pretty=true', () => {
    const transport = new ConsoleTransport(true)
    expect(transport).toBeInstanceOf(ConsoleTransport)
  })

  test('ConsoleTransport has write method', () => {
    const transport = new ConsoleTransport()
    expect(typeof transport.write).toBe('function')
  })
})


describe('Logger — level filtering', () => {
  test('logger with level "error" does not call transport for info', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'error', transports: [transport] })
    logger.info('test')
    expect(written).toBe(false)
  })

  test('logger with level "error" calls transport for error', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'error', transports: [transport] })
    logger.error('test')
    expect(written).toBe(true)
  })

  test('logger with level "info" calls transport for info', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'info', transports: [transport] })
    logger.info('test')
    expect(written).toBe(true)
  })

  test('logger with level "info" calls transport for warn', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'info', transports: [transport] })
    logger.warn('test')
    expect(written).toBe(true)
  })

  test('logger with level "info" calls transport for error', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'info', transports: [transport] })
    logger.error('test')
    expect(written).toBe(true)
  })

  test('logger with level "info" does not call transport for debug', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'info', transports: [transport] })
    logger.debug('test')
    expect(written).toBe(false)
  })

  test('logger with level "debug" calls transport for debug', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'debug', transports: [transport] })
    logger.debug('test')
    expect(written).toBe(true)
  })

  test('logger with level "trace" calls transport for trace', () => {
    let written = false
    const transport = { write() { written = true } }
    const logger = new Logger({ level: 'trace', transports: [transport] })
    logger.trace('test')
    expect(written).toBe(true)
  })
})

describe('Logger — child logger', () => {
  test('child inherits level', () => {
    const entries: any[] = []
    const transport = { write(e: any) { entries.push(e) } }
    const parent = new Logger({ level: 'info', transports: [transport] })
    const child = parent.child({ module: 'auth' })
    child.info('test')
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })

  test('child adds extra fields', () => {
    const entries: any[] = []
    const transport = { write(e: any) { entries.push(e) } }
    const parent = new Logger({ level: 'info', transports: [transport] })
    const child = parent.child({ requestId: 'abc' })
    child.info('test')
    expect(entries[0].requestId).toBe('abc')
  })

  test('child does not affect parent', () => {
    const entries: any[] = []
    const transport = { write(e: any) { entries.push(e) } }
    const parent = new Logger({ level: 'info', transports: [transport] })
    parent.child({ extra: true })
    parent.info('parent log')
    expect(entries[0].extra).toBeUndefined()
  })
})

describe('Logger — multiple transports', () => {
  test('write goes to all transports', () => {
    let count1 = 0
    let count2 = 0
    const t1 = { write() { count1++ } }
    const t2 = { write() { count2++ } }
    const logger = new Logger({ level: 'info', transports: [t1, t2] })
    logger.info('test')
    expect(count1).toBe(1)
    expect(count2).toBe(1)
  })

  test('three transports all receive writes', () => {
    let count = 0
    const t = { write() { count++ } }
    const logger = new Logger({ level: 'info', transports: [t, t, t] })
    logger.info('test')
    expect(count).toBe(3)
  })
})
