import type { QueueBackend, JobRecord } from '../types'

// Database backend -- uses @tekir/db

/** Minimal interface matching @tekir/db's Database class. */
interface DatabaseClient {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): unknown
  queryOne<T = any>(sql: string, params?: unknown[]): T | null
  query<T = any>(sql: string, params?: unknown[]): T[]
}

interface DbRow {
  id: string
  queue: string
  payload: string
  attempts: number
  max_attempts: number
  available_at: number
  created_at: number
  failed_at?: number | null
  failed_reason?: string | null
  status: string
  claim_token?: string | null
  reserved_at?: number | null
  cnt?: number
}

/**
 * After a job is claimed it must finish (or be released) within this window.
 * If a worker crashes mid-job the stuck `processing` row is reclaimed once the
 * lease expires, so the job is not lost forever.
 */
const VISIBILITY_TIMEOUT_MS = 60_000

/**
 * SQL database-backed queue backend. Persists jobs in a `jobs` table and
 * creates the table automatically on first use.
 *
 * @example
 * ```ts
 * const backend = new DatabaseBackend(db)
 * const queue = new Queue(backend)
 * ```
 */
export class DatabaseBackend implements QueueBackend {
  private db: DatabaseClient

  private _ready = false

  /**
   * Create a new DatabaseBackend.
   *
   * @param db - A database client that implements the {@link DatabaseClient} interface.
   */
  constructor(db: DatabaseClient) {
    this.db = db
  }

  private async _ensureTable(): Promise<void> {
    if (this._ready) return
    this._ready = true
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL DEFAULT 'default',
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        available_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        failed_at INTEGER,
        failed_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        claim_token TEXT,
        reserved_at INTEGER
      )
    `)
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs (queue, status, available_at)`)
  }

  /**
   * Insert a job record into the database.
   *
   * @param record - The job record to persist.
   */
  async push(record: JobRecord): Promise<void> {
    await this._ensureTable()
    await this.db.run(
      `INSERT INTO jobs (id, queue, payload, attempts, max_attempts, available_at, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.queue, record.payload, record.attempts, record.maxAttempts, record.availableAt, record.createdAt, record.status]
    )
  }

  /**
   * Pop the next pending job whose `available_at` has passed, marking it as processing.
   *
   * @param queue - The queue name to pop from.
   * @returns The next available job record, or `null`.
   */
  async pop(queue: string): Promise<JobRecord | null> {
    await this._ensureTable()
    const now = Date.now()
    await this._recoverExpired(queue, now)

    // Atomic claim: a unique token is stamped onto exactly one ready row via a
    // conditional UPDATE, then the row is read back by that token. Because the
    // UPDATE only matches rows still in 'pending' status, two concurrent
    // workers can never both claim the same job — the second update matches no
    // rows and that worker simply finds nothing to read back.
    const token = `${now}-${Math.random().toString(36).slice(2)}`
    await this.db.run(
      `UPDATE jobs SET status = 'processing', claim_token = ?, reserved_at = ?
       WHERE id = (
         SELECT id FROM jobs
         WHERE queue = ? AND status = 'pending' AND available_at <= ?
         ORDER BY available_at ASC LIMIT 1
       )`,
      [token, now, queue, now]
    )
    const row = await this.db.queryOne<DbRow>(
      `SELECT * FROM jobs WHERE claim_token = ? LIMIT 1`,
      [token]
    )
    if (!row) return null
    const record = this.rowToRecord(row)
    record.status = 'processing'
    return record
  }

  /**
   * Reclaim jobs whose worker crashed mid-processing. A `processing` row whose
   * lease has expired is reset to `pending` so it becomes poppable again.
   */
  private async _recoverExpired(queue: string, now: number): Promise<void> {
    await this.db.run(
      `UPDATE jobs SET status = 'pending', claim_token = NULL, reserved_at = NULL
       WHERE queue = ? AND status = 'processing' AND reserved_at IS NOT NULL AND reserved_at <= ?`,
      [queue, now - VISIBILITY_TIMEOUT_MS]
    )
  }

  /**
   * Release a claimed job back to pending for a later retry, persisting its
   * updated `attempts` and `availableAt`. Updates the existing row instead of
   * inserting, so the PRIMARY KEY never collides on retry.
   *
   * @param record - The job record to requeue.
   */
  async requeue(record: JobRecord): Promise<void> {
    await this._ensureTable()
    await this.db.run(
      `UPDATE jobs SET status = 'pending', attempts = ?, available_at = ?, claim_token = NULL, reserved_at = NULL,
        failed_at = NULL, failed_reason = NULL WHERE id = ?`,
      [record.attempts, record.availableAt, record.id]
    )
  }

  /**
   * Peek at up to `count` jobs in the queue without modifying them.
   *
   * @param queue - The queue name.
   * @param count - Maximum number of records to return. Defaults to `100`.
   * @returns An array of job records.
   */
  async peek(queue: string, count = 100): Promise<JobRecord[]> {
    await this._ensureTable()
    const rows = await this.db.query<DbRow>(`SELECT * FROM jobs WHERE queue = ? LIMIT ?`, [queue, count])
    return rows.map(r => this.rowToRecord(r))
  }

  /**
   * Count the number of pending jobs that are ready to be processed.
   *
   * @param queue - The queue name.
   * @returns The number of available pending jobs.
   */
  async size(queue: string): Promise<number> {
    await this._ensureTable()
    const now = Date.now()
    const row = await this.db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jobs WHERE queue = ? AND status = 'pending' AND available_at <= ?`,
      [queue, now]
    )
    return row?.cnt ?? 0
  }

  /**
   * Delete all jobs in a queue.
   *
   * @param queue - The queue name to purge.
   */
  async purge(queue: string): Promise<void> {
    await this._ensureTable()
    await this.db.run(`DELETE FROM jobs WHERE queue = ?`, [queue])
  }

  /**
   * Mark a job as failed with a timestamp and reason.
   *
   * @param id - The job ID.
   * @param reason - A human-readable failure reason.
   */
  async markFailed(id: string, reason: string, record?: JobRecord): Promise<void> {
    await this._ensureTable()
    if (record) {
      // Persist the worker's incremented attempts count alongside the failure.
      await this.db.run(
        `UPDATE jobs SET status = 'failed', failed_at = ?, failed_reason = ?, attempts = ?, claim_token = NULL, reserved_at = NULL WHERE id = ?`,
        [Date.now(), reason, record.attempts, id]
      )
      return
    }
    await this.db.run(
      `UPDATE jobs SET status = 'failed', failed_at = ?, failed_reason = ?, claim_token = NULL, reserved_at = NULL WHERE id = ?`,
      [Date.now(), reason, id]
    )
  }

  /**
   * Mark a job as completed.
   *
   * @param id - The job ID.
   */
  async markCompleted(id: string, _record?: JobRecord): Promise<void> {
    await this._ensureTable()
    await this.db.run(`UPDATE jobs SET status = 'completed', claim_token = NULL, reserved_at = NULL WHERE id = ?`, [id])
  }

  /**
   * Retrieve all failed job records from the database.
   *
   * @returns An array of failed job records.
   */
  async getFailed(): Promise<JobRecord[]> {
    await this._ensureTable()
    const rows = await this.db.query<DbRow>(`SELECT * FROM jobs WHERE status = 'failed'`)
    return rows.map(r => this.rowToRecord(r))
  }

  /**
   * Find a job record by its ID.
   *
   * @param id - The job ID.
   * @returns The job record if found, or `null`.
   */
  async getById(id: string): Promise<JobRecord | null> {
    await this._ensureTable()
    const row = await this.db.queryOne<DbRow>(`SELECT * FROM jobs WHERE id = ?`, [id])
    return row ? this.rowToRecord(row) : null
  }

  /**
   * Requeue a failed job by resetting its status, attempts, and failure metadata.
   *
   * @param id - The ID of the failed job to requeue.
   * @throws Error if no job exists with the given ID.
   */
  async requeueFailed(id: string): Promise<void> {
    await this._ensureTable()
    const row = await this.db.queryOne<DbRow>(`SELECT * FROM jobs WHERE id = ?`, [id])
    if (!row) throw new Error(`No job with id: ${id}`)
    await this.db.run(
      `UPDATE jobs SET status = 'pending', failed_at = NULL, failed_reason = NULL, attempts = 0, available_at = ?, claim_token = NULL, reserved_at = NULL WHERE id = ?`,
      [Date.now(), id]
    )
  }

  private rowToRecord(row: DbRow): JobRecord {
    return {
      id: row.id,
      queue: row.queue,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      createdAt: row.created_at,
      failedAt: row.failed_at ?? undefined,
      failedReason: row.failed_reason ?? undefined,
      status: row.status as 'pending' | 'processing' | 'failed' | 'completed',
    }
  }
}
