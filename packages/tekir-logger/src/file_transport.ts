import type { LogTransport, LogEntry } from './types'
import { appendFile, stat, readdir, unlink, rename, mkdir } from 'node:fs/promises'

import { dirname, basename, join, extname } from 'path'

/**
 * Configuration options for the file-based log transport.
 */
export interface FileTransportConfig {
  /** Absolute path to the log file. */
  path: string
  /** Maximum file size in bytes before rotation (default: 10 MB). */
  maxSize?: number
  /** Maximum number of rotated log files to keep (default: 5). */
  maxFiles?: number
  /** String prepended to each serialised log line. */
  prefix?: string
  /** String appended to each serialised log line. */
  suffix?: string
  /**
   * Maximum number of log lines buffered in memory awaiting write (default: 10000).
   * When the queue is full, the oldest lines are dropped to bound memory growth.
   * Set to `0` to disable the bound (unbounded, not recommended).
   */
  maxQueueSize?: number
  /** Invoked when an asynchronous background write fails. */
  onError?: (error: unknown) => void
}

/**
 * Log transport that writes JSON entries to a file with automatic size-based rotation.
 *
 * When the log file exceeds `maxSize`, existing files are rotated (e.g. `app.1.log`, `app.2.log`)
 * and old files beyond `maxFiles` are deleted.
 *
 * Writes are serialised within a single instance. This transport assumes a single
 * writer per file: pointing multiple instances or processes at the same path can
 * race during rotation and lose or overwrite lines.
 */
export class FileTransport implements LogTransport {
  private path: string
  private dir: string
  private baseName: string
  private ext: string
  private maxSize: number
  private maxFiles: number
  private prefix: string
  private suffix: string
  private maxQueueSize: number
  private _writing = false
  private _queue: string[] = []
  private _dropped = 0
  private _errors = 0
  private _onError?: (error: unknown) => void

  /**
   * @param config - File transport configuration including path and rotation settings.
   */
  constructor(config: FileTransportConfig) {
    this.path = config.path
    this.dir = dirname(config.path)
    this.ext = extname(config.path)
    this.baseName = basename(config.path, this.ext)
    this.maxSize = config.maxSize ?? 10 * 1024 * 1024
    this.maxFiles = config.maxFiles ?? 5
    this.prefix = config.prefix ?? ''
    this.suffix = config.suffix ?? ''
    this.maxQueueSize = config.maxQueueSize ?? 10000
    this._onError = config.onError

    this._dirReady = mkdir(this.dir, { recursive: true }).then(() => {}).catch(() => {})
  }

  private _dirReady: Promise<void> = Promise.resolve()

  /**
   * Queue a log entry for writing to the file.
   * @param entry - The structured log entry to write.
   */
  write(entry: LogEntry): void {
    const line = `${this.prefix}${JSON.stringify(entry)}${this.suffix}\n`
    // Bound the in-memory queue: if the disk cannot keep up, drop the oldest
    // lines instead of growing without limit (backpressure / OOM protection).
    if (this.maxQueueSize > 0 && this._queue.length >= this.maxQueueSize) {
      this._queue.shift()
      this._dropped++
    }
    this._queue.push(line)
    // write() is intentionally synchronous, so observe background failures
    // here instead of leaking an unhandled rejected promise to the process.
    void this._flush().catch((error) => this._reportError(error))
  }

  /** Number of log lines dropped so far due to a full queue. */
  get droppedCount(): number {
    return this._dropped
  }

  /** Number of asynchronous file write failures observed by the transport. */
  get errorCount(): number {
    return this._errors
  }

  private _reportError(error: unknown): void {
    this._errors++
    try { this._onError?.(error) } catch {}
  }

  /** Wait for all queued writes to complete */
  async flush(): Promise<void> {
    await this._flush()
    // Wait for any in-progress write
    while (this._writing) await new Promise(r => setTimeout(r, 1))
  }

  private async _flush(): Promise<void> {
    if (this._writing || this._queue.length === 0) return
    this._writing = true
    await this._dirReady
    try {
      while (this._queue.length > 0) {
        const line = this._queue[0]!
        await this._rotateIfNeeded()
        await appendFile(this.path, line)
        this._queue.shift()
      }
    } finally {
      this._writing = false
    }
  }

  private async _rotateIfNeeded(): Promise<void> {
    let size = 0
    try {
      size = (await stat(this.path)).size
    } catch {
      return
    }

    if (size < this.maxSize) return

    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = i === 1
        ? this.path
        : join(this.dir, `${this.baseName}.${i - 1}${this.ext}`)
      const to = join(this.dir, `${this.baseName}.${i}${this.ext}`)
      try { await rename(from, to) } catch {}
    }

    await this._cleanup()
  }

  private async _cleanup(): Promise<void> {
    let files: string[]
    try {
      files = await readdir(this.dir)
    } catch {
      return
    }

    const pattern = new RegExp(
      `^${escapeRegex(this.baseName)}\\.(\\d+)${escapeRegex(this.ext)}$`
    )

    for (const f of files) {
      const match = f.match(pattern)
      if (match && parseInt(match[1], 10) >= this.maxFiles) {
        try { await unlink(join(this.dir, f)) } catch {}
      }
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
