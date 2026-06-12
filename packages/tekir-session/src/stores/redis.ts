import type { SessionStore } from '../types'

interface SessionRedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

/** Redis-backed session store. Uses JSON serialization and Redis `EXPIRE` for TTL. */
export class RedisSessionStore implements SessionStore {
  constructor(private redis: SessionRedisClient, private prefix = 'sess:') {}

  async read(id: string): Promise<Record<string, unknown> | null> {
    const val = await this.redis.get(this.prefix + id)
    if (!val) return null
    try { return JSON.parse(val) as Record<string, unknown> } catch { return null }
  }

  async write(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + id, JSON.stringify(data))
    await this.redis.expire(this.prefix + id, ttlSeconds)
  }

  async destroy(id: string): Promise<void> { await this.redis.del(this.prefix + id) }

  async touch(id: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(this.prefix + id, ttlSeconds)
  }
}
