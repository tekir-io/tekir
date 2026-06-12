
import type { BaseModel } from './model'

/** Supported column storage types for model schema definitions. */
type ColumnType = 'string' | 'integer' | 'boolean' | 'text' | 'real' | 'blob' | 'date'

/**
 * Cast type used to automatically convert column values when reading from or writing to the database.
 * Can be a built-in type name or a custom transform function.
 *
 * @example
 * // Built-in casts
 * static casts = { isActive: 'boolean', metadata: 'json', score: 'float' }
 *
 * // Custom cast function
 * static casts = { tags: (v: string) => v.split(',') }
 */
export type CastType = 'string' | 'integer' | 'float' | 'boolean' | 'json' | 'date' | ((value: any) => any)

/**
 * Defines the properties of a single column in a model's schema.
 * Used by the `column` helper (e.g. `column.string()`, `column.id()`) to declare table structure.
 */
export interface ColumnDefinition {
  /** Storage type of the column. */
  type: ColumnType
  /** Whether this column is the primary key. */
  isPrimary?: boolean
  /** Whether the primary key auto-increments. Defaults to `true` when `isPrimary` is set. */
  autoIncrement?: boolean
  /** Whether the column allows NULL values. */
  nullable?: boolean
  /** Whether the column has a UNIQUE constraint. */
  unique?: boolean
  /** Default value for the column. */
  default?: unknown
  /** If `true`, the column is excluded from serialization (toJSON). */
  hidden?: boolean
  /** Custom serialization key name, or `null` to exclude from serialization. */
  serializeAs?: string | null
  /** Foreign key reference to another table and column. */
  references?: { table: string; column: string }
  /** If `true`, automatically sets the column to the current timestamp on insert. */
  autoCreate?: boolean
  /** If `true`, automatically sets the column to the current timestamp on every update. */
  autoUpdate?: boolean
  /** Automatic type casting applied when reading from and writing to the database. */
  cast?: CastType
}

/**
 * A mapping of column names to their definitions, representing the full schema of a model's table.
 *
 * @example
 * static schema: ModelSchema = {
 *   id: column.id(),
 *   name: column.string(),
 *   email: column.string({ unique: true }),
 * }
 */
export interface ModelSchema {
  [column: string]: ColumnDefinition
}

/**
 * Describes a relationship between two models.
 * Created by the `hasOne`, `hasMany`, `belongsTo`, and `manyToMany` helper functions.
 */
export interface Relation {
  /** The type of relationship. */
  type: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany'
  /** Factory function that returns the related model class (avoids circular imports). */
  model: () => typeof BaseModel
  /** Foreign key column name on the related table. */
  foreignKey?: string
  /** Local key column name on the current table. */
  localKey?: string
  /** Pivot/join table name for many-to-many relationships. */
  pivotTable?: string
  /** Foreign key in the pivot table pointing to the current model. */
  pivotForeignKey?: string
  /** Foreign key in the pivot table pointing to the related model. */
  pivotRelatedForeignKey?: string
  /** Default value returned when the relationship is empty. `true` returns an empty object. */
  withDefault?: Record<string, unknown> | boolean
}

/**
 * Options for controlling which fields appear in model serialization.
 *
 * @example
 * user.serialize({ fields: ['id', 'name'] })   // whitelist
 * user.serialize({ omit: ['password'] })        // blacklist
 */
export interface SerializeOptions {
  /** If set, only these fields are included in the output. */
  fields?: string[]
  /** If set, these fields are excluded from the output. */
  omit?: string[]
}

/**
 * Lifecycle hook event names that can be registered on a model.
 * Hooks run at specific points during CRUD operations.
 */
export type HookEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' |
  'beforeSave' | 'afterSave' | 'beforeDelete' | 'afterDelete' |
  'beforeFind' | 'afterFind' | 'beforeFetch' | 'afterFetch' |
  'beforePaginate' | 'afterPaginate'

/**
 * A lifecycle hook callback function.
 * Receives the model instance or query context as its argument.
 *
 * @param arg - The hook argument (model instance, query params, or result depending on the event).
 */
 
export type HookFn = (arg: any) => void | Promise<void>

/**
 * Minimal query builder interface used as the parameter type for scope callbacks.
 * Provides a fluent API for building WHERE, ORDER BY, GROUP BY, JOIN, and other SQL clauses.
 */
export interface QueryBuilder {
  where(column: string, value: unknown): QueryBuilder
  where(column: string, operator: string, value: unknown): QueryBuilder
  where(condition: unknown): QueryBuilder
  whereNull(column: string): QueryBuilder
  whereNotNull(column: string): QueryBuilder
  whereBetween(column: string, min: unknown, max: unknown): QueryBuilder
  whereIn(column: string, values: unknown[]): QueryBuilder
  orderBy(column: string, direction?: 'asc' | 'desc'): QueryBuilder
  groupBy(column: string): QueryBuilder
  having(condition: unknown): QueryBuilder
  limit(n: number): QueryBuilder
  offset(n: number): QueryBuilder
  select(...columns: string[]): QueryBuilder
  join(table: string, on: unknown): QueryBuilder
  leftJoin(table: string, on: unknown): QueryBuilder
  count(): QueryBuilder
  all(): unknown[]
  get(): unknown
}

/**
 * A named scope function that applies reusable query constraints.
 *
 * @param query - The query builder instance to apply constraints to.
 * @param args - Additional arguments passed when invoking the scope.
 *
 * @example
 * static published = scope((q) => q.where('status', 'published'))
 * static forUser = scope((q, userId: number) => q.where('userId', userId))
 */
export type ScopeFn = (query: QueryBuilder, ...args: unknown[]) => void

/**
 * Connection configuration for SQLite databases.
 *
 * @example
 * { path: './data/app.db', wal: true }
 */
export interface SqliteConnectionConfig {
  /** File path to the SQLite database. Use `':memory:'` for in-memory databases. */
  path?: string
  /** Enable Write-Ahead Logging mode for better concurrent read performance. */
  wal?: boolean
  /** Enable strict mode. */
  strict?: boolean
  /** Open the database in read-only mode. */
  readonly?: boolean
}

/**
 * Connection configuration for PostgreSQL databases.
 *
 * @example
 * { host: 'localhost', port: 5432, user: 'admin', password: 'secret', database: 'myapp' }
 */
export interface PostgresConnectionConfig {
  /** Full connection URL (e.g. `postgres://user:pass@host:5432/db`). */
  url?: string
  /** Alias for `url`. */
  connectionString?: string
  /** Database host. Defaults to `'localhost'`. */
  host?: string
  /** Database port. Defaults to `5432`. */
  port?: number
  /** Database user. */
  user?: string
  /** Database password. */
  password?: string
  /** Database name. */
  database?: string
  /**
   * Enable SSL. Pass `true` to connect with TLS and full certificate
   * verification (secure default), or an object for fine-grained control.
   * Verification is only disabled with an explicit `{ rejectUnauthorized: false }`.
   */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string }
  /** Connection pool limits and timeouts. */
  pool?: PoolOptions
}

/** Connection pool limits and timeouts shared by the pg and mysql drivers. */
export interface PoolOptions {
  /** Maximum number of connections in the pool. Defaults to `10`. */
  max?: number
  /** Milliseconds an idle connection is kept before closing. Defaults to `30000` (pg only). */
  idleTimeout?: number
  /** Milliseconds to wait for a new connection before failing. Defaults to `10000`. */
  connectionTimeout?: number
}

/**
 * Connection configuration for MySQL databases.
 *
 * @example
 * { host: 'localhost', port: 3306, user: 'root', password: 'secret', database: 'myapp' }
 */
export interface MysqlConnectionConfig {
  /** Full connection URL (e.g. `mysql://user:pass@host:3306/db`). */
  url?: string
  /** Alias for `url`. */
  connectionString?: string
  /** Database host. Defaults to `'localhost'`. */
  host?: string
  /** Database port. Defaults to `3306`. */
  port?: number
  /** Database user. */
  user?: string
  /** Database password. */
  password?: string
  /** Database name. */
  database?: string
  /**
   * Enable SSL. Pass `true` to connect with TLS and full certificate
   * verification (secure default), or an object for fine-grained control.
   * Verification is only disabled with an explicit `{ rejectUnauthorized: false }`.
   */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string }
  /** Connection pool limits and timeouts. */
  pool?: PoolOptions
}

/**
 * Configuration for a single named database connection.
 *
 * @example
 * { driver: 'sqlite', connection: { path: './data/app.db' } }
 */
export interface ConnectionConfig {
  /** The database driver to use. */
  driver: 'sqlite' | 'postgres' | 'mysql'
  /** Driver-specific connection options. */
  connection: SqliteConnectionConfig | PostgresConnectionConfig | MysqlConnectionConfig
  /** Optional Drizzle schema for type-safe queries. */
  schema?: Record<string, any>
}

/**
 * Top-level database configuration with named connections.
 *
 * @example
 * {
 *   default: 'main',
 *   connections: {
 *     main: { driver: 'sqlite', connection: { path: './data/app.db' } },
 *     analytics: { driver: 'postgres', connection: { url: 'postgres://...' } },
 *   }
 * }
 */
export interface DatabaseConfig {
  /** Name of the default connection to use. */
  default: string
  /** Map of connection names to their configurations. */
  connections: Record<string, ConnectionConfig>
}
