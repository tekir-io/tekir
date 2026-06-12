import { Result } from '../result'
import { BaseCheck } from './base'
import type { HealthRedisClient } from '../types'

/**
 * Health check that verifies Redis connectivity.
 *
 * @example
 * ```ts
 * health.register(new RedisCheck(redisClient))
 * health.register(new RedisCheck(cacheClient, 'cache'))
 * ```
 */
export class RedisCheck extends BaseCheck {
  name = 'redis'

  /**
   * @param {HealthRedisClient} redis - The Redis client to check
   * @param {string} [connectionName] - Optional connection name for the check label
   */
  constructor(private redis: HealthRedisClient, connectionName?: string) {
    super()
    if (connectionName) this.name = `redis:${connectionName}`
  }

  /**
   * Run the Redis connectivity check.
   * @returns {Promise<Result>} Ok if connected, failed if disconnected or errored
   */
  async run(): Promise<Result> {
    try {
      if (this.redis.connected === false) return Result.failed('Disconnected')
      return Result.ok('Connected')
    } catch (e: unknown) {
      // Keep infrastructure detail out of the (possibly public) report.
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[@tekir/health] ${this.name} check failed: ${detail}`)
      return Result.failed('Connection failed')
    }
  }
}
