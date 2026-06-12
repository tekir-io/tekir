export type DatadogSite = 'us1' | 'us3' | 'us5' | 'eu' | 'ap1' | 'gov'

export interface DatadogTransportConfig {
  apiKey: string
  site?: DatadogSite
  service?: string
  hostname?: string
  tags?: string
  source?: string
  batchSize?: number
  flushInterval?: number
  /**
   * Maximum number of buffered log entries awaiting flush (default: 10000).
   * When exceeded, the oldest entries are dropped. Set to `0` to disable the bound.
   */
  maxBufferSize?: number
  /** Invoked when a flush fails (network error or non-2xx response). */
  onError?: (err: unknown) => void
}
