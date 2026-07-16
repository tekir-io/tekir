import type { SessionStore } from '../types'

/** Options for {@link MemorySessionStore}. */
export interface MemoryStoreOptions {
  /** Hard cap on stored sessions; oldest-expiring entries are evicted past it. Default 100000. */
  maxEntries?: number
  /** Background sweep interval in ms to purge expired entries. Default 60000. `0` disables. */
  sweepIntervalMs?: number
}

/** In-memory session store using a `Map`. Suitable for development and single-process apps. */
export class MemorySessionStore implements SessionStore {
  private data = new Map<string, { data: Record<string, unknown>; expiresAt: number }>()
  private maxEntries: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100_000
    const interval = options.sweepIntervalMs ?? 60_000
    if (interval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), interval)
      // Don't keep the process alive just for the sweep.
      ;(this.sweepTimer as any)?.unref?.()
    }
  }

  async read(id: string): Promise<Record<string, unknown> | null> {
    const entry = this.data.get(id)
    if (!entry || Date.now() > entry.expiresAt) { this.data.delete(id); return null }
    // Match serialized stores (Redis/SQL): callers must never receive the
    // live object held by the store, otherwise an unsaved request can mutate
    // another concurrent request's session by reference.
    return structuredClone(entry.data)
  }

  async write(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    this.data.set(id, { data: structuredClone(data), expiresAt: Date.now() + ttlSeconds * 1000 })
    if (this.data.size > this.maxEntries) this.evict()
  }

  async destroy(id: string): Promise<void> { this.data.delete(id) }

  async touch(id: string, ttlSeconds: number): Promise<void> {
    const entry = this.data.get(id)
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000
  }

  /** Purge all expired entries. Called on a timer and reusable in tests. */
  sweep(): void {
    const now = Date.now()
    for (const [id, entry] of this.data) {
      if (now > entry.expiresAt) this.data.delete(id)
    }
  }

  /** Drop soonest-to-expire entries once the size cap is exceeded. */
  private evict(): void {
    this.sweep()
    if (this.data.size <= this.maxEntries) return
    const sorted = [...this.data.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    const overflow = this.data.size - this.maxEntries
    for (let i = 0; i < overflow; i++) this.data.delete(sorted[i][0])
  }

  /** Stop the background sweep timer (for clean shutdown/tests). */
  stop(): void {
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null }
  }
}
