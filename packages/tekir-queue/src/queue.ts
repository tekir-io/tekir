import { EventEmitter } from 'events'
import type { QueueBackend, JobOptions, JobRecord } from './types'
import { BaseJob, buildRecord } from './job'
import { MemoryBackend } from './backends/memory'
import { DatabaseBackend } from './backends/database'
import { Worker } from './worker'

// Queue

/**
 * Central queue manager that dispatches jobs, creates workers, and
 * provides inspection helpers (size, failed, find, retry).
 *
 * @example
 * ```ts
 * const queue = createQueue()
 * queue.register(SendEmailJob)
 * await queue.dispatch(new SendEmailJob('a@b.com'))
 * queue.worker('default').concurrency(2).start()
 * ```
 */
export class Queue extends EventEmitter {
  private backend: QueueBackend
  private workers: Map<string, Worker> = new Map()
  private jobRegistry: Map<string, new (...args: unknown[]) => BaseJob> = new Map()

  /**
   * Create a new Queue instance.
   *
   * @param backend - The queue backend to use. Defaults to {@link MemoryBackend}.
   */
  constructor(backend?: QueueBackend) {
    super()
    this.backend = backend ?? new MemoryBackend()
  }

  /**
   * Register a job class so workers can deserialize it when processing.
   *
   * @param jobClass - The job class constructor to register.
   * @returns This queue instance for chaining.
   *
   * @example
   * ```ts
   * queue.register(SendEmailJob).register(GenerateReportJob)
   * ```
   */
  register(jobClass: new (...args: any[]) => BaseJob): this {
    this.jobRegistry.set(jobClass.name, jobClass)
    return this
  }

  /**
   * Dispatch a single job onto the queue.
   *
   * @param job - The job instance to dispatch.
   * @param options - Optional dispatch configuration (queue name, delay, attempts).
   * @returns The created {@link JobRecord}.
   *
   * @example
   * ```ts
   * const record = await queue.dispatch(new SendEmailJob('a@b.com'), { queue: 'emails', attempts: 3 })
   * ```
   */
  async dispatch(job: BaseJob, options: JobOptions = {}): Promise<JobRecord> {
    const record = buildRecord(job, options)
    await this.backend.push(record)
    return record
  }

  /**
   * Dispatch multiple jobs onto the queue in parallel.
   *
   * @param jobs - An array of job instances to dispatch.
   * @param options - Optional dispatch configuration applied to all jobs.
   * @returns An array of created {@link JobRecord} objects.
   *
   * @example
   * ```ts
   * await queue.bulk([new JobA(), new JobB()], { queue: 'batch' })
   * ```
   */
  async bulk(jobs: BaseJob[], options: JobOptions = {}): Promise<JobRecord[]> {
    const records = await Promise.all(jobs.map(j => this.dispatch(j, options)))
    return records
  }

  /**
   * Get or create a worker for a named queue. Workers are cached per queue name.
   *
   * @param queueName - The queue to process. Defaults to `'default'`.
   * @returns The {@link Worker} instance for the given queue.
   *
   * @example
   * ```ts
   * queue.worker('emails').concurrency(4).start()
   * ```
   */
  worker(queueName: string = 'default'): Worker {
    if (!this.workers.has(queueName)) {
      const w = new Worker(this.backend, queueName, this, this.jobRegistry)
      this.workers.set(queueName, w)
    }
    return this.workers.get(queueName) as Worker
  }

  /**
   * Remove all pending jobs from a queue.
   *
   * @param queueName - The queue to purge. Defaults to `'default'`.
   *
   * @example
   * ```ts
   * await queue.purge('emails')
   * ```
   */
  async purge(queueName: string = 'default'): Promise<void> {
    await this.backend.purge(queueName)
  }

  /**
   * Get the number of pending (ready-to-process) jobs in a queue.
   *
   * @param queueName - The queue to inspect. Defaults to `'default'`.
   * @returns The count of pending jobs.
   *
   * @example
   * ```ts
   * const count = await queue.size('emails')
   * ```
   */
  async size(queueName: string = 'default'): Promise<number> {
    return this.backend.size(queueName)
  }

  /**
   * Retrieve all failed jobs across all queues.
   *
   * @returns An array of failed {@link JobRecord} objects.
   */
  async failed(): Promise<JobRecord[]> {
    return this.backend.getFailed()
  }

  /**
   * Requeue a failed job by its ID, resetting its attempts and status to pending.
   *
   * @param jobId - The ID of the failed job to retry.
   *
   * @example
   * ```ts
   * await queue.retry('1713000000000-a1b2c3d4')
   * ```
   */
  async retry(jobId: string): Promise<void> {
    await this.backend.requeueFailed(jobId)
  }

  /**
   * Find a job by its ID.
   *
   * @param jobId - The ID of the job to look up.
   * @returns The {@link JobRecord} if found, or `null`.
   */
  async find(jobId: string): Promise<JobRecord | null> {
    return this.backend.getById(jobId)
  }

  /**
   * Stop all active workers gracefully, waiting for in-flight jobs to complete.
   *
   * @returns A promise that resolves when all workers have stopped.
   */
  async stop(): Promise<void> {
    await Promise.all(Array.from(this.workers.values()).map(w => w.stop()))
  }

  /**
   * Swap the underlying backend at runtime. Useful for testing or
   * hot-swapping from memory to a persistent store.
   *
   * @param backend - The new backend to use.
   * @returns This queue instance for chaining.
   *
   * @example
   * ```ts
   * queue.useBackend(new MemoryBackend())
   * ```
   */
  useBackend(backend: QueueBackend): this {
    this.backend = backend
    return this
  }
}

/**
 * Create a new {@link Queue} with the given backend.
 *
 * @param backend - The queue backend to use. Defaults to {@link MemoryBackend}.
 * @returns A new Queue instance.
 *
 * @example
 * ```ts
 * const queue = createQueue()
 * ```
 */
export function createQueue(backend?: QueueBackend): Queue {
  return new Queue(backend)
}

/**
 * Create a new {@link Queue} backed by Redis. Dynamically imports the Redis backend.
 *
 * @param options - Redis connection options (e.g. `{ url: 'redis://localhost:6379' }`).
 * @returns A promise that resolves to a Queue backed by Redis.
 *
 * @example
 * ```ts
 * const queue = await createRedisQueue({ url: 'redis://localhost:6379' })
 * ```
 */
export async function createRedisQueue(options: { url?: string; [key: string]: unknown } = {}): Promise<Queue> {
  const { RedisBackend } = await import('./backends/redis')
  return new Queue(await RedisBackend.connect(options))
}

/**
 * Create a new {@link Queue} backed by a SQL database.
 *
 * @param db - A database client compatible with the DatabaseBackend interface.
 * @returns A new Queue backed by the database.
 *
 * @example
 * ```ts
 * const queue = createDatabaseQueue(db)
 * ```
 */
export function createDatabaseQueue(db: any): Queue {
  return new Queue(new DatabaseBackend(db))
}
