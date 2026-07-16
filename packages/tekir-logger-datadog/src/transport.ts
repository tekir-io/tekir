import type { LogTransport, LogEntry } from '@tekir/logger'
import type { DatadogTransportConfig, DatadogSite } from './types'

const SITE_URLS: Record<DatadogSite, string> = {
  us1: 'https://http-intake.logs.datadoghq.com',
  us3: 'https://http-intake.logs.us3.datadoghq.com',
  us5: 'https://http-intake.logs.us5.datadoghq.com',
  eu: 'https://http-intake.logs.datadoghq.eu',
  ap1: 'https://http-intake.logs.ap1.datadoghq.com',
  gov: 'https://http-intake.logs.ddog-gov.com',
}

export class DatadogTransport implements LogTransport {
  private config: DatadogTransportConfig
  private url: string
  private buffer: Record<string, unknown>[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private maxBufferSize: number
  private _dropped = 0
  private _errors = 0
  private _onError?: (err: unknown) => void

  constructor(config: DatadogTransportConfig) {
    this.config = config
    const base = SITE_URLS[config.site ?? 'us1']
    this.url = `${base}/api/v2/logs`

    this.maxBufferSize = config.maxBufferSize ?? 10000
    this._onError = config.onError

    const interval = config.flushInterval ?? 5000
    if (interval > 0) {
      this.timer = setInterval(() => this.flush(), interval)
      // Do not keep the process alive solely for the flush timer.
      ;(this.timer as { unref?: () => void }).unref?.()
    }
  }

  write(entry: LogEntry): void {
    const { level, msg, time, name, ...rest } = entry

    const ddEntry: Record<string, unknown> = {
      ...rest,
      message: msg ?? JSON.stringify(rest),
      status: level,
      service: this.config.service ?? name,
    }

    if (this.config.hostname) ddEntry.hostname = this.config.hostname
    if (this.config.tags) ddEntry.ddtags = this.config.tags
    if (this.config.source) ddEntry.ddsource = this.config.source
    if (time !== undefined) ddEntry.timestamp = new Date(time).toISOString()

    this.buffer.push(ddEntry)

    // Bound the buffer so a stalled/disabled flush cannot grow memory without limit.
    if (this.maxBufferSize > 0 && this.buffer.length > this.maxBufferSize) {
      this.buffer.shift()
      this._dropped++
    }

    const batchSize = this.config.batchSize ?? 50
    if (this.buffer.length >= batchSize) {
      this.flush()
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0)

    fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.config.apiKey,
      },
      body: JSON.stringify(batch),
    })
      .then(res => {
        // Surface non-2xx (e.g. 403 invalid API key) instead of dropping silently.
        if (!res.ok) this._reportError(new Error(`[datadog] intake failed: HTTP ${res.status}`))
      })
      .catch(err => this._reportError(err))
  }

  private _reportError(err: unknown): void {
    this._errors++
    if (this._onError) {
      try { this._onError(err) } catch {}
    }
  }

  /** Number of log entries dropped due to a full buffer. */
  get droppedCount(): number {
    return this._dropped
  }

  /** Number of failed flush attempts (network error or non-2xx response). */
  get errorCount(): number {
    return this._errors
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flush()
  }
}
