import type { HealthCheckResult, HealthReport, HealthRunOptions } from './types'
import { BaseCheck } from './checks/base'

/**
 * Health check manager that runs registered checks and produces a report.
 *
 * @example
 * ```ts
 * const health = new Health()
 * health.register([new DbCheck(db), new MemoryHeapCheck()])
 * const report = await health.run()
 * console.log(report.isHealthy) // true or false
 * ```
 */
export class Health {
  private checks: BaseCheck[] = []

  /**
   * Register one or more health checks.
   * @param {BaseCheck | BaseCheck[]} checks - A single check or array of checks to register
   * @returns {this} The Health instance for chaining
   */
  register(checks: BaseCheck | BaseCheck[]): this {
    const arr = Array.isArray(checks) ? checks : [checks]
    this.checks.push(...arr)
    return this
  }

  /**
   * Whether any checks have been registered.
   * @returns {boolean} true if at least one check is registered.
   */
  hasChecks(): boolean {
    return this.checks.length > 0
  }

  /**
   * Run all registered health checks in parallel and produce a report.
   *
   * Each check is bounded by a timeout so a hung dependency cannot block the
   * whole report, and failures are isolated (a check that throws becomes an
   * `error` result rather than rejecting the report). Internal `debugInfo` is
   * omitted unless `{ debug: true }` is passed.
   *
   * @param options - {@link HealthRunOptions} controlling debug info and timeout.
   * @returns {Promise<HealthReport>} The aggregated health report.
   */
  async run(options: HealthRunOptions = {}): Promise<HealthReport> {
    const timeout = options.timeout ?? 5000
    const settled = await Promise.allSettled(
      this.checks.map(c => this._runWithTimeout(c, timeout))
    )
    const results: HealthCheckResult[] = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value
      // A check threw outside its own try/catch: isolate it as an error result.
      const name = this.checks[i]?.name ?? 'unknown'
      console.error(`[@tekir/health] Check "${name}" threw: ${s.reason}`)
      return {
        name,
        status: 'error',
        message: 'Check failed',
        isCached: false,
        finishedAt: new Date().toISOString(),
      }
    })

    const hasError = results.some(r => r.status === 'error')
    const hasWarning = results.some(r => r.status === 'warning')

    const report: HealthReport = {
      isHealthy: !hasError,
      status: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
      finishedAt: new Date().toISOString(),
      checks: results,
    }

    if (options.debug) {
      report.debugInfo = {
        pid: process.pid,
        platform: process.platform,
        uptime: Math.round(process.uptime()),
        version: process.version,
      }
    }

    return report
  }

  /** Run a check but report a timeout as an `error` result rather than hanging. */
  private async _runWithTimeout(check: BaseCheck, timeoutMs: number): Promise<HealthCheckResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<HealthCheckResult>(resolve => {
      timer = setTimeout(() => resolve({
        name: check.name,
        status: 'error',
        message: `Timed out after ${timeoutMs}ms`,
        isCached: false,
        finishedAt: new Date().toISOString(),
      }), timeoutMs)
    })
    try {
      return await Promise.race([check.execute(), timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
