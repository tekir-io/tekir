
// SQLite — bun:sqlite on Bun, better-sqlite3 on Node.js
// Returns a bun:sqlite-compatible API on both runtimes

import { isBun, getRequire } from './detect.js'

/**
 * Ensure the parent directory of a SQLite file path exists. SQLite refuses
 * to create the database file if its parent directory is missing, so a
 * fresh project with `path: './database/app.sqlite'` and no `database/`
 * folder otherwise crashes on boot. We mkdir-p once here.
 *
 * Skips in-memory and read-only opens, plus any URI-style identifiers.
 *
 * Note: `path` is trusted. Callers must never pass an unvalidated user-supplied
 * path here, as it would create directories / open a DB at an arbitrary
 * location.
 */
function ensureDir(path: string, readonly?: boolean): void {
  if (readonly) return
  if (!path || path === ':memory:' || path.startsWith('file::memory:')) return
  if (path.startsWith('file:') || path.includes('?')) return
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (slash <= 0) return
  const dir = path.slice(0, slash)
  try {
    const { mkdirSync, existsSync } = getRequire()('fs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch { /* let SQLite surface the real error if mkdir failed */ }
}

/**
 * Open a SQLite database. Returns bun:sqlite Database on Bun,
 * or a bun:sqlite-compatible wrapper on Node.js (using better-sqlite3).
 *
 * @param {string} path - Path to the SQLite database file
 * @param {object} [opts={}] - Database options
 * @param {boolean} [opts.readonly=false] - Open in read-only mode
 * @param {boolean} [opts.wal=true] - Enable WAL journal mode (default true)
 * @returns {any} A database instance with run, query, exec, close, prepare, and transaction methods
 *
 * @example
 * ```ts
 * const db = openDatabase('./data.db')
 * db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)')
 * const rows = db.query('SELECT * FROM users').all()
 * ```
 */
export function openDatabase(path: string, opts: { readonly?: boolean; wal?: boolean } = {}): any {
  ensureDir(path, opts.readonly)
  // WAL requires write access; a read-only handle cannot switch journal mode
  // and `PRAGMA journal_mode = WAL` errors out on some builds, so skip it.
  const enableWal = opts.wal !== false && !opts.readonly

  if (isBun()) {
    const { Database } = require('bun:sqlite')
    const db = opts.readonly ? new Database(path, { readonly: true }) : new Database(path)
    if (enableWal) db.exec('PRAGMA journal_mode = WAL')
    return db
  }

  // Node.js — wrap better-sqlite3 to match bun:sqlite API
  const BetterSqlite3 = getRequire()('better-sqlite3')
  const db = opts.readonly ? new BetterSqlite3(path, { readonly: true }) : new BetterSqlite3(path)
  if (enableWal) db.pragma('journal_mode = WAL')

  return {
    _raw: db,
    run(sql: string, ...params: any[]) { return db.prepare(sql).run(...params) },
    query(sql: string) {
      return {
        all(...p: any[]) { return db.prepare(sql).all(...p) },
        get(...p: any[]) { return db.prepare(sql).get(...p) },
      }
    },
    exec(sql: string) { return db.exec(sql) },
    close() { return db.close() },
    prepare(sql: string) { return db.prepare(sql) },
    transaction(fn: (...args: any[]) => any) { return db.transaction(fn) },
  }
}
