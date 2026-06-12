import { test, expect, describe } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import {
  Queue,
  BaseJob,
  MemoryBackend,
  DatabaseBackend,
  type JobRecord,
} from '../src/index'

function createTestDb() {
  const sqlite = new BunSQLite(':memory:')
  return {
    exec(sql: string) { sqlite.exec(sql) },
    run(sql: string, params?: any[]) { sqlite.prepare(sql).run(...(params || [])) },
    queryOne<T = any>(sql: string, params?: any[]): T | null {
      return (sqlite.prepare(sql).get(...(params || [])) as T) ?? null
    },
    query<T = any>(sql: string, params?: any[]): T[] {
      return sqlite.prepare(sql).all(...(params || [])) as T[]
    },
  }
}

function record(over: Partial<JobRecord> = {}): JobRecord {
  const now = Date.now() - 1
  return {
    id: 'j1', queue: 'default', payload: '{}', attempts: 0,
    maxAttempts: 1, availableAt: now, createdAt: now, status: 'pending', ...over,
  }
}

// DatabaseBackend.pop — atomic claim, no double processing

describe('DatabaseBackend — atomic pop', () => {
  test('two concurrent pops never claim the same job', async () => {
    const db = createTestDb()
    const backend = new DatabaseBackend(db)
    await backend.push(record({ id: 'only-one' }))

    // Race two pops on the same single job.
    const [a, b] = await Promise.all([backend.pop('default'), backend.pop('default')])
    const claimed = [a, b].filter(r => r !== null)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.id).toBe('only-one')
    expect(claimed[0]!.status).toBe('processing')
  })

  test('each of N jobs is claimed exactly once under concurrent pops', async () => {
    const db = createTestDb()
    const backend = new DatabaseBackend(db)
    for (let i = 0; i < 5; i++) await backend.push(record({ id: `c-${i}` }))

    const results = await Promise.all(
      Array.from({ length: 10 }, () => backend.pop('default'))
    )
    const ids = results.filter(r => r !== null).map(r => r!.id)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5) // no duplicates
  })
})

// DatabaseBackend.requeue — retry without PRIMARY KEY collision

describe('DatabaseBackend — requeue (retry path)', () => {
  test('requeue updates the existing row without inserting a duplicate', async () => {
    const db = createTestDb()
    const backend = new DatabaseBackend(db)
    await backend.push(record({ id: 'retry-1', maxAttempts: 3 }))

    const claimed = await backend.pop('default')
    expect(claimed!.id).toBe('retry-1')

    // Simulate the worker incrementing attempts and releasing for retry.
    claimed!.attempts = 1
    claimed!.availableAt = Date.now() - 1
    await expect(backend.requeue(claimed!)).resolves.toBeUndefined()

    // Still exactly one row, attempts persisted, poppable again.
    const all = await backend.peek('default', 100)
    expect(all).toHaveLength(1)
    const again = await backend.pop('default')
    expect(again!.id).toBe('retry-1')
    expect(again!.attempts).toBe(1)
  })

  test('markFailed persists the incremented attempts count', async () => {
    const db = createTestDb()
    const backend = new DatabaseBackend(db)
    await backend.push(record({ id: 'mf-attempts', maxAttempts: 1 }))
    const claimed = await backend.pop('default')
    claimed!.attempts = 1
    await backend.markFailed('mf-attempts', 'boom', claimed!)
    const failed = await backend.getFailed()
    expect(failed[0].attempts).toBe(1)
  })
})

// Crash recovery — stuck processing jobs are reclaimed after the lease expires

describe('DatabaseBackend — crash recovery', () => {
  test('a processing job with an expired lease becomes poppable again', async () => {
    const db = createTestDb()
    const backend = new DatabaseBackend(db)
    await backend.push(record({ id: 'stuck' }))
    await backend.pop('default') // now 'processing'
    expect(await backend.pop('default')).toBeNull() // not available while processing

    // Force the reserved_at far into the past to simulate a crashed worker.
    db.run(`UPDATE jobs SET reserved_at = ? WHERE id = ?`, [Date.now() - 10 * 60_000, 'stuck'])

    const recovered = await backend.pop('default')
    expect(recovered).not.toBeNull()
    expect(recovered!.id).toBe('stuck')
  })
})

// Worker validation

describe('Worker — input validation', () => {
  test('concurrency rejects 0 and negative values', () => {
    const queue = new Queue(new MemoryBackend())
    const worker = queue.worker('default')
    expect(() => worker.concurrency(0)).toThrow('positive integer')
    expect(() => worker.concurrency(-1)).toThrow('positive integer')
    expect(() => worker.concurrency(1.5)).toThrow('positive integer')
  })

  test('pollInterval rejects negative and NaN', () => {
    const queue = new Queue(new MemoryBackend())
    const worker = queue.worker('default')
    expect(() => worker.pollInterval(-100)).toThrow('non-negative')
    expect(() => worker.pollInterval(NaN)).toThrow('non-negative')
  })

  test('valid values are accepted and chainable', () => {
    const queue = new Queue(new MemoryBackend())
    const worker = queue.worker('default')
    expect(worker.concurrency(4).pollInterval(250)).toBe(worker)
  })
})

// Poison jobs — unregistered / malformed payloads fail immediately, no retry loop

class RetryEcho extends BaseJob {
  async handle(): Promise<void> { /* succeeds */ }
}

describe('Worker — poison job handling', () => {
  async function drain(queue: Queue, ms = 40): Promise<void> {
    return new Promise<void>((resolve) => {
      const worker = queue.worker('default').pollInterval(ms).start()
      setTimeout(async () => { await worker.stop(); resolve() }, ms * 12)
    })
  }

  test('unregistered job class fails permanently even with retries left', async () => {
    const backend = new MemoryBackend()
    const queue = new Queue(backend)
    // Register nothing — RetryEcho is unknown to the worker.
    const failed: Array<{ reason: string }> = []
    queue.on('failed', (e: { reason: string }) => failed.push(e))

    await queue.dispatch(new RetryEcho(), { attempts: 5 })
    await drain(queue)

    // It failed immediately (not requeued for 5 attempts) and is in failed().
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0].reason).toContain('RetryEcho')
    expect((await queue.failed()).length).toBe(1)
    expect(await queue.size()).toBe(0)
  })
})
