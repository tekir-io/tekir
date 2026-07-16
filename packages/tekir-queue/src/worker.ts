import { EventEmitter } from 'events'
export type { WorkerEventName } from './types'
import type { QueueBackend, JobRecord } from './types'
import { BaseJob } from './job'

// Worker

/**
 * Error raised when a job can never succeed (malformed payload or no registered
 * class). The worker fails these jobs immediately rather than retrying, so a
 * poison job cannot loop forever and block the queue.
 */
class NonRetryableError extends Error {}

/**
 * Queue worker that polls a backend for jobs, processes them with configurable
 * concurrency, and handles retries with exponential backoff.
 *
 * @example
 * ```ts
 * const worker = queue.worker('emails')
 * worker.concurrency(4).pollInterval(1000).start()
 * await worker.stop()
 * ```
 */
export class Worker extends EventEmitter {
  private _concurrency: number = 1
  private _running: number = 0
  private _active: boolean = false
  private _pollInterval: number = 500
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _stopWaiters: Array<() => void> = []
  private _jobRegistry: Map<string, new (...args: unknown[]) => BaseJob>

  /**
   * Create a new Worker.
   *
   * @param backend - The queue backend used for fetching and updating jobs.
   * @param queueName - The name of the queue this worker processes.
   * @param emitter - An EventEmitter for broadcasting lifecycle events.
   * @param jobRegistry - A map of class names to constructors for deserializing jobs.
   */
  constructor(
    private backend: QueueBackend,
    private queueName: string,
    private emitter: EventEmitter,
    jobRegistry: Map<string, new (...args: unknown[]) => BaseJob>,
  ) {
    super()
    this._jobRegistry = jobRegistry
  }

  /**
   * Set the maximum number of jobs to process concurrently.
   *
   * @param n - The concurrency limit.
   * @returns This worker instance for chaining.
   *
   * @example
   * ```ts
   * worker.concurrency(4)
   * ```
   */
  concurrency(n: number): this {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`concurrency must be a positive integer, got ${n}`)
    }
    this._concurrency = n
    return this
  }

  /**
   * Set the interval between backend polling ticks.
   *
   * @param ms - The polling interval in milliseconds.
   * @returns This worker instance for chaining.
   *
   * @example
   * ```ts
   * worker.pollInterval(2000) // poll every 2 seconds
   * ```
   */
  pollInterval(ms: number): this {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`pollInterval must be a non-negative number, got ${ms}`)
    }
    this._pollInterval = ms
    return this
  }

  /**
   * Start the worker. It will begin polling the backend for pending jobs.
   * If already active, this is a no-op.
   *
   * @returns This worker instance for chaining.
   *
   * @example
   * ```ts
   * worker.start()
   * ```
   */
  start(): this {
    if (this._active) return this
    this._active = true
    this.emitter.emit('started', { queue: this.queueName })
    this.schedule()
    return this
  }

  /**
   * Stop the worker gracefully. No new jobs will be picked up, and the
   * returned promise resolves once all in-flight jobs have completed.
   *
   * @returns A promise that resolves when the worker has fully stopped.
   *
   * @example
   * ```ts
   * await worker.stop()
   * ```
   */
  stop(): Promise<void> {
    this._active = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._running === 0) {
      this.emitter.emit('stopped', { queue: this.queueName })
      return Promise.resolve()
    }
    return new Promise(resolve => { this._stopWaiters.push(resolve) })
  }

  private schedule(): void {
    if (!this._active) return
    this._timer = setTimeout(() => {
      // A backend outage must not turn into an unhandled rejection and
      // permanently kill polling. tick() owns rescheduling in its finally.
      void this.tick()
    }, this._pollInterval)
  }

  private async tick(): Promise<void> {
    if (!this._active) return
    try {
      while (this._active && this._running < this._concurrency) {
        const record = await this.backend.pop(this.queueName)
        if (!record) break
        this._running++
        void this.process(record).catch(async (err: unknown) => {
          // Infrastructure errors (for example Redis dropping while marking a
          // result) escape process(). Best-effort release prevents memory
          // backends from losing the already-popped record.
          try { await this.backend.requeue(record) } catch {}
          this.emitter.emit('workerError', { queue: this.queueName, id: record.id, error: err })
        }).finally(() => {
          this._running--
          if (!this._active && this._running === 0) this.finishStop()
        })
      }
    } catch (err: unknown) {
      this.emitter.emit('workerError', { queue: this.queueName, error: err })
    } finally {
      this.schedule()
    }
  }

  private finishStop(): void {
    this.emitter.emit('stopped', { queue: this.queueName })
    const waiters = this._stopWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  private async process(record: JobRecord): Promise<void> {
    record.attempts++

    try {
      const job = this.deserialize(record.payload)
      await job.handle()
      await this.backend.markCompleted(record.id, record)
      this.emitter.emit('completed', { id: record.id, queue: record.queue, payload: record.payload })
    } catch (err: unknown) {
      const reason = (err instanceof Error ? err.message : null) ?? String(err)
      // Poison jobs (bad payload / unregistered class) can never succeed — fail
      // them immediately instead of retrying in an endless back-off loop.
      const retryable = !(err instanceof NonRetryableError)
      if (retryable && record.attempts < record.maxAttempts) {
        // Release the claimed record back to pending with exponential back-off.
        // Uses requeue (UPDATE) rather than push (INSERT) so persistent backends
        // do not collide on the existing primary key.
        record.status = 'pending'
        record.availableAt = Date.now() + Math.pow(2, record.attempts) * 1000
        await this.backend.requeue(record)
      } else {
        await this.backend.markFailed(record.id, reason, record)
        this.emitter.emit('failed', { id: record.id, queue: record.queue, reason, payload: record.payload })
      }
    }
  }

  private deserialize(payload: string): BaseJob {
    let data: any
    try {
      data = JSON.parse(payload)
    } catch {
      throw new NonRetryableError('Job payload is not valid JSON')
    }
    const { __class, __proto__: _a, constructor: _b, prototype: _c, ...props } = data
    const safeProps = Object.fromEntries(
      Object.entries(props).filter(([k]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
    )
    const Ctor = this._jobRegistry.get(__class)
    if (!Ctor) {
      throw new NonRetryableError(`No job class registered for "${__class}"`)
    }
    const instance = Object.create(Ctor.prototype)
    Object.assign(instance, safeProps)
    return instance
  }
}
