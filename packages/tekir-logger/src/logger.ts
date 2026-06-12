import type { LogLevel, LoggerConfig, LogEntry, LogTransport } from './types'

export type { LogLevel, LoggerConfig, LogEntry, LogTransport } from './types'

const LEVELS: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
}

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
}

// Strip ANSI escape sequences and control characters (incl. CR/LF) that would
// allow log forging or terminal escape injection when written in pretty mode.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * Remove control characters and ANSI escape sequences from a string so that
 * attacker-controlled values cannot forge log lines or inject terminal escapes.
 * CR and LF are replaced with visible escapes to keep entries on a single line.
 */
export function sanitizeLogString(value: string): string {
  return value
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(CONTROL_PATTERN, '')
}

// Recursively sanitize every string in a value for safe pretty-mode rendering.
function sanitizeDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return sanitizeLogString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map(v => sanitizeDeep(v, seen))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[sanitizeLogString(key)] = sanitizeDeep((value as Record<string, unknown>)[key], seen)
  }
  return out
}

/**
 * Built-in console transport that writes log entries to `stdout`.
 *
 * In pretty mode (default in non-production), output is colourised and human-readable.
 * Otherwise, entries are serialised as single-line JSON.
 */
export class ConsoleTransport implements LogTransport {
  private pretty: boolean

  /**
   * @param pretty - Enable human-readable coloured output. Defaults to `true` outside production.
   *   Prefer passing this explicitly: the `NODE_ENV` fallback is read at runtime and may be
   *   inlined at build time (e.g. `bun build --compile`), yielding the wrong mode in binaries.
   */
  constructor(pretty?: boolean) {
    this.pretty = pretty ?? (process.env.NODE_ENV !== 'production')
  }

  /**
   * Write a log entry to the console.
   * @param entry - The structured log entry to output.
   */
  write(entry: LogEntry): void {
    if (this.pretty) {
      const color = { trace: '90', debug: '36', info: '32', warn: '33', error: '31', fatal: '35' }[entry.level]
      const ts = entry.time ? `\x1b[90m${new Date(entry.time).toISOString()}\x1b[0m ` : ''
      const { level: _l, msg, time: _t, name: _n, ...rest } = entry
      // Sanitize attacker-controllable fields to prevent CRLF/ANSI log injection.
      const safeRest = sanitizeDeep(rest) as Record<string, unknown>
      const safeMsg = typeof msg === 'string' ? sanitizeLogString(msg) : (msg ?? '')
      const extra = Object.keys(safeRest).length ? ` ${JSON.stringify(safeRest)}` : ''
      console.log(`${ts}\x1b[${color}m${entry.level.toUpperCase().padEnd(5)}\x1b[0m ${safeMsg}${extra}`)
    } else {
      console.log(JSON.stringify(entry))
    }
  }
}

/**
 * Structured logger with support for multiple transports, log levels,
 * child loggers, and field redaction.
 *
 * @example
 * ```ts
 * const logger = new Logger({ level: 'debug', name: 'api' })
 * logger.info('Server started', { port: 3000 })
 * logger.child({ requestId: '...' }).debug('handling request')
 * ```
 */
export class Logger {
  private level: number
  private enabled: boolean
  private name: string
  private timestamp: boolean
  private redact: Set<string>
  private context: Record<string, unknown> = {}
  private transports: LogTransport[]

  /**
   * Create a new Logger instance.
   * @param config - Logger configuration including level, transports, redaction, etc.
   */
  constructor(config: LoggerConfig = {}) {
    this.level = LEVELS[config.level || 'info']
    this.enabled = config.enabled ?? true
    this.name = config.name || 'app'
    this.timestamp = config.timestamp ?? true
    this.redact = new Set(config.redact || [])

    if (config.transports && config.transports.length > 0) {
      this.transports = config.transports
    } else {
      this.transports = [new ConsoleTransport(config.pretty)]
    }
  }

  /**
   * Add a transport to the logger at runtime.
   * @param transport - The transport to add.
   * @returns The logger instance for chaining.
   */
  addTransport(transport: LogTransport): this {
    this.transports.push(transport)
    return this
  }

  /**
   * Remove a previously added transport.
   * @param transport - The transport instance to remove.
   * @returns The logger instance for chaining.
   */
  removeTransport(transport: LogTransport): this {
    const idx = this.transports.indexOf(transport)
    if (idx !== -1) this.transports.splice(idx, 1)
    return this
  }

  /**
   * Create a child logger that inherits this logger's configuration and transports
   * but merges additional context fields into every log entry.
   * @param context - Key-value pairs to include in all child log entries.
   * @returns A new Logger instance with the merged context.
   */
  child(context: Record<string, unknown>): Logger {
    const child = new Logger({
      level: LEVEL_NAMES[this.level] ?? 'info',
      enabled: this.enabled,
      name: this.name,
      timestamp: this.timestamp,
      redact: [...this.redact],
      transports: this.transports,
    })
    child.context = { ...this.context, ...context }
    return child
  }

  /** Log a message at the `trace` level. */
  trace(msgOrObj: unknown, ...args: unknown[]) { this._log('trace', msgOrObj, args) }
  /** Log a message at the `debug` level. */
  debug(msgOrObj: unknown, ...args: unknown[]) { this._log('debug', msgOrObj, args) }
  /** Log a message at the `info` level. */
  info(msgOrObj: unknown, ...args: unknown[]) { this._log('info', msgOrObj, args) }
  /** Log a message at the `warn` level. */
  warn(msgOrObj: unknown, ...args: unknown[]) { this._log('warn', msgOrObj, args) }
  /** Log a message at the `error` level. */
  error(msgOrObj: unknown, ...args: unknown[]) { this._log('error', msgOrObj, args) }
  /** Log a message at the `fatal` level. */
  fatal(msgOrObj: unknown, ...args: unknown[]) { this._log('fatal', msgOrObj, args) }

  /**
   * Check whether a given log level is enabled for this logger.
   * @param level - The log level to check.
   * @returns `true` if messages at this level would be written.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.enabled && LEVELS[level] >= this.level
  }

  private _log(level: LogLevel, msgOrObj: unknown, args: unknown[]) {
    if (!this.enabled || LEVELS[level] < this.level) return

    let obj: Record<string, unknown> = {}
    let msg = ''

    if (typeof msgOrObj === 'string') {
      msg = msgOrObj
      if (args[0] && typeof args[0] === 'object') obj = args[0] as Record<string, unknown>
    } else if (typeof msgOrObj === 'object' && msgOrObj !== null) {
      obj = msgOrObj as Record<string, unknown>
      if (typeof args[0] === 'string') msg = args[0]
    }

    // Merge context + per-call fields, then redact deeply (nested paths, context).
    const merged: Record<string, unknown> = { ...this.context, ...obj }
    const redacted = this.redact.size > 0
      ? (this._redactDeep(merged) as Record<string, unknown>)
      : merged

    const entry: LogEntry = {
      level,
      ...redacted,
      ...(msg ? { msg } : {}),
      ...(this.timestamp ? { time: Date.now() } : {}),
      name: this.name,
    }

    for (const transport of this.transports) {
      transport.write(entry)
    }
  }

  // Recursively replace values of any redacted key, at any depth, with [REDACTED].
  private _redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value as object)) return '[Circular]'
    seen.add(value as object)

    if (Array.isArray(value)) {
      return value.map(v => this._redactDeep(v, seen))
    }

    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src)) {
      out[key] = this.redact.has(key)
        ? '[REDACTED]'
        : this._redactDeep(src[key], seen)
    }
    return out
  }
}

/**
 * Factory function to create a new {@link Logger} instance.
 * @param config - Optional logger configuration.
 * @returns A configured Logger instance.
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new Logger(config)
}
