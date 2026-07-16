import { Result } from '../result'
import { BaseCheck } from './base'

function parseBytes(value: number | string): number {
  if (typeof value === 'number') return value
  const match = value.match(/^(\d+)\s*(mb|gb|kb)?$/i)
  if (!match) return 0
  const num = parseInt(match[1])
  const unit = (match[2] || '').toLowerCase()
  if (unit === 'gb') return num * 1024 * 1024 * 1024
  if (unit === 'mb') return num * 1024 * 1024
  if (unit === 'kb') return num * 1024
  return num
}

/**
 * Health check that monitors V8 heap memory usage against configurable thresholds.
 *
 * @example
 * ```ts
 * health.register(
 *   new MemoryHeapCheck().warnWhenExceeds('200mb').failWhenExceeds('300mb')
 * )
 * ```
 */
export class MemoryHeapCheck extends BaseCheck {
  name = 'memory:heap'
  private _warn = 250 * 1024 * 1024
  private _fail = 300 * 1024 * 1024

  /**
   * Set the warning threshold for heap usage.
   * @param {number | string} bytes - Threshold in bytes or human-readable string (e.g. '250mb')
   * @returns {this} The check instance for chaining
   */
  warnWhenExceeds(bytes: number | string): this { this._warn = parseBytes(bytes); return this }

  /**
   * Set the failure threshold for heap usage.
   * @param {number | string} bytes - Threshold in bytes or human-readable string (e.g. '300mb')
   * @returns {this} The check instance for chaining
   */
  failWhenExceeds(bytes: number | string): this { this._fail = parseBytes(bytes); return this }

  /**
   * Run the heap memory check.
   * @returns {Result} Ok, warning, or failed based on current heap usage
   */
  run(): Result {
    const { heapUsed } = process.memoryUsage()
    // Bun can report a sub-megabyte heap for small processes. Integer
    // rounding turned a real positive measurement into the misleading 0MB.
    const mb = Math.round((heapUsed / 1024 / 1024) * 100) / 100
    if (heapUsed > this._fail) return Result.failed(`Heap ${mb}MB exceeds limit`).mergeMetaData({ heapMB: mb })
    if (heapUsed > this._warn) return Result.warning(`Heap ${mb}MB above threshold`).mergeMetaData({ heapMB: mb })
    return Result.ok(`Heap ${mb}MB`).mergeMetaData({ heapMB: mb })
  }
}

/**
 * Health check that monitors RSS (Resident Set Size) memory usage against configurable thresholds.
 *
 * @example
 * ```ts
 * health.register(
 *   new MemoryRSSCheck().warnWhenExceeds('300mb').failWhenExceeds('350mb')
 * )
 * ```
 */
export class MemoryRSSCheck extends BaseCheck {
  name = 'memory:rss'
  private _warn = 320 * 1024 * 1024
  private _fail = 350 * 1024 * 1024

  /**
   * Set the warning threshold for RSS usage.
   * @param {number | string} bytes - Threshold in bytes or human-readable string (e.g. '320mb')
   * @returns {this} The check instance for chaining
   */
  warnWhenExceeds(bytes: number | string): this { this._warn = parseBytes(bytes); return this }

  /**
   * Set the failure threshold for RSS usage.
   * @param {number | string} bytes - Threshold in bytes or human-readable string (e.g. '350mb')
   * @returns {this} The check instance for chaining
   */
  failWhenExceeds(bytes: number | string): this { this._fail = parseBytes(bytes); return this }

  /**
   * Run the RSS memory check.
   * @returns {Result} Ok, warning, or failed based on current RSS usage
   */
  run(): Result {
    const { rss } = process.memoryUsage()
    const mb = Math.round((rss / 1024 / 1024) * 100) / 100
    if (rss > this._fail) return Result.failed(`RSS ${mb}MB exceeds limit`).mergeMetaData({ rssMB: mb })
    if (rss > this._warn) return Result.warning(`RSS ${mb}MB above threshold`).mergeMetaData({ rssMB: mb })
    return Result.ok(`RSS ${mb}MB`).mergeMetaData({ rssMB: mb })
  }
}
