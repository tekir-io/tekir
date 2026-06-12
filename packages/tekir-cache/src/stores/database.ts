import type { CacheStore } from '../types'

interface CacheDbRow { value: string; expires_at: number | null }

/**
 * Database-backed cache store using a SQLite/SQL table with optional TTL.
 * The table is created automatically on first use.
 *
 * @example
 * ```ts
 * const store = new DatabaseCacheStore(db, 'cache')
 * await store.set('key', { foo: 'bar' }, 300)
 * ```
 */
export class DatabaseCacheStore implements CacheStore {
  private db: any
  private table: string
  private _ready = false

  /**
   * Create a new DatabaseCacheStore.
   *
   * @param db - A database client with `exec`, `run`, and `queryOne` methods.
   * @param table - The SQL table name for storing cache entries. Defaults to `'cache'`.
   * @throws Error if the table name contains invalid characters.
   */
  constructor(db: any, table = 'cache') {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`Invalid table name: "${table}"`)
    this.db = db
    this.table = table
  }

  private async _ensureTable() {
    if (this._ready) return
    try {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS "${this.table}" (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)`)
      this._ready = true
    } catch (e) {
      // Don't silently swallow: an unset _ready means every later get/set blows
      // up with a confusing SQL error. Surface the real cause and rethrow so the
      // misconfiguration is visible at the point of failure.
      console.error(`[@tekir/cache] Failed to create cache table "${this.table}": ${(e as Error).message}`)
      throw e
    }
  }

  /**
   * Retrieve a cached value by key. Expired entries are deleted and `null` is returned.
   *
   * @param key - The cache key.
   * @returns The stored value parsed from JSON, or `null`.
   */
  async get<T = any>(key: string): Promise<T | null> {
    await this._ensureTable()
    const row = await this.db.queryOne(`SELECT value, expires_at FROM "${this.table}" WHERE key = ?`, [key]) as CacheDbRow | null
    if (!row) return null
    if (row.expires_at && Date.now() > row.expires_at) {
      await this.db.run(`DELETE FROM "${this.table}" WHERE key = ?`, [key])
      return null
    }
    try { return JSON.parse(row.value) } catch { return row.value as T }
  }

  /**
   * Store a value under the given key, reptekirg any existing entry.
   *
   * @param key - The cache key.
   * @param value - The value to cache (serialized to JSON).
   * @param ttlSeconds - Time-to-live in seconds. Omit for no expiration.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this._ensureTable()
    const val = JSON.stringify(value)
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
    await this.db.run(
      `INSERT OR REPLACE INTO "${this.table}" (key, value, expires_at) VALUES (?, ?, ?)`,
      [key, val, expiresAt]
    )
  }

  /**
   * Check whether a key exists and is not expired.
   *
   * @param key - The cache key.
   * @returns `true` if the key exists and has not expired.
   */
  async has(key: string): Promise<boolean> {
    await this._ensureTable()
    const row = await this.db.queryOne(`SELECT expires_at FROM "${this.table}" WHERE key = ?`, [key]) as { expires_at: number | null } | null
    if (!row) return false
    if (row.expires_at && Date.now() > row.expires_at) {
      await this.db.run(`DELETE FROM "${this.table}" WHERE key = ?`, [key])
      return false
    }
    // Present even if the stored value is `null` (negative caching).
    return true
  }

  /**
   * Delete a key from the database.
   *
   * @param key - The cache key to remove.
   * @returns Always returns `true`.
   */
  async delete(key: string): Promise<boolean> {
    await this._ensureTable()
    await this.db.run(`DELETE FROM "${this.table}" WHERE key = ?`, [key])
    return true
  }

  /**
   * Delete all expired entries. Entries are otherwise only removed when read,
   * so call this periodically to stop never-read expired rows from accumulating.
   *
   * @returns A promise that resolves once expired rows have been removed.
   */
  async prune(): Promise<void> {
    await this._ensureTable()
    await this.db.run(`DELETE FROM "${this.table}" WHERE expires_at IS NOT NULL AND expires_at < ?`, [Date.now()])
  }

  /**
   * Remove all entries from the cache table.
   *
   * @example
   * ```ts
   * await store.flush()
   * ```
   */
  async flush(): Promise<void> {
    await this._ensureTable()
    await this.db.run(`DELETE FROM "${this.table}"`)
  }
}
