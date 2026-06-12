export interface JobOptions {
  delay?: number
  queue?: string
  attempts?: number
}

export interface JobRecord {
  id: string
  queue: string
  payload: string
  attempts: number
  maxAttempts: number
  availableAt: number
  createdAt: number
  failedAt?: number
  failedReason?: string
  status: 'pending' | 'processing' | 'failed' | 'completed'
}

export interface QueueBackend {
  push(record: JobRecord): Promise<void>
  pop(queue: string): Promise<JobRecord | null>
  peek(queue: string, count?: number): Promise<JobRecord[]>
  size(queue: string): Promise<number>
  purge(queue: string): Promise<void>
  /**
   * Release a previously-claimed (processing) job back onto the queue for a
   * later retry, persisting its updated `attempts` and `availableAt`. Used by
   * the worker instead of re-pushing, so backends keyed by a unique id (e.g.
   * the database PRIMARY KEY) do not collide on retry.
   */
  requeue(record: JobRecord): Promise<void>
  markFailed(id: string, reason: string, record?: JobRecord): Promise<void>
  markCompleted(id: string): Promise<void>
  getFailed(): Promise<JobRecord[]>
  getById(id: string): Promise<JobRecord | null>
  requeueFailed(id: string): Promise<void>
}

export type WorkerEventName = 'completed' | 'failed' | 'started' | 'stopped'
