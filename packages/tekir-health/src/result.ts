import type { CheckStatus } from './types'

/**
 * Represents the outcome of a health check with status, message, and optional metadata.
 *
 * @example
 * ```ts
 * return Result.ok('Database connected').mergeMetaData({ latency: 12 })
 * return Result.warning('High memory usage')
 * return Result.failed('Redis disconnected')
 * ```
 */
export class Result {
  status: CheckStatus
  message: string
  meta: Record<string, unknown> = {}

  private constructor(status: CheckStatus, message: string) {
    this.status = status
    this.message = message
  }

  /**
   * Create a healthy result.
   * @param {string} [message='Healthy'] - Success message
   * @returns {Result} An ok result
   */
  static ok(message = 'Healthy'): Result { return new Result('ok', message) }

  /**
   * Create a warning result.
   * @param {string} message - Warning message
   * @returns {Result} A warning result
   */
  static warning(message: string): Result { return new Result('warning', message) }

  /**
   * Create a failed/error result.
   * @param {string} message - Error message
   * @returns {Result} A failed result
   */
  static failed(message: string): Result { return new Result('error', message) }

  /**
   * Merge additional metadata into the result.
   * @param {Record<string, unknown>} data - Key-value metadata to merge
   * @returns {this} The result instance for chaining
   */
  mergeMetaData(data: Record<string, unknown>): this { Object.assign(this.meta, data); return this }
}
