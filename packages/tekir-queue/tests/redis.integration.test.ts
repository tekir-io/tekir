import { test, expect, describe, beforeAll, afterEach, afterAll } from 'bun:test'
import { RedisBackend } from '../src/backends/redis'
import type { JobRecord } from '../src/types'

// Integration tests against a real Redis at localhost:6379. They prove the
// atomic-claim / lease scheme: concurrent pops never double-claim, retry never
// collides on id, crashed leases are recovered, and markFailed persists
// attempts. If Redis is unreachable the whole suite skips rather than failing.

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Unique per-run prefix so parallel runs / shared databases never collide and
// teardown can delete only this run's keys (FLUSHDB would be too broad).
const RUN = `itest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const QUEUE = `${RUN}-q`

let client: any
let backend: RedisBackend
let available = false
const trackedIds = new Set<string>()

/** Build a JobRecord with a run-scoped id so cleanup can target it. */
function record(over: Partial<JobRecord> = {}): JobRecord {
  const now = Date.now() - 1
  const id = over.id ?? `${RUN}-${Math.random().toString(36).slice(2, 10)}`
  trackedIds.add(id)
  return {
    queue: QUEUE, payload: '{}', attempts: 0,
    maxAttempts: 3, availableAt: now, createdAt: now, status: 'pending', ...over, id,
  }
}

/** Delete only the keys this run created. */
async function cleanup(): Promise<void> {
  if (!available) return
  await client.send('DEL', [`tekir:queue:${QUEUE}`, `tekir:queue:processing:${QUEUE}`])
  for (const id of trackedIds) {
    await client.send('DEL', [`tekir:queue:record:${id}`])
    await client.send('LREM', ['tekir:queue:failed', '0', id])
    await client.send('ZREM', ['tekir:queue:delayed', id])
  }
}

beforeAll(async () => {
  try {
    const { RedisClient } = Bun as any
    client = new RedisClient(REDIS_URL, { autoReconnect: false, maxRetries: 0 })
    await client.connect()
    const pong = await client.send('PING', [])
    available = pong === 'PONG' || pong === 'OK' || pong?.toString?.().toUpperCase?.() === 'PONG'
    backend = new RedisBackend(client)
  } catch {
    available = false
  }
})

afterEach(async () => {
  await cleanup()
})

afterAll(async () => {
  if (available && client) {
    await cleanup()
    try { client.close() } catch {}
  }
})

describe('RedisBackend — atomic claim (integration)', () => {
  test('an orphaned pending id is removed instead of leaking into processing', async () => {
    if (!available) return
    const id = `${RUN}-orphan`
    trackedIds.add(id)
    await client.send('LPUSH', [`tekir:queue:${QUEUE}`, id])
    expect(await backend.pop(QUEUE)).toBeNull()
    const processing = await client.send('LRANGE', [`tekir:queue:processing:${QUEUE}`, '0', '-1'])
    expect(processing).not.toContain(id)
  })

  test('concurrent pops never double-claim the same job', async () => {
    if (!available) return
    await backend.push(record({ id: `${RUN}-only` }))

    // Race many pops against a single job.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => backend.pop(QUEUE))
    )
    const claimed = results.filter((r): r is JobRecord => r !== null)
    expect(claimed).toHaveLength(1)
    expect(claimed[0].id).toBe(`${RUN}-only`)
    expect(claimed[0].status).toBe('processing')
  })

  test('each of N jobs is claimed exactly once under concurrent pops', async () => {
    if (!available) return
    const ids: string[] = []
    for (let i = 0; i < 8; i++) {
      const r = record()
      ids.push(r.id)
      await backend.push(r)
    }

    const results = await Promise.all(
      Array.from({ length: 20 }, () => backend.pop(QUEUE))
    )
    const got = results.filter((r): r is JobRecord => r !== null).map(r => r.id)
    expect(got).toHaveLength(8)
    expect(new Set(got).size).toBe(8) // no duplicates
    expect(new Set(got)).toEqual(new Set(ids))
  })
})

describe('RedisBackend — requeue (retry path, integration)', () => {
  test('requeue makes the job poppable again without id collision', async () => {
    if (!available) return
    const r = record({ id: `${RUN}-retry`, maxAttempts: 3 })
    await backend.push(r)

    const claimed = await backend.pop(QUEUE)
    expect(claimed!.id).toBe(`${RUN}-retry`)

    // Worker increments attempts and releases for retry.
    claimed!.attempts = 1
    claimed!.availableAt = Date.now() - 1
    await backend.requeue(claimed!)

    // The processing list no longer holds it, and it is poppable with the
    // persisted attempts count.
    const procLen = await client.send('LLEN', [`tekir:queue:processing:${QUEUE}`])
    expect(Number(procLen)).toBe(0)

    const again = await backend.pop(QUEUE)
    expect(again!.id).toBe(`${RUN}-retry`)
    expect(again!.attempts).toBe(1)
  })
})

describe('RedisBackend — crash recovery (integration)', () => {
  test('a leased-but-expired processing job is requeued', async () => {
    if (!available) return
    const r = record({ id: `${RUN}-stuck` })
    await backend.push(r)

    const claimed = await backend.pop(QUEUE)
    expect(claimed!.id).toBe(`${RUN}-stuck`)
    // While leased it must not be poppable.
    expect(await backend.pop(QUEUE)).toBeNull()

    // Simulate a crashed worker: rewind reserved_at far past the lease window.
    const raw = await client.send('GET', [`tekir:queue:record:${RUN}-stuck`])
    const rec = JSON.parse(raw)
    rec.reservedAt = Date.now() - 10 * 60_000
    await client.send('SET', [`tekir:queue:record:${RUN}-stuck`, JSON.stringify(rec)])

    // Next pop runs recovery first and reclaims the stuck job.
    const recovered = await backend.pop(QUEUE)
    expect(recovered).not.toBeNull()
    expect(recovered!.id).toBe(`${RUN}-stuck`)
  })

  test('a still-leased job is NOT recovered before its lease expires', async () => {
    if (!available) return
    const r = record({ id: `${RUN}-fresh` })
    await backend.push(r)
    await backend.pop(QUEUE) // fresh lease
    // Without rewinding reserved_at, a subsequent pop finds nothing.
    expect(await backend.pop(QUEUE)).toBeNull()
  })
})

describe('RedisBackend — markFailed (integration)', () => {
  test('markFailed persists the incremented attempts count', async () => {
    if (!available) return
    const r = record({ id: `${RUN}-fail`, maxAttempts: 1 })
    await backend.push(r)
    const claimed = await backend.pop(QUEUE)
    claimed!.attempts = 1
    await backend.markFailed(`${RUN}-fail`, 'boom', claimed!)

    const stored = await backend.getById(`${RUN}-fail`)
    expect(stored!.status).toBe('failed')
    expect(stored!.attempts).toBe(1)
    expect(stored!.failedReason).toBe('boom')

    // The claim is released from the processing list.
    const procLen = await client.send('LLEN', [`tekir:queue:processing:${QUEUE}`])
    expect(Number(procLen)).toBe(0)
  })
})
