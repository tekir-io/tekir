
import type {
  SqliteConnectionConfig,
  PostgresConnectionConfig,
  MysqlConnectionConfig,
  ConnectionConfig,
  DatabaseConfig,
} from './types'
import { QueryBuilder, InsertBuilder } from './query_builder'
import { openDatabase, isBun } from '@tekir/runtime'

export type { SqliteConnectionConfig, PostgresConnectionConfig, MysqlConnectionConfig, ConnectionConfig, DatabaseConfig }

type PoolConfig = { pool?: { max?: number; idleTimeout?: number; connectionTimeout?: number } }

/**
 * Resolve the SSL option for the pg/mysql drivers.
 *
 * Secure by default: when SSL is requested without an explicit object, TLS is
 * enabled WITH certificate verification (`rejectUnauthorized: true`). Disabling
 * verification requires the caller to pass an explicit `{ rejectUnauthorized:
 * false }`. Returns `undefined` when SSL is not requested at all.
 */
export function resolveSsl(ssl: boolean | { rejectUnauthorized?: boolean; ca?: string } | undefined, needsSsl: boolean): { rejectUnauthorized?: boolean; ca?: string } | undefined {
  if (!needsSsl) return undefined
  if (typeof ssl === 'object') return ssl
  return { rejectUnauthorized: true }
}

/**
 * Redact the `user:password@` portion of any connection URL in a string so
 * credentials are never leaked through a rethrown driver error or log line.
 */
export function maskCredentials(text: string): string {
  return text.replace(/(\w+:\/\/)([^:@/\s]+):([^@/\s]+)@/g, '$1$2:****@')
}

/**
 * Pool/timeout options for `pg.Pool`. Conservative defaults bound the pool size
 * and fail a stalled connection attempt fast instead of exhausting resources.
 */
function pgPoolSettings(c: PoolConfig): Record<string, number> {
  const p = c.pool || {}
  return {
    max: p.max ?? 10,
    idleTimeoutMillis: p.idleTimeout ?? 30000,
    connectionTimeoutMillis: p.connectionTimeout ?? 10000,
  }
}

/**
 * Pool/timeout options for `mysql2.createPool`, which uses different option
 * names (`connectionLimit`, `connectTimeout`) than pg.
 */
function mysqlPoolSettings(c: PoolConfig): Record<string, number> {
  const p = c.pool || {}
  return {
    connectionLimit: p.max ?? 10,
    connectTimeout: p.connectionTimeout ?? 10000,
  }
}

export class Database {
  private _connections = new Map<string, { drizzle: any; raw: any; driver: string }>()
  private _defaultName: string

  constructor(config: DatabaseConfig) {
    this._defaultName = config.default
    for (const [name, connConfig] of Object.entries(config.connections)) {
      this._initConnection(name, connConfig)
    }
  }

  private _initConnection(name: string, config: ConnectionConfig) {
    const driver = config.driver || 'sqlite'
    const conn = config.connection || {}
    let raw: any
    let drizzle: any

    switch (driver) {
      case 'sqlite': {
        const c = conn as SqliteConnectionConfig
        raw = openDatabase(c.path || ':memory:', { readonly: c.readonly, wal: c.wal })
        raw.exec('PRAGMA foreign_keys = ON;')
        try {
          const drizzleModule = isBun() ? 'drizzle-orm/bun-sqlite' : 'drizzle-orm/better-sqlite3'
          const { drizzle: d } = require(drizzleModule)
          // Drizzle needs the unwrapped raw driver, not our adapter
          const unwrapped = raw._raw || raw
          drizzle = d(unwrapped, config.schema ? { schema: config.schema } : undefined)
        } catch { drizzle = null }
        break
      }
      case 'postgres': {
        try {
          const pg = require('pg')
          const c = conn as PostgresConnectionConfig
          let url = c.connectionString || c.url || `postgres://${c.user}:${c.password}@${c.host || 'localhost'}:${c.port || 5432}/${c.database}`
          const needsSsl = c.ssl || url.includes('sslmode=require') || url.includes('sslmode=verify')
          url = url.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]uselibpqcompat=[^&]*/g, '').replace(/\?$/, '')
          // Secure by default: verify the server certificate. Disabling verification
          // requires an explicit { ssl: { rejectUnauthorized: false } } in config.
          const sslConfig = resolveSsl(c.ssl, !!needsSsl)
          raw = new pg.Pool({ connectionString: url, ssl: sslConfig, ...pgPoolSettings(c) })
          // Surface idle-client errors instead of crashing the process.
          raw.on('error', () => { /* connection-level error; pg reconnects on next query */ })
          const { drizzle: d } = require('drizzle-orm/node-postgres')
          drizzle = d(raw, config.schema ? { schema: config.schema } : undefined)
        } catch (e: any) {
          if (e.message?.includes('Cannot find')) throw new Error('PostgreSQL requires: bun add pg')
          if (e?.message) e.message = maskCredentials(e.message)
          throw e
        }
        break
      }
      case 'mysql': {
        try {
          const mysql = require('mysql2/promise')
          const c = conn as MysqlConnectionConfig
          let url = c.connectionString || c.url || `mysql://${c.user}:${c.password}@${c.host || 'localhost'}:${c.port || 3306}/${c.database}`
          const needsSsl = c.ssl || url.includes('ssl-mode=REQUIRED') || url.includes('ssl=true')
          url = url.replace(/[?&]ssl-mode=[^&]*/gi, '').replace(/[?&]ssl=[^&]*/gi, '').replace(/\?$/, '')
          const poolOpts: any = { uri: url, ...mysqlPoolSettings(c) }
          const mysqlSsl = resolveSsl(c.ssl, !!needsSsl)
          if (mysqlSsl) poolOpts.ssl = mysqlSsl
          raw = mysql.createPool(poolOpts)
          const { drizzle: d } = require('drizzle-orm/mysql2')
          drizzle = d(raw, config.schema ? { schema: config.schema } : undefined)
        } catch (e: any) {
          if (e.message?.includes('Cannot find')) throw new Error('MySQL requires: bun add mysql2')
          if (e?.message) e.message = maskCredentials(e.message)
          throw e
        }
        break
      }
      default:
        throw new Error(`Unsupported driver: ${driver}`)
    }

    this._connections.set(name, { drizzle, raw, driver })
  }

  private _get(name?: string) {
    const key = name || this._defaultName
    const conn = this._connections.get(key)
    if (!conn) throw new Error(`Database connection "${key}" not configured`)
    return conn
  }

  /**
   * Switch to a named connection.
   * @example
   * db.connection('analytics').select().from(events)
   * db.connection('readonly').query('SELECT ...')
   */
  connection(name: string): Database {
    // Return a lightweight proxy that defaults to the named connection
    const conn = this._get(name)
    if (!conn) throw new Error(`Database connection "${name}" not configured`)
    const proxy = Object.create(this)
    proxy._defaultName = name
    return proxy
  }

  get driver(): string { return this._get().driver }

  // ── Fluent Query Builder ──────────────────────────────

  /** Start a SELECT query builder: db.from('users').where(...).all() */
  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table)
  }

  /** Start an INSERT query builder: db.table('users').values({...}).exec() */
  table(table: string): InsertBuilder {
    return new InsertBuilder(this, table)
  }

  // ── Drizzle (internal + advanced) ──────────────────

  /** @internal Drizzle select — used by BaseModel */
  select(fields?: any) { const d = this._get().drizzle; return fields ? d.select(fields) : d.select() }
  /** @internal Drizzle insert — used by BaseModel */
  insert(tableRef: any) { return this._get().drizzle.insert(tableRef) }
  /** @internal Drizzle update — used by BaseModel */
  update(tableRef: any) { return this._get().drizzle.update(tableRef) }
  /** @internal Drizzle delete — used by BaseModel */
  delete(tableRef: any) { return this._get().drizzle.delete(tableRef) }

  get drizzle() { return this._get().drizzle }
  get schema(): Record<string, any> { return {} }

  // ── Raw queries (works with all drivers) ────────────

  async query<T = any>(sqlStr: string, params: any[] = []): Promise<T[]> {
    const c = this._get()
    if (c.driver === 'sqlite') return c.raw.query(sqlStr).all(...params) as T[]
    if (c.driver === 'postgres') return (await c.raw.query(sqlStr, params)).rows as T[]
    if (c.driver === 'mysql') return (await c.raw.query(sqlStr, params))[0] as T[]
    throw new Error(`Unsupported driver: ${c.driver}`)
  }

  async queryOne<T = any>(sqlStr: string, params: any[] = []): Promise<T | null> {
    const c = this._get()
    if (c.driver === 'sqlite') return (c.raw.query(sqlStr).get(...params) as T) ?? null
    if (c.driver === 'postgres') return (await c.raw.query(sqlStr, params)).rows[0] ?? null
    if (c.driver === 'mysql') return (await c.raw.query(sqlStr, params))[0]?.[0] ?? null
    throw new Error(`Unsupported driver: ${c.driver}`)
  }

  async run(sqlStr: string, params: any[] = []): Promise<void> {
    const c = this._get()
    if (c.driver === 'sqlite') { c.raw.run(sqlStr, ...params); return }
    if (c.driver === 'postgres') { await c.raw.query(sqlStr, params); return }
    if (c.driver === 'mysql') { await c.raw.query(sqlStr, params); return }
    throw new Error(`Unsupported driver: ${c.driver}`)
  }

  async exec(sqlStr: string): Promise<void> {
    const c = this._get()
    if (c.driver === 'sqlite') { c.raw.exec(sqlStr); return }
    if (c.driver === 'postgres') { await c.raw.query(sqlStr); return }
    if (c.driver === 'mysql') { await c.raw.query(sqlStr); return }
    throw new Error(`Unsupported driver: ${c.driver}`)
  }

  // ── Transactions ──────────────────────────────────────

  /**
   * Run a callback inside a real database transaction.
   *
   * SQLite uses the native synchronous transaction wrapper. PostgreSQL and MySQL
   * acquire a single dedicated connection, issue BEGIN, and COMMIT on success or
   * ROLLBACK on any thrown error. For the duration of the callback the active
   * connection's raw client is bound to that transaction connection, so raw
   * queries run via `db.query`/`db.run`/`db.queryOne`/`db.exec` (and the fluent
   * query builder) participate in the transaction and are rolled back together.
   */
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const conn = this._get()
    if (conn.driver === 'sqlite') {
      // The native bun:sqlite transaction wrapper does not await async callbacks
      // (it commits as soon as the function returns a promise), so an async body
      // that throws after an await would still commit. Drive BEGIN/COMMIT/ROLLBACK
      // explicitly so async work is genuinely atomic.
      conn.raw.run('BEGIN')
      try {
        const result = await fn()
        conn.raw.run('COMMIT')
        return result
      } catch (e) {
        try { conn.raw.run('ROLLBACK') } catch { /* already rolled back */ }
        throw e
      }
    }

    const pool = conn.raw
    const originalRaw = conn.raw

    if (conn.driver === 'postgres') {
      const client = await pool.connect()
      conn.raw = client
      try {
        await client.query('BEGIN')
        const result = await fn()
        await client.query('COMMIT')
        return result
      } catch (e) {
        try { await client.query('ROLLBACK') } catch { /* connection may be broken */ }
        throw e
      } finally {
        conn.raw = originalRaw
        client.release()
      }
    }

    if (conn.driver === 'mysql') {
      const client = await pool.getConnection()
      conn.raw = client
      try {
        await client.query('BEGIN')
        const result = await fn()
        await client.query('COMMIT')
        return result
      } catch (e) {
        try { await client.query('ROLLBACK') } catch { /* connection may be broken */ }
        throw e
      } finally {
        conn.raw = originalRaw
        client.release()
      }
    }

    throw new Error(`Unsupported driver: ${conn.driver}`)
  }

  // ── Migrations ────────────────────────────────────────

  async migrate(migrationsFolder: string) {
    const c = this._get()
    if (c.driver === 'sqlite') {
      const { migrate } = require('drizzle-orm/bun-sqlite/migrator')
      migrate(c.drizzle, { migrationsFolder })
    } else if (c.driver === 'postgres') {
      const { migrate } = require('drizzle-orm/node-postgres/migrator')
      await migrate(c.drizzle, { migrationsFolder })
    } else if (c.driver === 'mysql') {
      const { migrate } = require('drizzle-orm/mysql2/migrator')
      await migrate(c.drizzle, { migrationsFolder })
    }
  }

  // ── Utilities ─────────────────────────────────────────

  get raw() { return this._get().raw }

  /** List all configured connection names */
  get connectionNames(): string[] {
    return [...this._connections.keys()]
  }

  close(name?: string) {
    if (name) {
      const c = this._connections.get(name)
      if (c?.driver === 'sqlite') c.raw.close()
      else if (c?.raw?.end) c.raw.end()
      this._connections.delete(name)
    } else {
      for (const [, c] of this._connections) {
        if (c.driver === 'sqlite') c.raw.close()
        else if (c.raw?.end) c.raw.end()
      }
      this._connections.clear()
    }
  }
}

export function createDatabase(config: DatabaseConfig): Database {
  return new Database(config)
}
