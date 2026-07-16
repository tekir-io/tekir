import { eq, and, inArray, isNull, isNotNull, count as countFn, sum as sumFn, avg as avgFn, min as minFn, max as maxFn, sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core'
import { NotFoundException } from '@tekir/core'
import type {
  CastType,
  ColumnDefinition,
  ModelSchema,
  Relation,
  SerializeOptions,
  HookEvent,
  HookFn,
  QueryBuilder,
  ScopeFn,
} from './types'

export type { CastType, ColumnDefinition, ModelSchema, Relation, SerializeOptions, QueryBuilder, ScopeFn }


/** Thrown when a model query (e.g. `findOrFail`) returns no results. */
export class ModelNotFoundError extends NotFoundException {
  constructor(model: string) {
    super(`${model} not found`)
    this.code = 'ROW_NOT_FOUND'
  }
}


function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

function buildDrizzleTable(tableName: string, schema: ModelSchema) {
  const columns: Record<string, any> = {}
  for (const [name, def] of Object.entries(schema)) {
    const colName = toSnakeCase(name)
    let col: any
    switch (def.type) {
      case 'string': case 'text': case 'date': col = text(colName); break
      case 'integer': case 'boolean': col = integer(colName); break
      case 'real': col = real(colName); break
      case 'blob': col = blob(colName); break
      default: col = text(colName)
    }
    if (def.isPrimary) col = def.autoIncrement !== false ? col.primaryKey({ autoIncrement: true }) : col.primaryKey()
    if (def.nullable === false || (!def.nullable && !def.isPrimary)) col = col.notNull()
    if (def.unique) col = col.unique()
    if (def.default !== undefined) col = col.default(def.default)
    columns[name] = col
  }
  return sqliteTable(tableName, columns)
}

function buildCreateSQL(tableName: string, schema: ModelSchema): string {
  const cols: string[] = []
  for (const [name, def] of Object.entries(schema)) {
    const colName = toSnakeCase(name)
    let sqlType = 'TEXT'
    if (def.type === 'integer' || def.type === 'boolean') sqlType = 'INTEGER'
    else if (def.type === 'real') sqlType = 'REAL'
    else if (def.type === 'blob') sqlType = 'BLOB'
    let line = `${colName} ${sqlType}`
    if (def.isPrimary) line += ' PRIMARY KEY'
    if (def.autoIncrement !== false && def.isPrimary) line += ' AUTOINCREMENT'
    if (def.nullable === false || (!def.nullable && !def.isPrimary)) line += ' NOT NULL'
    if (def.unique) line += ' UNIQUE'
    if (def.default !== undefined) line += ` DEFAULT ${typeof def.default === 'string' ? `'${def.default.replace(/'/g, "''")}'` : def.default}`
    if (def.references) line += ` REFERENCES "${def.references.table}"("${def.references.column}")`
    cols.push(line)
  }
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (${cols.join(', ')})`
}

function applyCast(value: any, cast: CastType): any {
  if (value === null || value === undefined) return value
  if (typeof cast === 'function') return cast(value)
  switch (cast) {
    case 'string': return String(value)
    case 'integer': return parseInt(value, 10)
    case 'float': return parseFloat(value)
    case 'boolean': return Boolean(value) && value !== '0' && value !== 'false'
    case 'json': return typeof value === 'string' ? JSON.parse(value) : value
    case 'date': return typeof value === 'string' ? new Date(value) : value
    default: return value
  }
}

function serializeCast(value: any, cast: CastType): any {
  if (value === null || value === undefined) return value
  if (typeof cast === 'function') return value
  switch (cast) {
    case 'json': return typeof value === 'object' ? JSON.stringify(value) : value
    case 'date': return value instanceof Date ? value.toISOString() : value
    case 'boolean': return value ? 1 : 0
    default: return value
  }
}


export const column = {
  /** Auto-incrementing integer primary key */
  id: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'integer', isPrimary: true, autoIncrement: true, ...opts }),

  /** Variable-length string column */
  string: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'string', ...opts }),

  /** Long text column */
  text: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'text', ...opts }),

  /** Integer column */
  integer: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'integer', ...opts }),

  /** Boolean column (stored as INTEGER 0/1, auto-cast to boolean) */
  boolean: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'boolean', cast: 'boolean', ...opts }),

  /** Floating-point number column (REAL) */
  real: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'real', ...opts }),

  /** Date column (stored as ISO string TEXT) */
  date: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'date', ...opts }),

  /**
   * DateTime column with optional auto-create/auto-update timestamps
   * @example
   * column.dateTime({ autoCreate: true })
   * column.dateTime({ autoCreate: true, autoUpdate: true })
   */
  dateTime: (opts?: Partial<ColumnDefinition> & { autoCreate?: boolean; autoUpdate?: boolean }): ColumnDefinition =>
    ({ type: 'date', ...opts }),

  /** JSON column (stored as TEXT, auto-cast to object) */
  json: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'text', cast: 'json', ...opts }),

  /** Binary data column (BLOB) */
  blob: (opts?: Partial<ColumnDefinition>): ColumnDefinition =>
    ({ type: 'blob', ...opts }),
}


/**
 * Define a one-to-one relationship
 * @example
 * static relations = { profile: hasOne(() => Profile) }
 */
export function hasOne(model: () => typeof BaseModel, opts?: { foreignKey?: string; localKey?: string; withDefault?: Record<string, unknown> | boolean }): Relation {
  return { type: 'hasOne', model, ...opts }
}

/**
 * Define a one-to-many relationship
 * @example
 * static relations = { posts: hasMany(() => Post) }
 */
export function hasMany(model: () => typeof BaseModel, opts?: { foreignKey?: string; localKey?: string }): Relation {
  return { type: 'hasMany', model, ...opts }
}

/**
 * Define an inverse relationship
 * @example
 * static relations = { user: belongsTo(() => User) }
 */
export function belongsTo(model: () => typeof BaseModel, opts?: { foreignKey?: string; localKey?: string; withDefault?: Record<string, unknown> | boolean }): Relation {
  return { type: 'belongsTo', model, ...opts }
}

/**
 * Define a many-to-many relationship through a pivot table
 * @example
 * static relations = { roles: manyToMany(() => Role, { pivotTable: 'user_roles' }) }
 */
export function manyToMany(model: () => typeof BaseModel, opts?: { pivotTable?: string; pivotForeignKey?: string; pivotRelatedForeignKey?: string }): Relation {
  return { type: 'manyToMany', model, ...opts }
}


/**
 * Define a named query scope
 * @example
 * static published = scope((q) => q.where('status', 'published'))
 * static forUser = scope((q, userId: number) => q.where('userId', userId))
 */
export function scope(fn: ScopeFn): ScopeFn {
  return fn
}


function createHookDecorator(event: HookEvent) {
  return function () {
    return function (target: (...args: any[]) => any, context: ClassMethodDecoratorContext) {
      context.addInitializer(function (this: any) {
        // dynamic model property: hook storage keyed by symbol, not statically typed on the class
        if (!Object.hasOwn(this, HOOKS)) this[HOOKS] = {}
        if (!this[HOOKS][event]) this[HOOKS][event] = []
        this[HOOKS][event].push(target)
      })
    }
  }
}

/** Runs before a new record is inserted */
export const beforeCreate = createHookDecorator('beforeCreate')
/** Runs after a new record is inserted */
export const afterCreate = createHookDecorator('afterCreate')
/** Runs before an existing record is updated */
export const beforeUpdate = createHookDecorator('beforeUpdate')
/** Runs after an existing record is updated */
export const afterUpdate = createHookDecorator('afterUpdate')
/** Runs before any create or update operation */
export const beforeSave = createHookDecorator('beforeSave')
/** Runs after any create or update operation */
export const afterSave = createHookDecorator('afterSave')
/** Runs before a record is deleted */
export const beforeDelete = createHookDecorator('beforeDelete')
/** Runs after a record is deleted */
export const afterDelete = createHookDecorator('afterDelete')
/** Runs before a single record is fetched */
export const beforeFind = createHookDecorator('beforeFind')
/** Runs after a single record is fetched */
export const afterFind = createHookDecorator('afterFind')
/** Runs before multiple records are fetched */
export const beforeFetch = createHookDecorator('beforeFetch')
/** Runs after multiple records are fetched */
export const afterFetch = createHookDecorator('afterFetch')
/** Runs before paginate() */
export const beforePaginate = createHookDecorator('beforePaginate')
/** Runs after paginate() */
export const afterPaginate = createHookDecorator('afterPaginate')


const _tables = new Map<typeof BaseModel, any>()
const _sqls = new Map<typeof BaseModel, string>()
const HOOKS = Symbol('hooks')
const SKIP_TS = Symbol('skipTimestamps')


function getDb() {

  const { getApp } = require('@tekir/core')
  return getApp().use('db')
}

function db(m: typeof BaseModel) {
  // A model may be bound explicitly, which is useful for multi-app processes,
  // workers, and tests where a process-global application container is not a
  // safe source of request-independent database state.
  const d = m.database ?? getDb()
  return m.connection ? d.connection(m.connection) : d
}
function whereEq(m: typeof BaseModel, col: string, val: any) { return eq(m.$table[col], val) }
function multiWhere(m: typeof BaseModel, search: Record<string, any>) {
  const conditions = Object.entries(search).map(([k, v]) => eq(m.$table[k], v))
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}
async function runHooks(m: typeof BaseModel, event: string, arg: unknown) {
  // Decorator-registered hooks (symbol key)
  for (const fn of ((m as any)[HOOKS]?.[event] as HookFn[] | undefined) || []) await fn(arg)
  // Static hooks property (decorator-free)
  for (const fn of (m.hooks?.[event] || [])) await fn(arg)
}
function addTimestamps(m: typeof BaseModel, values: Record<string, unknown>, isCreate: boolean) {
  if ((m as any)[SKIP_TS]) return values
  const now = new Date().toISOString()

  // New: static timestamps = true → auto-handle createdAt/updatedAt
  if (m.timestamps) {
    if (isCreate && !values.createdAt) values.createdAt = now
    values.updatedAt = now
  }

  // Legacy: schema-based autoCreate/autoUpdate
  for (const [name, def] of Object.entries(m.schema)) {
    if (isCreate && def.autoCreate && !values[name]) values[name] = now
    if (def.autoUpdate) values[name] = now
  }
  return values
}
function hiddenSet(m: typeof BaseModel): Set<string> {
  const set = new Set<string>(m.hidden)
  // Legacy: schema-based hidden
  for (const [name, def] of Object.entries(m.schema)) {
    if (def.hidden || def.serializeAs === null) set.add(name)
  }
  return set
}
function applyCasts(m: typeof BaseModel, row: Record<string, unknown>): Record<string, unknown> {
  for (const [name, def] of Object.entries(m.schema)) {
    if (def.cast && row[name] !== undefined) row[name] = applyCast(row[name], def.cast)
  }
  for (const [name, cast] of Object.entries(m.casts)) {
    if (row[name] !== undefined) row[name] = applyCast(row[name], cast)
  }
  return row
}
function serializeCasts(m: typeof BaseModel, values: Record<string, unknown>): Record<string, unknown> {
  for (const [name, def] of Object.entries(m.schema)) {
    if (def.cast && values[name] !== undefined) values[name] = serializeCast(values[name], def.cast)
  }
  for (const [name, cast] of Object.entries(m.casts)) {
    if (values[name] !== undefined) values[name] = serializeCast(values[name], cast)
  }
  return values
}
function filterMassAssignment(m: typeof BaseModel, values: Record<string, unknown>): Record<string, unknown> {
  if (m.fillable) {
    const allowed = new Set(m.fillable)
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) { if (allowed.has(k)) filtered[k] = v }
    return filtered
  }
  if (m.guarded) {
    const blocked = new Set(m.guarded)
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) { if (!blocked.has(k)) filtered[k] = v }
    return filtered
  }
  return values
}
function baseQuery(m: typeof BaseModel) {
  let q = db(m).select().from(m.$table)
  if (m.softDeletes) q = q.where(isNull(m.$table.deletedAt))
  for (const fn of Object.values(m.globalScopes)) fn(q)
  return q
}
async function touchParents(instance: BaseModel): Promise<void> {
  const ctor = instance.constructor as typeof BaseModel
  for (const relationName of ctor.touches) {
    const rel = ctor.relations?.[relationName]
    if (!rel || rel.type !== 'belongsTo') continue
    const related = rel.model()
    const parentFk = rel.foreignKey || `${relationName}Id`
    const parentId = (instance as any)[parentFk] // dynamic model property
    if (parentId) {
      const now = new Date().toISOString()
      const updates: Record<string, unknown> = {}
      // New: static timestamps
      if (related.timestamps) updates.updatedAt = now
      // Legacy: schema-based autoUpdate
      for (const [name, def] of Object.entries(related.schema)) {
        if (def.autoUpdate) updates[name] = now
      }
      if (Object.keys(updates).length > 0) {
        db(related).update(related.$table).set(updates)
          .where(eq(related.$table[related.primaryKey], parentId)).run()
      }
    }
  }
}
function hydrate<T extends typeof BaseModel>(m: T, row: Record<string, unknown>): InstanceType<T> {
  const instance = new m() as InstanceType<T>
  const casted = applyCasts(m, { ...row })
  Object.assign(instance, casted)
  instance.$original = { ...casted }
  instance.$isPersisted = true
  return instance
}

/**
 * Base class for all Tekir models. Extend this to define your models.
 *
 * @example
 * ```ts
 * import { BaseModel, column, hasMany, scope, beforeSave } from '@tekir/db'
 *
 * export class User extends BaseModel {
 *   static table = 'users'
 *   static schema = {
 *     id: column.id(),
 *     name: column.string(),
 *     email: column.string({ unique: true }),
 *     password: column.string({ hidden: true }),
 *     role: column.string({ default: 'user' }),
 *     isActive: column.boolean({ default: 1 }),
 *     metadata: column.json({ nullable: true }),
 *     createdAt: column.dateTime({ autoCreate: true }),
 *     updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
 *   }
 *
 *   static fillable = ['name', 'email', 'password', 'role']
 *   static relations = { posts: hasMany(() => Post) }
 *   static admins = scope((q) => q.where('role', 'admin'))
 *   static appends = ['fullName']
 *
 *   get fullName() { return `${this.firstName} ${this.lastName}` }
 *
 *   ＠beforeSave()
 *   static async hashPassword(user: User) {
 *     if (user.$dirty.password) {
 *       user.password = await Bun.password.hash(user.password)
 *     }
 *   }
 * }
 * ```
 */
export class BaseModel {
  // ── Static Configuration ──────────────────────────────

  /** Database table name */
  static table: string
  /** Column schema definitions (legacy — use migrations + declare instead) */
  static schema: ModelSchema = {}
  /**
   * Fields excluded from serialization (toJSON).
   * @example static hidden = ['password', 'secret']
   */
  static hidden: string[] = []
  /**
   * Auto-manage createdAt and updatedAt timestamps.
   * @example static timestamps = true
   */
  static timestamps = false
  /** Relationship definitions */
  static relations: Record<string, Relation> = {}
  /** Primary key column name */
  static primaryKey = 'id'
  /** Database connection name (optional) */
  static connection?: string
  /** Explicit database manager override; otherwise the app container is used. */
  static database?: any

  /** Bind this model (and subclasses that inherit the binding) to a database manager. */
  static useDatabase(database: any): typeof BaseModel {
    this.database = database
    return this
  }

  /**
   * Enable soft deletes. Requires a `deletedAt` column in schema.
   * @example
   * static softDeletes = true
   * // schema must include: deletedAt: column.dateTime({ nullable: true })
   */
  static softDeletes = false

  /**
   * Whitelist of mass-assignable attributes. If set, only these columns can be
   * passed to `create()`, `fill()`, and `merge()`.
   * @example
   * static fillable = ['name', 'email', 'password']
   */
  static fillable?: string[]

  /**
   * Blacklist of non-assignable attributes. Opposite of `fillable`.
   * If `fillable` is set, `guarded` is ignored.
   * @example
   * static guarded = ['id', 'role']
   */
  static guarded?: string[]

  /**
   * Attribute casting. Automatically converts values when reading from DB.
   * Column-level `cast` in schema takes precedence.
   * @example
   * static casts = { isActive: 'boolean', metadata: 'json', score: 'float' }
   */
  static casts: Record<string, CastType> = {}

  /**
   * Computed attributes to include in serialization.
   * Define matching getter methods on the class.
   * @example
   * static appends = ['fullName']
   * get fullName() { return `${this.firstName} ${this.lastName}` }
   */
  static appends: string[] = []

  /**
   * Lifecycle hooks — decorator-free alternative to @beforeSave etc.
   * @example
   * static hooks = {
   *   beforeSave: [async (user) => { user.password = await hash(user.password) }],
   *   afterCreate: [async (user) => { await sendWelcomeEmail(user) }]
   * }
   */
  static hooks: Partial<Record<string, HookFn[]>> = {}

  /**
   * Global scopes automatically applied to every query.
   * @example
   * static globalScopes = { active: (q) => q.where('isActive', 1) }
   */
  static globalScopes: Record<string, ScopeFn> = {}

  /**
   * Parent relationships to touch (update timestamps) when this model is saved.
   * @example
   * static touches = ['post'] // updates post.updatedAt when comment is saved
   */
  static touches: string[] = []

  // ── Computed Static Properties ────────────────────────

  /** Drizzle table reference (lazy, per-subclass) */
  static get $table(): any {
    if (!_tables.has(this)) _tables.set(this, buildDrizzleTable(this.table, this.schema))
    return _tables.get(this)
  }

  /**
   * Resolve a Drizzle column by name, validating it against the table's schema.
   * Guards aggregate/column helpers (sum, pluck, increment, ...) from being
   * handed an unknown column that would otherwise pass `undefined` to Drizzle.
   */
  protected static $column(col: string): any {
    const table = this.$table
    const c = table[col]
    if (!c) throw new Error(`Unknown column "${col}" on ${this.name}`)
    return c
  }

  /** Raw CREATE TABLE SQL for in-memory databases */
  static get createSQL(): string {
    if (!_sqls.has(this)) _sqls.set(this, buildCreateSQL(this.table, this.schema))
    return _sqls.get(this) as string
  }

  // ── Instance Properties ───────────────────────────────

  /** Whether this instance exists in the database */
  $isPersisted = false
  /** Snapshot of values when loaded from DB */
  $original: Record<string, unknown> = {}
  /** Attributes that changed on the last save */
  $changes: Record<string, unknown> = {}
  /** Temporary hidden overrides (instance-level) */
  $hiddenOverrides: Set<string> | null = null
  /** Temporary visible overrides (instance-level) */
  $visibleOverrides: Set<string> | null = null

  /** Get changed attributes since load */
  get $dirty(): Record<string, unknown> {
    const dirty: Record<string, unknown> = {}
    for (const key of Object.keys(this.$original)) {
      // dynamic model property: accessing schema-defined column by string key
      if ((this as any)[key] !== this.$original[key]) dirty[key] = (this as any)[key]
    }
    return dirty
  }

  /** Check if any attributes (or a specific one) have changed since load */
  get $isDirty(): boolean {
    return Object.keys(this.$dirty).length > 0
  }

  /** Opposite of `$isDirty` */
  get $isClean(): boolean {
    return !this.$isDirty
  }

  // ── Static Read Methods ───────────────────────────────

  /** Get the raw Drizzle query builder (bypasses global scopes and soft deletes) */
  static query() {
    return db(this).select().from(this.$table)
  }

  /**
   * Fetch all records (respects soft deletes and global scopes)
   * @example
   * const users = await User.all()
   */
  static async all<T extends typeof BaseModel>(this: T): Promise<InstanceType<T>[]> {
    await runHooks(this,'beforeFetch', null)
    const rows = baseQuery(this).all()
    await runHooks(this,'afterFetch', rows)
    return rows.map((r: Record<string, unknown>) => hydrate(this,r))
  }

  /**
   * Find a record by primary key, returns `null` if not found
   * @example
   * const user = await User.find(1)
   */
  static async find<T extends typeof BaseModel>(this: T, id: number | string): Promise<InstanceType<T> | null> {
    await runHooks(this,'beforeFind', id)
    const q = baseQuery(this).where(eq(this.$table[this.primaryKey], id))
    const row = q.get()
    if (!row) return null
    await runHooks(this,'afterFind', row)
    return hydrate(this,row)
  }

  /**
   * Find a record by primary key, throws `ModelNotFoundError` if not found
   * @example
   * const user = await User.findOrFail(1)
   */
  static async findOrFail<T extends typeof BaseModel>(this: T, id: number | string): Promise<InstanceType<T>> {
    const row = await (this as T).find(id) as InstanceType<T> | null
    if (!row) throw new ModelNotFoundError(this.table)
    return row
  }

  /**
   * Find a record by a specific column value
   * @example
   * const user = await User.findBy('email', 'ali@tekir.dev')
   */
  static async findBy<T extends typeof BaseModel>(this: T, col: string, value: unknown): Promise<InstanceType<T> | null> {
    await runHooks(this,'beforeFind', { col, value })
    const row = baseQuery(this).where(whereEq(this,col, value)).get()
    if (!row) return null
    await runHooks(this,'afterFind', row)
    return hydrate(this,row)
  }

  /**
   * Find a record by column value, throws `ModelNotFoundError` if not found
   * @example
   * const user = await User.findByOrFail('email', 'ali@tekir.dev')
   */
  static async findByOrFail<T extends typeof BaseModel>(this: T, col: string, value: unknown): Promise<InstanceType<T>> {
    const row = await (this as T).findBy(col, value) as InstanceType<T> | null
    if (!row) throw new ModelNotFoundError(this.table)
    return row
  }

  /**
   * Find multiple records by their primary keys
   * @example
   * const users = await User.findMany([1, 2, 3])
   */
  static async findMany<T extends typeof BaseModel>(this: T, ids: (number | string)[]): Promise<InstanceType<T>[]> {
    await runHooks(this,'beforeFetch', ids)
    const rows = baseQuery(this).where(inArray(this.$table[this.primaryKey], ids)).all()
    await runHooks(this,'afterFetch', rows)
    return rows.map((r: Record<string, unknown>) => hydrate(this,r))
  }

  /**
   * Find multiple records matching a column value
   * @example
   * const published = await Post.findManyBy('status', 'published')
   */
  static async findManyBy<T extends typeof BaseModel>(this: T, col: string, value: unknown): Promise<InstanceType<T>[]> {
    await runHooks(this,'beforeFetch', { col, value })
    const rows = baseQuery(this).where(whereEq(this,col, value)).all()
    await runHooks(this,'afterFetch', rows)
    return rows.map((r: Record<string, unknown>) => hydrate(this,r))
  }

  /**
   * Fetch the first record, returns `null` if empty
   * @example
   * const first = await User.first()
   */
  static async first<T extends typeof BaseModel>(this: T): Promise<InstanceType<T> | null> {
    await runHooks(this,'beforeFind', null)
    const row = baseQuery(this).limit(1).get()
    if (!row) return null
    await runHooks(this,'afterFind', row)
    return hydrate(this,row)
  }

  /**
   * Fetch the first record, throws `ModelNotFoundError` if empty
   * @example
   * const first = await User.firstOrFail()
   */
  static async firstOrFail<T extends typeof BaseModel>(this: T): Promise<InstanceType<T>> {
    const row = await (this as T).first() as InstanceType<T> | null
    if (!row) throw new ModelNotFoundError(this.table)
    return row
  }

  /**
   * Start a where clause and return the query builder
   * @example
   * const admins = User.where('role', 'admin').all()
   */
  static where(col: string, value: unknown) {
    return baseQuery(this).where(whereEq(this,col, value))
  }

  /**
   * Count records (respects soft deletes and global scopes)
   * @example
   * const total = await User.count()
   */
  static async count(): Promise<number> {
    let q = db(this).select({ value: countFn() }).from(this.$table)
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? 0
  }

  /**
   * Count records matching a column value
   * @example
   * const published = await Post.countBy('status', 'published')
   */
  static async countBy(col: string, value: unknown): Promise<number> {
    let q = db(this).select({ value: countFn() }).from(this.$table).where(whereEq(this, col, value))
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? 0
  }

  /**
   * Check if a record with the given column value exists
   * @example
   * if (await User.exists('email', 'ali@tekir.dev')) { ... }
   */
  static async exists(col: string, value: unknown): Promise<boolean> {
    return !!baseQuery(this).where(whereEq(this,col, value)).get()
  }

  // ── Aggregates ────────────────────────────────────────

  /**
   * Get the sum of a column
   * @example
   * const total = await Order.sum('amount')
   */
  static async sum(col: string): Promise<number> {
    let q = db(this).select({ value: sumFn(this.$column(col)) }).from(this.$table)
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? 0
  }

  /**
   * Get the average of a column
   * @example
   * const avg = await Product.avg('price')
   */
  static async avg(col: string): Promise<number> {
    let q = db(this).select({ value: avgFn(this.$column(col)) }).from(this.$table)
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? 0
  }

  /**
   * Get the minimum value of a column
   * @example
   * const cheapest = await Product.min('price')
   */
  static async min(col: string): Promise<unknown> {
    let q = db(this).select({ value: minFn(this.$column(col)) }).from(this.$table)
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? null
  }

  /**
   * Get the maximum value of a column
   * @example
   * const most = await Product.max('price')
   */
  static async max(col: string): Promise<unknown> {
    let q = db(this).select({ value: maxFn(this.$column(col)) }).from(this.$table)
    if (this.softDeletes) q = q.where(isNull(this.$table.deletedAt))
    return q.get()?.value ?? null
  }

  // ── Bulk Read Methods ─────────────────────────────────

  /**
   * Paginate records with metadata
   * @example
   * const result = await Post.paginate(1, 10)
   */
  static async paginate<T extends typeof BaseModel>(this: T, page: number, perPage: number) {
    // Clamp to safe bounds so the computed OFFSET can never go negative and
    // perPage is always a positive integer, while keeping lenient legacy behavior
    // (page 0 / NaN falls back to the first page).
    const p = Number.isFinite(page) && Math.floor(page) >= 1 ? Math.floor(page) : 1
    const pp = Number.isFinite(perPage) && Math.floor(perPage) >= 1 ? Math.floor(perPage) : 20
    await runHooks(this, 'beforePaginate', { page: p, perPage: pp })
    let countQ = db(this).select({ value: countFn() }).from(this.$table)
    if (this.softDeletes) countQ = countQ.where(isNull(this.$table.deletedAt))
    const total = countQ.get()?.value ?? 0
    const rows = baseQuery(this).limit(pp).offset((p - 1) * pp).all()
    const lastPage = total === 0 ? 0 : Math.ceil(total / pp)
    const result = {
      data: rows.map((r: Record<string, unknown>) => hydrate(this,r)) as InstanceType<T>[],
      meta: { total, page: p, perPage: pp, lastPage, hasMore: p < lastPage },
    }
    await runHooks(this, 'afterPaginate', result)
    return result
  }

  /**
   * Extract a single column's values as an array
   * @example
   * const emails = await User.pluck('email')  // ['ali@tekir.dev', 'veli@tekir.dev']
   */
  static async pluck(col: string): Promise<unknown[]> {
    const rows = baseQuery(this).all()
    return rows.map((r: Record<string, unknown>) => r[col])
  }

  /**
   * Process records in chunks to avoid memory issues with large datasets
   * @example
   * await User.chunk(100, async (users) => {
   *   for (const user of users) { ... }
   * })
   */
  static async chunk<T extends typeof BaseModel>(this: T, size: number, callback: (records: InstanceType<T>[]) => void | Promise<void>): Promise<void> {
    let page = 1
    while (true) {
      const rows = baseQuery(this).limit(size).offset((page - 1) * size).all()
      if (rows.length === 0) break
      const instances = rows.map((r: Record<string, unknown>) => hydrate(this,r)) as InstanceType<T>[]
      await callback(instances)
      if (rows.length < size) break
      page++
    }
  }

  // ── Soft Delete Queries ───────────────────────────────

  /**
   * Query including soft-deleted records
   * @example
   * const allUsers = await User.withTrashed().all()
   */
  static withTrashed() {
    return db(this).select().from(this.$table)
  }

  /**
   * Query only soft-deleted records
   * @example
   * const deleted = await User.onlyTrashed().all()
   */
  static onlyTrashed() {
    return db(this).select().from(this.$table)
      .where(isNotNull(this.$table.deletedAt))
  }

  // ── Static Write Methods ──────────────────────────────

  /**
   * Insert a new record and return the model instance
   * @example
   * const user = await User.create({ name: 'Ali', email: 'ali@tekir.dev' })
   */
  static async create<T extends typeof BaseModel>(this: T, values: Record<string, unknown>): Promise<InstanceType<T>> {
    let v = filterMassAssignment(this,{ ...values })
    v = serializeCasts(this,v)
    v = addTimestamps(this,v, true)
    await runHooks(this,'beforeSave', v)
    await runHooks(this,'beforeCreate', v)
    const row = db(this).insert(this.$table).values(v).returning().get()
    await runHooks(this,'afterCreate', row)
    await runHooks(this,'afterSave', row)
    return hydrate(this,row)
  }

  /**
   * Insert multiple records and return model instances
   * @example
   * const users = await User.createMany([{ name: 'Ali' }, { name: 'Veli' }])
   */
  static async createMany<T extends typeof BaseModel>(this: T, values: Record<string, unknown>[]): Promise<InstanceType<T>[]> {
    const rows: InstanceType<T>[] = []
    for (const v of values) rows.push(await (this as T).create(v))
    return rows
  }

  /**
   * Update a record by primary key and return the updated instance
   * @example
   * const user = await User.update(1, { name: 'Updated' })
   */
  static async update<T extends typeof BaseModel>(this: T, id: number | string, values: Record<string, unknown>): Promise<InstanceType<T>> {
    let v = filterMassAssignment(this,{ ...values })
    v = serializeCasts(this,v)
    v = addTimestamps(this,v, false)
    await runHooks(this,'beforeSave', v)
    await runHooks(this,'beforeUpdate', v)
    const row = db(this).update(this.$table).set(v).where(eq(this.$table[this.primaryKey], id)).returning().get()
    await runHooks(this,'afterUpdate', row)
    await runHooks(this,'afterSave', row)
    return hydrate(this,row)
  }

  /**
   * Update multiple records matching a where condition
   * @example
   * await Post.updateWhere(eq(Post.$table.status, 'draft'), { status: 'published' })
   */
  static async updateWhere(where: unknown, values: Record<string, unknown>) {
    let v = serializeCasts(this,{ ...values })
    v = addTimestamps(this,v, false)
    return db(this).update(this.$table).set(v).where(where).run()
  }

  /**
   * Increment a column value by amount
   * @example
   * await Post.increment(1, 'views')
   * await Post.increment(1, 'views', 5)
   */
  static async increment(id: number | string, col: string, amount = 1): Promise<void> {
    const column = this.$column(col)
    db(this).update(this.$table)
      .set({ [col]: sql`${column} + ${amount}` })
      .where(eq(this.$table[this.primaryKey], id)).run()
  }

  /**
   * Decrement a column value by amount
   * @example
   * await Product.decrement(1, 'stock')
   * await Product.decrement(1, 'stock', 3)
   */
  static async decrement(id: number | string, col: string, amount = 1): Promise<void> {
    const column = this.$column(col)
    db(this).update(this.$table)
      .set({ [col]: sql`${column} - ${amount}` })
      .where(eq(this.$table[this.primaryKey], id)).run()
  }

  /**
   * Delete a record by primary key (soft delete if enabled)
   * @example
   * await User.destroy(1)
   */
  static async destroy(id: number | string): Promise<void> {
    await runHooks(this,'beforeDelete', { id })
    if (this.softDeletes) {
      db(this).update(this.$table)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(this.$table[this.primaryKey], id)).run()
    } else {
      db(this).delete(this.$table).where(eq(this.$table[this.primaryKey], id)).run()
    }
    await runHooks(this,'afterDelete', { id })
  }

  /**
   * Delete multiple records matching a where condition
   * @example
   * await Post.destroyWhere(eq(Post.$table.status, 'draft'))
   */
  static async destroyWhere(where: unknown): Promise<void> {
    if (this.softDeletes) {
      db(this).update(this.$table).set({ deletedAt: new Date().toISOString() }).where(where).run()
    } else {
      db(this).delete(this.$table).where(where).run()
    }
  }

  /**
   * Delete all records from the table
   * @example
   * await Post.truncate()
   */
  static async truncate(): Promise<void> {
    db(this).delete(this.$table).run()
  }

  /**
   * Run a callback without updating timestamps
   * @example
   * await User.withoutTimestamps(async () => {
   *   await User.increment(1, 'loginCount')
   * })
   */
  static async withoutTimestamps<R>(fn: () => R | Promise<R>): Promise<R> {
    // dynamic model property: SKIP_TS stored under symbol key, not in static type
    (this as any)[SKIP_TS] = true
    try { return await fn() } finally { (this as any)[SKIP_TS] = false }
  }

  // ── Idempotent Methods ────────────────────────────────

  /**
   * Find the first record matching `search`, or create one
   * @example
   * const user = await User.firstOrCreate({ email: 'ali@tekir.dev' }, { name: 'Ali' })
   */
  static async firstOrCreate<T extends typeof BaseModel>(this: T, search: Record<string, unknown>, create: Record<string, unknown> = {}): Promise<InstanceType<T>> {
    const existing = baseQuery(this).where(multiWhere(this,search)).get()
    if (existing) return hydrate(this, existing as Record<string, unknown>)
    return (this as T).create({ ...search, ...create })
  }

  /**
   * Find and update, or create a new record
   * @example
   * const user = await User.updateOrCreate({ email: 'ali@tekir.dev' }, { name: 'Updated' })
   */
  static async updateOrCreate<T extends typeof BaseModel>(this: T, search: Record<string, unknown>, values: Record<string, unknown>): Promise<InstanceType<T>> {
    const existing = baseQuery(this).where(multiWhere(this,search)).get() as Record<string, unknown> | undefined
    if (existing) return (this as T).update(existing[this.primaryKey] as number | string, values)
    return (this as T).create({ ...search, ...values })
  }

  /**
   * Find matching record, or return an unpersisted instance.
   * @example
   * const user = await User.firstOrNew({ email: 'ali@tekir.dev' })
   * if (!user.$isPersisted) await user.save()
   */
  static async firstOrNew<T extends typeof BaseModel>(this: T, search: Record<string, unknown>, defaults: Record<string, unknown> = {}): Promise<InstanceType<T>> {
    const existing = baseQuery(this).where(multiWhere(this,search)).get()
    if (existing) return hydrate(this, existing as Record<string, unknown>)
    const instance = new this() as InstanceType<T>
    Object.assign(instance, { ...search, ...defaults })
    return instance
  }

  // ── Scopes ────────────────────────────────────────────

  /**
   * Apply a named scope and return the query builder
   * @example
   * const admins = await User.withScope('admins').all()
   */
  static withScope(name: string, ...args: unknown[]) {
    // dynamic model property: scope looked up by name on the class
    const fn = (this as any)[name] as ScopeFn | undefined
    if (!fn || typeof fn !== 'function') throw new Error(`Scope "${name}" not defined on ${this.table}`)
    const q = baseQuery(this)
    fn(q, ...args)
    return q
  }

  // ── Relationships (Static) ────────────────────────────

  /**
   * Eager-load a relationship onto a model instance
   * @example
   * await User.preload(user, 'posts')
   */
  static async preload(instance: BaseModel, relationName: string, constraint?: (q: unknown) => void): Promise<BaseModel> {
    const rel = this.relations?.[relationName]
    if (!rel) return instance

    // dynamic model property: accessing relation key and foreign key by string on the instance
    const inst = instance as any
    const related = rel.model()
    const fk = rel.foreignKey || `${this.table.replace(/s$/, '')}Id`
    const lk = rel.localKey || this.primaryKey

    if (rel.type === 'hasOne') {
      const q = db(this).select().from(related.$table).where(eq(related.$table[fk], inst[lk]))
      if (constraint) constraint(q)
      let result = q.get() ?? null
      if (!result && rel.withDefault) {
        result = rel.withDefault === true ? {} : { ...rel.withDefault }
      }
      inst[relationName] = result
    } else if (rel.type === 'hasMany') {
      const q = db(this).select().from(related.$table).where(eq(related.$table[fk], inst[lk]))
      if (constraint) constraint(q)
      inst[relationName] = q.all()
    } else if (rel.type === 'belongsTo') {
      const parentFk = rel.foreignKey || `${relationName}Id`
      let result = db(this).select().from(related.$table)
        .where(eq(related.$table[related.primaryKey], inst[parentFk])).get() ?? null
      if (!result && rel.withDefault) {
        result = rel.withDefault === true ? {} : { ...rel.withDefault }
      }
      inst[relationName] = result
    }

    return instance
  }

  /**
   * Eager-load a relationship onto multiple instances
   * @example
   * await User.preloadAll(users, 'posts')
   */
  static async preloadAll(instances: BaseModel[], relationName: string, constraint?: (q: unknown) => void): Promise<BaseModel[]> {
    for (const inst of instances) await this.preload(inst, relationName, constraint)
    return instances
  }

  // ── Static Serialization ──────────────────────────────

  /**
   * Serialize a model instance (static helper)
   * @example
   * User.serialize(user, { omit: ['email'] })
   */
  static serialize(instance: BaseModel, options?: SerializeOptions): Record<string, unknown> {
    return instance.serialize(options)
  }

  // ── Instance Methods ──────────────────────────────────

  /**
   * Persist the instance. Inserts if new, updates changed fields if existing.
   * @example
   * user.name = 'Updated'
   * await user.save()
   */
  async save(): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    if (this.$isPersisted) {
      const dirty = this.$dirty
      if (Object.keys(dirty).length === 0) return this
      this.$changes = { ...dirty }
      // dynamic model property: primaryKey is a string key on the instance
      const updated = await ctor.update((this as any)[ctor.primaryKey], dirty) // dynamic model property
      Object.assign(this, updated.$original)
      this.$original = { ...updated.$original }
    } else {
      const values: Record<string, unknown> = {}
      const keys = Object.keys(ctor.schema).length > 0
        ? Object.keys(ctor.schema)
        : Object.keys(this).filter(k => !k.startsWith('$'))
      for (const key of keys) {
        if (key === ctor.primaryKey) continue
        if ((this as any)[key] !== undefined) values[key] = (this as any)[key]
      }
      const created = await ctor.create(values)
      this.$changes = { ...values }
      Object.assign(this, created.$original)
      this.$original = { ...created.$original }
      this.$isPersisted = true
    }
    // Touch parent relations
    await touchParents(this)
    return this
  }

  /**
   * Merge attributes into the instance (does NOT persist)
   * @example
   * user.merge({ name: 'Ali', role: 'admin' })
   * await user.save()
   */
  merge(values: Record<string, unknown>): this {
    const ctor = this.constructor as typeof BaseModel
    Object.assign(this, filterMassAssignment(ctor,values))
    return this
  }

  /**
   * Replace all attributes except primary key (does NOT persist)
   * @example
   * user.fill({ name: 'Ali', email: 'ali@tekir.dev' })
   */
  fill(values: Record<string, unknown>): this {
    const ctor = this.constructor as typeof BaseModel
    const filtered = filterMassAssignment(ctor, values)
    for (const [key, val] of Object.entries(filtered)) {
      if (key === ctor.primaryKey) continue
      ;(this as any)[key] = val
    }
    return this
  }

  /**
   * Delete this instance (soft delete if enabled)
   * @example
   * await user.delete()
   */
  async delete(): Promise<void> {
    const ctor = this.constructor as typeof BaseModel
    await ctor.destroy((this as any)[ctor.primaryKey]) // dynamic model property
    this.$isPersisted = false
  }

  /**
   * Permanently delete this instance, bypassing soft deletes
   * @example
   * await user.forceDelete()
   */
  async forceDelete(): Promise<void> {
    const ctor = this.constructor as typeof BaseModel
    const id = (this as any)[ctor.primaryKey] // dynamic model property
    await runHooks(ctor,'beforeDelete', { id })
    db(ctor).delete(ctor.$table).where(eq(ctor.$table[ctor.primaryKey], id)).run()
    await runHooks(ctor,'afterDelete', { id })
    this.$isPersisted = false
  }

  /**
   * Restore a soft-deleted instance
   * @example
   * await user.restore()
   */
  async restore(): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    const id = (this as any)[ctor.primaryKey] // dynamic model property
    db(ctor).update(ctor.$table).set({ deletedAt: null }).where(eq(ctor.$table[ctor.primaryKey], id)).run()
    ;(this as any).deletedAt = null // dynamic model property
    this.$isPersisted = true
    return this
  }

  /** Check if this instance is soft-deleted */
  trashed(): boolean {
    return (this as any).deletedAt != null // dynamic model property
  }

  /**
   * Reload the instance from the database (returns a NEW instance)
   * @example
   * const freshUser = await user.fresh()
   */
  async fresh<T extends BaseModel>(this: T): Promise<T | null> {
    const ctor = this.constructor as typeof BaseModel
    return ctor.find((this as any)[ctor.primaryKey]) as Promise<T | null> // dynamic model property
  }

  /**
   * Reload the current instance from the database (mutates in-place)
   * @example
   * await user.refresh()
   * // user now has latest DB values
   */
  async refresh(): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    const row = db(ctor).select().from(ctor.$table)
      .where(eq(ctor.$table[ctor.primaryKey], (this as any)[ctor.primaryKey])).get() // dynamic model property
    if (row) {
      const casted = applyCasts(ctor, row as Record<string, unknown>)
      Object.assign(this, casted)
      this.$original = { ...casted }
    }
    return this
  }

  /**
   * Clone this instance without persisting. Excludes primary key and timestamps.
   * @example
   * const clone = user.replicate()
   * clone.email = 'new@email.com'
   * await clone.save()
   */
  replicate(except: string[] = []): this {
    const ctor = this.constructor as typeof BaseModel
    const instance = new (ctor as unknown as new () => this)()
    const excludeSet = new Set([ctor.primaryKey, ...except])

    // Also exclude timestamp columns
    for (const [name, def] of Object.entries(ctor.schema)) {
      if (def.autoCreate || def.autoUpdate) excludeSet.add(name)
    }

    for (const [key, value] of Object.entries(this)) {
      if (key.startsWith('$')) continue
      if (excludeSet.has(key)) continue
      ;(instance as any)[key] = value // dynamic model property
    }
    return instance
  }

  /**
   * Increment a column and persist immediately
   * @example
   * await post.increment('views')
   * await post.increment('views', 5)
   */
  async increment(col: string, amount = 1): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    await ctor.increment((this as any)[ctor.primaryKey], col, amount) // dynamic model property
    ;(this as any)[col] = (((this as any)[col] as number) || 0) + amount // dynamic model property
    this.$original[col] = (this as any)[col] // dynamic model property
    return this
  }

  /**
   * Decrement a column and persist immediately
   * @example
   * await product.decrement('stock')
   * await product.decrement('stock', 3)
   */
  async decrement(col: string, amount = 1): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    await ctor.decrement((this as any)[ctor.primaryKey], col, amount) // dynamic model property
    ;(this as any)[col] = (((this as any)[col] as number) || 0) - amount // dynamic model property
    this.$original[col] = (this as any)[col] // dynamic model property
    return this
  }

  /**
   * Check if a specific column (or any) changed on the last save
   * @example
   * await user.save()
   * user.wasChanged('name') // true if name was in the last save's dirty set
   */
  wasChanged(col?: string): boolean {
    if (col) return col in this.$changes
    return Object.keys(this.$changes).length > 0
  }

  /**
   * Check if a specific column (or all) is clean (unchanged since load)
   * @example
   * user.isDirty('name') // true if name changed
   * user.isClean('name') // true if name unchanged
   */
  isDirty(col?: string): boolean {
    if (col) return (this as any)[col] !== this.$original[col] // dynamic model property
    return this.$isDirty
  }

  isClean(col?: string): boolean {
    return !this.isDirty(col)
  }

  /**
   * Get original value of a column (before any changes)
   * @example
   * user.name = 'New'
   * user.getOriginal('name') // 'Old'
   */
  getOriginal(col?: string): unknown {
    if (col) return this.$original[col]
    return { ...this.$original }
  }

  /**
   * Eager-load a relationship onto this instance
   * @example
   * await user.load('posts')
   */
  async load(relationName: string, constraint?: (q: unknown) => void): Promise<this> {
    const ctor = this.constructor as typeof BaseModel
    await ctor.preload(this, relationName, constraint)
    return this
  }

  /**
   * Get a relationship query builder for this instance
   * @example
   * await user.related('posts').create({ title: 'Hello' })
   */
  related(relationName: string) {
    const ctor = this.constructor as typeof BaseModel
    const rel = ctor.relations?.[relationName]
    if (!rel) throw new Error(`Relation "${relationName}" not defined on ${ctor.table}`)
    const related = rel.model()
    const fk = rel.foreignKey || `${ctor.table.replace(/s$/, '')}Id`
    const id = (this as any)[ctor.primaryKey] // dynamic model property

    return {
      query() {
        return getDb().select().from(related.$table).where(eq(related.$table[fk], id))
      },
      async create(values: Record<string, unknown>) {
        return related.create({ ...values, [fk]: id })
      },
      async createMany(values: Record<string, unknown>[]) {
        return Promise.all(values.map((v) => related.create({ ...v, [fk]: id })))
      },
    }
  }

  /**
   * Temporarily make hidden attributes visible on this instance
   * @example
   * user.makeVisible(['password'])
   * user.toJSON() // now includes password
   */
  makeVisible(cols: string[]): this {
    this.$visibleOverrides = new Set(cols)
    return this
  }

  /**
   * Temporarily hide attributes on this instance
   * @example
   * user.makeHidden(['email'])
   * user.toJSON() // excludes email
   */
  makeHidden(cols: string[]): this {
    this.$hiddenOverrides = new Set(cols)
    return this
  }

  /**
   * Serialize to a plain object. Respects hidden, appends, and visibility overrides.
   * @example
   * user.serialize()
   * user.serialize({ omit: ['email'] })
   * user.serialize({ fields: ['id', 'name'] })
   */
  serialize(options?: SerializeOptions): Record<string, unknown> {
    const ctor = this.constructor as typeof BaseModel
    const result: Record<string, unknown> = {}
    const hidden = hiddenSet(ctor)
    const omitSet = new Set(options?.omit || [])
    const fields = options?.fields

    // Apply instance-level overrides
    if (this.$hiddenOverrides) {
      for (const col of this.$hiddenOverrides) hidden.add(col)
    }
    if (this.$visibleOverrides) {
      for (const col of this.$visibleOverrides) hidden.delete(col)
    }

    for (const [key, value] of Object.entries(this)) {
      if (key.startsWith('$')) continue
      if (hidden.has(key)) continue
      if (omitSet.has(key)) continue
      if (fields && !fields.includes(key)) continue
      result[key] = value
    }

    // Append computed attributes
    for (const key of ctor.appends) {
      const val = (this as any)[key] // dynamic model property: computed getter accessed by string key
      if (val !== undefined) result[key] = val
    }

    return result
  }

  /**
   * Serialize to JSON. Shorthand for `.serialize()`.
   * @example
   * return response.ok(user.toJSON())
   */
  toJSON(): Record<string, unknown> {
    return this.serialize()
  }
}

// Strips all BaseModel internals ($isPersisted, save, merge, etc.)
// Usage: type UserFields = ModelFields<User>
type BaseModelKeys = keyof BaseModel | '$isPersisted' | '$original' | '$changes' | '$dirty' | '$isDirty' | '$isClean' | '$hiddenOverrides' | '$visibleOverrides'
export type ModelFields<T extends BaseModel> = Omit<T, BaseModelKeys>
