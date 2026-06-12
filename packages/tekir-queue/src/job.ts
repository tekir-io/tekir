// BaseJob

/**
 * Abstract base class for all queue jobs. Subclasses must implement the
 * {@link handle} method which contains the job's processing logic.
 *
 * @example
 * ```ts
 * class SendEmailJob extends BaseJob {
 *   constructor(public to: string, public subject: string) { super() }
 *   async handle() {
 *     await mailer.send({ to: this.to, subject: this.subject })
 *   }
 * }
 * ```
 */
export abstract class BaseJob {
  /**
   * Execute the job's logic. Called by the worker when the job is dequeued.
   *
   * @returns A promise that resolves when the job completes successfully.
   */
  abstract handle(): Promise<void>

  /**
   * Serialize the job instance to a JSON string, including the class name
   * so the worker can reconstruct it on the other side.
   *
   * @returns A JSON string representation of the job, prefixed with `__class`.
   *
   * @example
   * ```ts
   * const job = new SendEmailJob('a@b.com', 'Hi')
   * job.serialize() // '{"__class":"SendEmailJob","to":"a@b.com","subject":"Hi"}'
   * ```
   */
  serialize(): string {
    return JSON.stringify({
      __class: this.constructor.name,
      ...this,
    })
  }
}

// Helpers

/**
 * Generate a unique job identifier using the current timestamp and a random suffix.
 *
 * @returns A string in the format `<timestamp>-<random>`.
 *
 * @example
 * ```ts
 * generateId() // "1713000000000-a1b2c3d4"
 * ```
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

import type { JobOptions, JobRecord } from './types'

/**
 * Build a {@link JobRecord} from a job instance and optional dispatch options.
 *
 * @param job - The job instance to convert into a record.
 * @param options - Optional configuration such as queue name, delay, and max attempts.
 * @returns A fully-populated {@link JobRecord} ready to be pushed to a backend.
 *
 * @example
 * ```ts
 * const record = buildRecord(new SendEmailJob('a@b.com', 'Hi'), { queue: 'emails', attempts: 3 })
 * ```
 */
export function buildRecord(job: BaseJob, options: JobOptions = {}): JobRecord {
  const now = Date.now()
  return {
    id: generateId(),
    queue: options.queue ?? 'default',
    payload: job.serialize(),
    attempts: 0,
    maxAttempts: options.attempts ?? 1,
    availableAt: now + (options.delay ?? 0),
    createdAt: now,
    status: 'pending',
  }
}
