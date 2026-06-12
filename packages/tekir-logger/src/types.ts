/** Severity levels for log entries, ordered from least to most severe. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** A structured log entry emitted by the logger and consumed by transports. */
export interface LogEntry {
  /** Severity level of the entry. */
  level: LogLevel
  /** Human-readable log message. */
  msg?: string
  /** Unix epoch timestamp in milliseconds. */
  time?: number
  /** Logger name (e.g. `'app'`). */
  name: string
  /** Additional context fields. */
  [key: string]: unknown
}

/**
 * Interface that all log transports must implement.
 * A transport receives structured log entries and writes them to a destination.
 */
export interface LogTransport {
  /**
   * Write a log entry to the transport's destination.
   * @param entry - The structured log entry.
   */
  write(entry: LogEntry): void | Promise<void>
}

/** Configuration options for creating a {@link Logger} instance. */
export interface LoggerConfig {
  /** Minimum log level to emit (default: `'info'`). */
  level?: LogLevel
  /** Whether the logger is enabled (default: `true`). */
  enabled?: boolean
  /** Logger name included in every entry (default: `'app'`). */
  name?: string
  /** Whether to include a timestamp in entries (default: `true`). */
  timestamp?: boolean
  /** Enable human-readable coloured output for the default console transport. */
  pretty?: boolean
  /** Field names whose values should be replaced with `'[REDACTED]'`. */
  redact?: string[]
  /** Custom transports to use instead of the default console transport. */
  transports?: LogTransport[]
  /** Named channel definitions for the provider-based configuration. */
  channels?: Record<string, any>
}
