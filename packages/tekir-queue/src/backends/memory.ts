import type { QueueBackend, JobRecord } from '../types'

/**
 * In-memory queue backend. Stores all jobs in Maps; data is lost when the
 * process exits. Ideal for development, testing, and single-process deployments.
 *
 * @example
 * ```ts
 * const backend = new MemoryBackend()
 * const queue = new Queue(backend)
 * ```
 */
export class MemoryBackend implements QueueBackend {
  private queues: Map<string, JobRecord[]> = new Map()
  private failed: Map<string, JobRecord> = new Map()
  private completed: Map<string, JobRecord> = new Map()

  private getQueue(name: string): JobRecord[] {
    if (!this.queues.has(name)) this.queues.set(name, [])
    return this.queues.get(name) as JobRecord[]
  }

  /**
   * Push a job record onto the queue.
   *
   * @param record - The job record to enqueue.
   */
  async push(record: JobRecord): Promise<void> {
    this.getQueue(record.queue).push(record)
  }

  /**
   * Release a claimed job back onto its queue for a later retry.
   *
   * The record was already removed from the queue on {@link pop}, so this
   * re-enqueues it with its updated `attempts`/`availableAt`. Any stale copy
   * with the same id is dropped first to avoid duplicates.
   *
   * @param record - The job record to requeue.
   */
  async requeue(record: JobRecord): Promise<void> {
    const q = this.getQueue(record.queue)
    const idx = q.findIndex(r => r.id === record.id)
    if (idx !== -1) q.splice(idx, 1)
    record.status = 'pending'
    q.push(record)
  }

  /**
   * Pop the next available (pending and ready) job from the queue.
   *
   * @param queue - The queue name to pop from.
   * @returns The next job record, or `null` if no jobs are available.
   */
  async pop(queue: string): Promise<JobRecord | null> {
    const q = this.getQueue(queue)
    const now = Date.now()
    const idx = q.findIndex(r => r.status === 'pending' && r.availableAt <= now)
    if (idx === -1) return null
    const [record] = q.splice(idx, 1)
    record.status = 'processing'
    return record
  }

  /**
   * Peek at up to `count` jobs in the queue without removing them.
   *
   * @param queue - The queue name to peek into.
   * @param count - Maximum number of records to return. Defaults to `100`.
   * @returns An array of job records.
   */
  async peek(queue: string, count = 100): Promise<JobRecord[]> {
    return this.getQueue(queue).slice(0, count)
  }

  /**
   * Get the number of pending jobs that are ready to be processed.
   *
   * @param queue - The queue name to count.
   * @returns The number of available pending jobs.
   */
  async size(queue: string): Promise<number> {
    const now = Date.now()
    return this.getQueue(queue).filter(r => r.status === 'pending' && r.availableAt <= now).length
  }

  /**
   * Remove all jobs from a queue.
   *
   * @param queue - The queue name to purge.
   */
  async purge(queue: string): Promise<void> {
    this.queues.set(queue, [])
  }

  /**
   * Mark a job as failed and move it to the failed map.
   *
   * @param id - The job ID.
   * @param reason - A human-readable failure reason.
   * @param record - Optionally the already-popped job record.
   */
  async markFailed(id: string, reason: string, record?: JobRecord): Promise<void> {
    // Search all queues for the record
    for (const q of this.queues.values()) {
      const idx = q.findIndex(r => r.id === id)
      if (idx !== -1) {
        const [rec] = q.splice(idx, 1)
        rec.status = 'failed'
        rec.failedAt = Date.now()
        rec.failedReason = reason
        this.failed.set(id, rec)
        return
      }
    }
    // Record was already popped — use the passed record or check failed map
    if (record) {
      record.status = 'failed'
      record.failedAt = Date.now()
      record.failedReason = reason
      this.failed.set(id, record)
    } else {
      const existing = this.failed.get(id)
      if (existing) {
        existing.status = 'failed'
        existing.failedAt = Date.now()
        existing.failedReason = reason
      }
    }
  }

  /**
   * Mark a job as completed and move it to the completed map.
   *
   * @param id - The job ID.
   */
  async markCompleted(id: string): Promise<void> {
    // Jobs are already removed from queue on pop; just record completion
    for (const q of this.queues.values()) {
      const idx = q.findIndex(r => r.id === id)
      if (idx !== -1) {
        const [record] = q.splice(idx, 1)
        record.status = 'completed'
        this.completed.set(id, record)
        return
      }
    }
  }

  /**
   * Retrieve all failed job records.
   *
   * @returns An array of failed job records.
   */
  async getFailed(): Promise<JobRecord[]> {
    return Array.from(this.failed.values())
  }

  /**
   * Find a job record by its ID across all queues and status maps.
   *
   * @param id - The job ID.
   * @returns The job record if found, or `null`.
   */
  async getById(id: string): Promise<JobRecord | null> {
    for (const q of this.queues.values()) {
      const r = q.find(r => r.id === id)
      if (r) return r
    }
    return this.failed.get(id) ?? this.completed.get(id) ?? null
  }

  /**
   * Requeue a failed job by resetting its status, attempts, and availability.
   *
   * @param id - The ID of the failed job to requeue.
   * @throws Error if no failed job exists with the given ID.
   */
  async requeueFailed(id: string): Promise<void> {
    const record = this.failed.get(id)
    if (!record) throw new Error(`No failed job with id: ${id}`)
    this.failed.delete(id)
    record.status = 'pending'
    record.failedAt = undefined
    record.failedReason = undefined
    record.attempts = 0
    record.availableAt = Date.now()
    this.getQueue(record.queue).push(record)
  }
}
