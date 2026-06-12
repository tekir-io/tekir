import type { LogTransport, LogEntry, LogLevel } from '@tekir/logger'
import type { PinoTransportConfig, PinoLike } from './types'

const PINO_LEVELS: Record<LogLevel, string> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
}

export class PinoTransport implements LogTransport {
  private pino: PinoLike

  constructor(config: PinoTransportConfig) {
    this.pino = config.pino
  }

  write(entry: LogEntry): void {
    const { level, msg, time: _t, name: _n, ...rest } = entry
    // Map to a pino method, falling back to info for unknown levels. Verify the
    // method exists (custom pino setups may omit one) before calling it.
    let method = PINO_LEVELS[level] ?? 'info'
    if (typeof this.pino[method] !== 'function') {
      method = typeof this.pino.info === 'function' ? 'info' : method
      if (typeof this.pino[method] !== 'function') return
    }

    const fn = this.pino[method] as (obj: unknown, msg?: string) => void
    if (Object.keys(rest).length > 0) {
      fn.call(this.pino, rest, msg ?? '')
    } else {
      fn.call(this.pino, msg ?? '')
    }
  }
}
