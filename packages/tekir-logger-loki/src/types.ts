export interface LokiTransportConfig {
  url: string
  labels?: Record<string, string>
  auth?: {
    username: string
    password: string
  }
  tenantId?: string
  batchSize?: number
  flushInterval?: number
  /**
   * Maximum number of buffered log lines awaiting flush (default: 10000).
   * When exceeded, the oldest lines are dropped. Set to `0` to disable the bound.
   */
  maxBufferSize?: number
  /**
   * Allow targeting loopback/private/metadata hosts and sending Basic auth over
   * plaintext http. Off by default to mitigate SSRF and credential leakage.
   * Enable only for trusted local/dev Loki instances.
   */
  allowInsecureHost?: boolean
  /** Invoked when a flush fails (network error or non-2xx response). */
  onError?: (err: unknown) => void
}
