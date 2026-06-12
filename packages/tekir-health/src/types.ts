export type CheckStatus = 'ok' | 'warning' | 'error'

export interface HealthCheckResult {
  name: string
  status: CheckStatus
  message: string
  isCached: boolean
  finishedAt: string
  meta?: Record<string, unknown>
}

export interface HealthDebugInfo {
  pid: number
  platform: string
  uptime: number
  version: string
}

export interface HealthReport {
  isHealthy: boolean
  status: CheckStatus
  finishedAt: string
  /**
   * Internal diagnostics (pid/platform/uptime/node version). Only present when
   * the report is run with `{ debug: true }`; omitted by default so a public
   * `/health` endpoint does not leak reconnaissance information.
   */
  debugInfo?: HealthDebugInfo
  checks: HealthCheckResult[]
}

export interface HealthRunOptions {
  /**
   * Include {@link HealthDebugInfo} in the report. Default: false. Enable only
   * for authenticated/internal endpoints.
   */
  debug?: boolean
  /**
   * Per-check timeout in milliseconds. A check that does not resolve within this
   * window is reported as `error` instead of hanging the whole report.
   * Default: 5000.
   */
  timeout?: number
}

export interface HealthDbClient {
  queryOne?(sql: string): unknown
  query?(sql: string): unknown
}

export interface HealthRedisClient {
  connected?: boolean
}

export interface HealthAppContainer {
  use(key: string): unknown
  instance(key: string, value: unknown): void
}
