import type { HealthCheckResult } from '../types'
import { Result } from '../result'

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(ms|s|m|h|min|hour|minute|second)?/i)
  if (!match) return 0
  const num = parseInt(match[1])
  const unit = (match[2] || 'ms').toLowerCase()
  if (unit === 'h' || unit === 'hour') return num * 3600000
  if (unit === 'm' || unit === 'min' || unit === 'minute') return num * 60000
  if (unit === 's' || unit === 'second') return num * 1000
  return num
}

/**
 * Abstract base class for health checks. Subclasses must implement `name` and `run()`.
 *
 * @example
 * ```ts
 * class DiskCheck extends BaseCheck {
 *   name = 'disk'
 *   run() {
 *     const free = getFreeSpace()
 *     return free > 1_000_000 ? Result.ok() : Result.warning('Low disk')
 *   }
 * }
 * ```
 */
export abstract class BaseCheck {
  abstract name: string
  private _cacheMs = 0
  private _cachedResult: HealthCheckResult | null = null
  private _cachedAt = 0

  /**
   * Execute the health check logic. Must be implemented by subclasses.
   * @returns {Promise<Result> | Result} The health check result
   */
  abstract run(): Promise<Result> | Result

  /**
   * Cache this check's result for the given duration.
   * @param {string | number} duration - Duration in ms (number) or human-readable string (e.g. '30s', '5m')
   * @returns {this} The check instance for chaining
   *
   * @example
   * ```ts
   * new DbCheck(db).cacheFor('30s')
   * ```
   */
  cacheFor(duration: string | number): this {
    this._cacheMs = typeof duration === 'number' ? duration : parseDuration(duration)
    return this
  }

  /**
   * Execute the check, returning a cached result if available and still valid.
   * @returns {Promise<HealthCheckResult>} The health check result with metadata
   */
  async execute(): Promise<HealthCheckResult> {
    if (this._cacheMs > 0 && this._cachedResult && Date.now() - this._cachedAt < this._cacheMs) {
      return { ...this._cachedResult, isCached: true }
    }

    const result = await this.run()
    const checkResult: HealthCheckResult = {
      name: this.name,
      status: result.status,
      message: result.message,
      isCached: false,
      finishedAt: new Date().toISOString(),
      meta: Object.keys(result.meta).length > 0 ? result.meta : undefined,
    }

    if (this._cacheMs > 0) {
      this._cachedResult = checkResult
      this._cachedAt = Date.now()
    }

    return checkResult
  }
}
