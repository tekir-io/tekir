import { Result } from '../result'
import { BaseCheck } from './base'
import type { HealthDbClient } from '../types'

/**
 * Health check that verifies database connectivity by executing a simple query.
 *
 * @example
 * ```ts
 * health.register(new DbCheck(db))
 * health.register(new DbCheck(replicaDb, 'replica'))
 * ```
 */
export class DbCheck extends BaseCheck {
  name = 'database'

  /**
   * @param {HealthDbClient} db - The database client to check
   * @param {string} [connectionName] - Optional connection name for the check label
   */
  constructor(private db: HealthDbClient, connectionName?: string) {
    super()
    if (connectionName) this.name = `database:${connectionName}`
  }

  /**
   * Run the database connectivity check.
   * @returns {Promise<Result>} Ok if connected, failed with error message otherwise
   */
  async run(): Promise<Result> {
    try {
      if (this.db.queryOne) await this.db.queryOne('SELECT 1')
      else if (this.db.query) await this.db.query('SELECT 1')
      return Result.ok('Connected')
    } catch (e: unknown) {
      // Don't leak driver error details (host/port/user/schema/paths) into the
      // report, which may be served publicly. Log the detail, return generic.
      const detail = e instanceof Error ? e.message : String(e)
      console.error(`[@tekir/health] ${this.name} check failed: ${detail}`)
      return Result.failed('Connection failed')
    }
  }
}
