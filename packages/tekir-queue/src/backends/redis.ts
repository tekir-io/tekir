import type { QueueBackend, JobRecord } from '../types'

// Redis backend -- uses @tekir/redis

/** Minimal interface matching @tekir/redis's Redis class. */
interface TekirRedis {
  send(command: string, args?: string[]): Promise<any>
  keyName?(key: string): string
  /**
   * Optional server-side script evaluation. Provided by clients that expose a
   * raw command path; when absent we fall back to `send('EVAL', ...)`.
   */
  eval?(script: string, numKeys: number, ...args: string[]): Promise<any>
}

/**
 * After a job is claimed it must finish (or be released) within this window.
 * If a worker crashes mid-job the id sits in the processing list with an
 * expired lease and is moved back to pending by {@link RedisBackend.pop}'s
 * recovery pass, so the job is not lost forever.
 */
const VISIBILITY_TIMEOUT_MS = 60_000

/**
 * Atomically claim one ready job: pop an id from the pending list, push it onto
 * the per-queue processing list, then stamp the stored record with a claim
 * token + reserved_at. Doing the pop and the record update inside a single
 * server-side script removes the BRPOP->GET gap, so a crash can never leave an
 * id that has been removed from the queue but not marked processing.
 *
 * KEYS[1] = pending list, KEYS[2] = processing list
 * ARGV[1] = record-key prefix, ARGV[2] = claim token, ARGV[3] = now (ms)
 * Returns the updated record JSON, or false when nothing is ready.
 */
const CLAIM_SCRIPT = `
local id = redis.call('RPOPLPUSH', KEYS[1], KEYS[2])
if not id then return false end
local rk = ARGV[1] .. id
local raw = redis.call('GET', rk)
if not raw then
  redis.call('LREM', KEYS[2], 1, id)
  return false
end
local rec = cjson.decode(raw)
rec['status'] = 'processing'
rec['claimToken'] = ARGV[2]
rec['reservedAt'] = tonumber(ARGV[3])
local out = cjson.encode(rec)
redis.call('SET', rk, out)
return out
`

/** Atomically release a processing job to pending or delayed. */
const REQUEUE_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('LREM', KEYS[2], 0, ARGV[2])
if tonumber(ARGV[3]) <= tonumber(ARGV[4]) then
  redis.call('LPUSH', KEYS[3], ARGV[2])
else
  redis.call('ZADD', KEYS[4], ARGV[3], ARGV[2])
end
return 1
`

/** Atomically promote one due delayed job into its owning queue. */
const PROMOTE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
local rec = cjson.decode(raw)
if rec['queue'] ~= ARGV[2] then return 0 end
local score = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[3]) then return 0 end
if redis.call('ZREM', KEYS[2], ARGV[1]) == 1 then
  redis.call('LPUSH', KEYS[3], ARGV[1])
  return 1
end
return 0
`

/**
 * Reclaim a single leased-but-expired job. Removes its id from the processing
 * list and pushes it back onto pending, clearing the claim token. The LREM
 * guards against another worker having already reclaimed or completed it.
 *
 * KEYS[1] = processing list, KEYS[2] = pending list
 * ARGV[1] = record-key prefix, ARGV[2] = id
 * Returns 1 when the job was requeued, 0 otherwise.
 */
const RECOVER_ONE_SCRIPT = `
local removed = redis.call('LREM', KEYS[1], 1, ARGV[2])
if removed == 0 then return 0 end
local rk = ARGV[1] .. ARGV[2]
local raw = redis.call('GET', rk)
if raw then
  local rec = cjson.decode(raw)
  rec['status'] = 'pending'
  rec['claimToken'] = nil
  rec['reservedAt'] = nil
  redis.call('SET', rk, cjson.encode(rec))
end
redis.call('LPUSH', KEYS[2], ARGV[2])
return 1
`

/**
 * Redis-backed queue backend. Uses Redis lists for queues and sorted sets
 * for delayed jobs. Suitable for distributed, multi-process deployments.
 *
 * @example
 * ```ts
 * const backend = await RedisBackend.connect({ url: 'redis://localhost:6379' })
 * const queue = new Queue(backend)
 * ```
 */
export class RedisBackend implements QueueBackend {
  private redis: TekirRedis

  /**
   * Create a new RedisBackend.
   *
   * @param redis - A Redis client implementing the {@link TekirRedis} interface.
   */
  constructor(redis: TekirRedis) {
    this.redis = redis
  }

  private redisKey(key: string): string {
    return this.redis.keyName ? this.redis.keyName(key) : key
  }

  private queueKey(queue: string): string {
    return this.redisKey(`tekir:queue:${queue}`)
  }

  private processingKey(queue: string): string {
    return this.redisKey(`tekir:queue:processing:${queue}`)
  }

  private recordKey(id: string): string {
    return `${this.recordPrefix}${id}`
  }

  private get recordPrefix(): string { return this.redisKey('tekir:queue:record:') }
  private get failedKey(): string { return this.redisKey('tekir:queue:failed') }
  private get delayedKey(): string { return this.redisKey('tekir:queue:delayed') }

  // Queue lists and Lua scripts necessarily use Redis' raw command namespace.
  // Keep records in that same namespace; mixing prefix-aware get/set with raw
  // list keys breaks claims whenever the shared @tekir/redis client has a prefix.
  private async rawGet(key: string): Promise<string | null> {
    return this.redis.send('GET', [key])
  }

  private async rawSet(key: string, value: string): Promise<void> {
    await this.redis.send('SET', [key, value])
  }

  private async rawDel(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.send('DEL', keys)
  }

  /**
   * Run a Lua script server-side. Uses the client's native `eval` helper when
   * available, otherwise the raw `EVAL` command path. Keeping this here means
   * the rest of the backend never reaches for `send('EVAL', ...)` directly.
   */
  private async _eval(script: string, keys: string[], args: string[]): Promise<any> {
    if (typeof this.redis.eval === 'function') {
      return this.redis.eval(script, keys.length, ...keys, ...args)
    }
    return this.redis.send('EVAL', [script, String(keys.length), ...keys, ...args])
  }

  /**
   * Push a job record into Redis. Immediate jobs go to the queue list;
   * delayed jobs go to the `tekir:queue:delayed` sorted set.
   *
   * @param record - The job record to enqueue.
   */
  async push(record: JobRecord): Promise<void> {
    await this.rawSet(this.recordKey(record.id), JSON.stringify(record))
    if (record.availableAt <= Date.now()) {
      await this.redis.send('LPUSH', [this.queueKey(record.queue), record.id])
    } else {
      await this.redis.send('ZADD', [this.delayedKey, String(record.availableAt), record.id])
    }
  }

  /**
   * Pop the next available job from the queue, promoting any delayed jobs first.
   *
   * @param queue - The queue name to pop from.
   * @returns The next job record, or `null` if none are available.
   */
  async pop(queue: string): Promise<JobRecord | null> {
    await this._recoverExpired(queue)
    await this.promoteDelayed(queue)

    // Atomic claim: a single Lua script pops one id from the pending list,
    // pushes it onto the processing list, and stamps the record with a claim
    // token + reserved_at. There is no BRPOP->GET gap, so two workers can never
    // both claim the same job and a crash can never strand an id mid-move.
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const out = await this._eval(
      CLAIM_SCRIPT,
      [this.queueKey(queue), this.processingKey(queue)],
      [this.recordPrefix, token, String(Date.now())]
    )
    if (!out || typeof out !== 'string') return null
    return JSON.parse(out) as JobRecord
  }

  /**
   * Reclaim jobs whose worker crashed mid-processing. Each id in the processing
   * list whose record lease has expired is atomically moved back to pending.
   */
  private async _recoverExpired(queue: string): Promise<void> {
    const ids: string[] = await this.redis.send('LRANGE', [this.processingKey(queue), '0', '-1']) || []
    if (!ids.length) return
    const cutoff = Date.now() - VISIBILITY_TIMEOUT_MS
    for (const id of ids) {
      const raw = await this.rawGet(this.recordKey(id))
      if (!raw) continue
      const record: JobRecord = JSON.parse(raw)
      const reservedAt = (record as any).reservedAt as number | undefined
      if (typeof reservedAt === 'number' && reservedAt <= cutoff) {
        await this._eval(
          RECOVER_ONE_SCRIPT,
          [this.processingKey(queue), this.queueKey(queue)],
          [this.recordPrefix, id]
        )
      }
    }
  }

  /**
   * Release a claimed job back to its queue for a later retry, persisting the
   * updated `attempts`/`availableAt`. Updates the stored record in place rather
   * than pushing a new one, avoiding duplicate records keyed by the same id.
   *
   * @param record - The job record to requeue.
   */
  async requeue(record: JobRecord): Promise<void> {
    record.status = 'pending'
    delete (record as any).claimToken
    delete (record as any).reservedAt
    await this._eval(
      REQUEUE_SCRIPT,
      [this.recordKey(record.id), this.processingKey(record.queue), this.queueKey(record.queue), this.delayedKey],
      [JSON.stringify(record), record.id, String(record.availableAt), String(Date.now())],
    )
  }

  private async promoteDelayed(queue: string): Promise<void> {
    const now = String(Date.now())
    const ids: string[] = await this.redis.send('ZRANGEBYSCORE', [this.delayedKey, '0', now]) || []
    for (const id of ids) {
      await this._eval(
        PROMOTE_SCRIPT,
        [this.recordKey(id), this.delayedKey, this.queueKey(queue)],
        [id, queue, now],
      )
    }
  }

  /**
   * Peek at up to `count` jobs in the queue without removing them.
   *
   * @param queue - The queue name.
   * @param count - Maximum number of records to return. Defaults to `100`.
   * @returns An array of job records.
   */
  async peek(queue: string, count = 100): Promise<JobRecord[]> {
    const ids: string[] = await this.redis.send('LRANGE', [this.queueKey(queue), '0', String(count - 1)]) || []
    const records: JobRecord[] = []
    for (const id of ids) {
      const raw = await this.rawGet(this.recordKey(id))
      if (raw) records.push(JSON.parse(raw))
    }
    return records
  }

  /**
   * Get the length of the queue list in Redis.
   *
   * @param queue - The queue name.
   * @returns The number of jobs in the queue.
   */
  async size(queue: string): Promise<number> {
    return (await this.redis.send('LLEN', [this.queueKey(queue)])) || 0
  }

  /**
   * Delete the entire queue list from Redis.
   *
   * @param queue - The queue name to purge.
   */
  async purge(queue: string): Promise<void> {
    await this.rawDel(this.queueKey(queue), this.processingKey(queue))
  }

  /**
   * Mark a job as failed and add it to the failed list.
   *
   * @param id - The job ID.
   * @param reason - A human-readable failure reason.
   */
  async markFailed(id: string, reason: string, failedRecord?: JobRecord): Promise<void> {
    const raw = await this.rawGet(this.recordKey(id))
    // Prefer the live record passed by the worker so its incremented attempts
    // count is persisted; fall back to the stored copy.
    const record: JobRecord | null = failedRecord ?? (raw ? JSON.parse(raw) : null)
    if (!record) return
    record.status = 'failed'
    record.failedAt = Date.now()
    record.failedReason = reason
    delete (record as any).claimToken
    delete (record as any).reservedAt
    await this.rawSet(this.recordKey(id), JSON.stringify(record))
    // Release the claim so a crashed-worker recovery pass won't requeue it.
    await this.redis.send('LREM', [this.processingKey(record.queue), '0', id])
    await this.redis.send('LPUSH', [this.failedKey, id])
  }

  /**
   * Mark a job as completed.
   *
   * @param id - The job ID.
   */
  async markCompleted(id: string, _completedRecord?: JobRecord): Promise<void> {
    const raw = await this.rawGet(this.recordKey(id))
    if (!raw) return
    const record: JobRecord = JSON.parse(raw)
    record.status = 'completed'
    delete (record as any).claimToken
    delete (record as any).reservedAt
    await this.rawSet(this.recordKey(id), JSON.stringify(record))
    // Remove the now-finished claim from the processing list.
    await this.redis.send('LREM', [this.processingKey(record.queue), '0', id])
  }

  /**
   * Retrieve all failed job records from the failed list.
   *
   * @returns An array of failed job records.
   */
  async getFailed(): Promise<JobRecord[]> {
    const ids: string[] = await this.redis.send('LRANGE', [this.failedKey, '0', '-1']) || []
    const records: JobRecord[] = []
    for (const id of ids) {
      const raw = await this.rawGet(this.recordKey(id))
      if (raw) records.push(JSON.parse(raw))
    }
    return records
  }

  /**
   * Find a job record by its ID.
   *
   * @param id - The job ID.
   * @returns The job record if found, or `null`.
   */
  async getById(id: string): Promise<JobRecord | null> {
    const raw = await this.rawGet(this.recordKey(id))
    return raw ? JSON.parse(raw) : null
  }

  /**
   * Requeue a failed job by resetting its status and moving it back to the queue list.
   *
   * @param id - The ID of the failed job to requeue.
   * @throws Error if no job exists with the given ID.
   */
  async requeueFailed(id: string): Promise<void> {
    const raw = await this.rawGet(this.recordKey(id))
    if (!raw) throw new Error(`No job with id: ${id}`)
    const record: JobRecord = JSON.parse(raw)
    record.status = 'pending'
    record.failedAt = undefined
    record.failedReason = undefined
    record.attempts = 0
    record.availableAt = Date.now()
    await this.rawSet(this.recordKey(id), JSON.stringify(record))
    await this.redis.send('LREM', [this.failedKey, '1', id])
    await this.redis.send('LPUSH', [this.queueKey(record.queue), id])
  }

  /**
   * Static factory that creates a RedisBackend by dynamically importing `@tekir/redis`.
   *
   * @param options - Redis connection options (e.g. `{ url: 'redis://localhost:6379' }`).
   * @returns A promise that resolves to a connected RedisBackend.
   * @throws Error if `@tekir/redis` is not installed.
   *
   * @example
   * ```ts
   * const backend = await RedisBackend.connect({ url: 'redis://localhost:6379' })
   * ```
   */
  static async connect(options: { url?: string; [key: string]: unknown } = {}): Promise<RedisBackend> {
    let Redis: any
    try {
      // @ts-ignore optional peer; resolved at runtime.
      Redis = (await import('@tekir/redis')).Redis
    } catch {
      throw new Error(
        '[@tekir/queue] Redis backend requires @tekir/redis. Run: bun add @tekir/redis'
      )
    }
    const client = new Redis(options)
    return new RedisBackend(client)
  }
}
