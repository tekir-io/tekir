import type { SessionStore } from '../types'

interface SessionDbRow { data: string; expires_at: number }

/** SQL database-backed session store. Auto-creates the sessions table if missing. */
export class DatabaseSessionStore implements SessionStore {
  private db: any
  private table: string
  private _ready = false

  constructor(db: any, table = 'sessions') {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`Invalid table name: "${table}"`)
    this.db = db
    this.table = table
  }

  private async _ensureTable() {
    if (this._ready) return
    try {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS "${this.table}" (id TEXT PRIMARY KEY, data TEXT, expires_at INTEGER)`)
      this._ready = true
    } catch {}
  }

  async read(id: string): Promise<Record<string, unknown> | null> {
    await this._ensureTable()
    const row = await this.db.queryOne(`SELECT data, expires_at FROM "${this.table}" WHERE id = ?`, [id]) as SessionDbRow | null
    if (!row || Date.now() > row.expires_at) return null
    try { return JSON.parse(row.data) as Record<string, unknown> } catch { return null }
  }

  async write(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    await this._ensureTable()
    const expiresAt = Date.now() + ttlSeconds * 1000
    await this.db.run(`INSERT OR REPLACE INTO "${this.table}" (id, data, expires_at) VALUES (?, ?, ?)`, [id, JSON.stringify(data), expiresAt])
  }

  async destroy(id: string): Promise<void> {
    await this.db.run(`DELETE FROM "${this.table}" WHERE id = ?`, [id])
  }

  async touch(id: string, ttlSeconds: number): Promise<void> {
    await this.db.run(`UPDATE "${this.table}" SET expires_at = ? WHERE id = ?`, [Date.now() + ttlSeconds * 1000, id])
  }
}
