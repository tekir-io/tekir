import type { LogTransport, LogEntry } from '@tekir/logger'
import type { LokiTransportConfig } from './types'

// Hostnames and IP literals that point at the local host or cloud metadata
// services. Sending logs (potentially sensitive) to these is almost always SSRF.
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254', // AWS / GCP / Azure metadata
  'metadata.google.internal',
])

// Match private / loopback / link-local IPv4 ranges that should not be targeted
// unless the caller explicitly opts in via `allowInsecureHost`.
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * Validate the configured Loki URL to mitigate SSRF and credential leakage.
 * Throws when the URL targets an internal/metadata host (unless explicitly
 * allowed) or sends Basic auth over a plaintext `http://` connection.
 */
function validateUrl(rawUrl: string, config: LokiTransportConfig): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`[loki] invalid url: ${rawUrl}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`[loki] unsupported url scheme: ${url.protocol}`)
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const allowInsecure = config.allowInsecureHost === true

  if (!allowInsecure && (BLOCKED_HOSTS.has(host) || isPrivateIpv4(host))) {
    throw new Error(
      `[loki] refusing to target internal/metadata host "${host}". ` +
      `Set allowInsecureHost: true to override.`
    )
  }

  // Basic auth over plaintext http leaks credentials; only base64-encoded, not encrypted.
  if (config.auth && url.protocol === 'http:' && !allowInsecure) {
    throw new Error(
      '[loki] refusing to send Basic auth over plaintext http. ' +
      'Use https, or set allowInsecureHost: true to override.'
    )
  }

  return url
}

export class LokiTransport implements LogTransport {
  private config: LokiTransportConfig
  private url: string
  private buffer: [string, string][] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private maxBufferSize: number
  private _dropped = 0
  private _errors = 0
  private _onError?: (err: unknown) => void

  constructor(config: LokiTransportConfig) {
    this.config = config
    const parsed = validateUrl(config.url, config)
    const base = parsed.toString().replace(/\/$/, '')
    this.url = `${base}/loki/api/v1/push`

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
    // Loki timestamps are nanoseconds as strings
    const ns = entry.time
      ? `${entry.time}000000`
      : `${Date.now()}000000`

    const line = JSON.stringify(entry)
    this.buffer.push([ns, line])

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

    const values = this.buffer.splice(0)

    const labels: Record<string, string> = {
      app: 'tekir',
      ...this.config.labels,
    }

    const body = {
      streams: [{
        stream: labels,
        values,
      }],
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.config.auth) {
      const encoded = Buffer.from(
        `${this.config.auth.username}:${this.config.auth.password}`,
        'utf8',
      ).toString('base64')
      headers['Authorization'] = `Basic ${encoded}`
    }

    if (this.config.tenantId) {
      headers['X-Scope-OrgID'] = this.config.tenantId
    }

    fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
      .then(res => {
        if (!res.ok) this._reportError(new Error(`[loki] push failed: HTTP ${res.status}`))
      })
      .catch(err => this._reportError(err))
  }

  private _reportError(err: unknown): void {
    this._errors++
    if (this._onError) {
      try { this._onError(err) } catch {}
    }
  }

  /** Number of log lines dropped due to a full buffer. */
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
