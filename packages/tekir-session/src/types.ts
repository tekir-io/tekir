/** Backend storage contract for session data (memory, Redis, database, etc.). */
export interface SessionStore {
  read(id: string): Promise<Record<string, unknown> | null>
  write(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void>
  destroy(id: string): Promise<void>
  touch(id: string, ttlSeconds: number): Promise<void>
}

/** Configuration options for the session middleware and its backing store. */
export interface SessionConfig {
  driver?: 'memory' | 'redis' | 'database'
  store?: SessionStore
  age?: number // seconds, default 2 hours
  cookieName?: string
  prefix?: string
  table?: string
  cookie?: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
    path?: string
    domain?: string
  }
}
