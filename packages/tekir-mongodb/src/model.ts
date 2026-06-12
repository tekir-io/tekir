import type { MongoModelConfig, HookEvent, HookFn } from './types'
import { mongo, loadMongoose } from './connection'

type SchemaDefinition = Record<string, any>


const HOOKS = Symbol('hooks')

function createHookDecorator(event: HookEvent) {
  return function () {
    return function (target: (...args: any[]) => any, context: ClassMethodDecoratorContext) {
      context.addInitializer(function (this: any) {
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


async function runHooks(m: typeof BaseModel, event: HookEvent, arg: unknown) {
  // Decorator-registered hooks
  for (const fn of ((m as any)[HOOKS]?.[event] as HookFn[] | undefined) || []) await fn(arg)
  // Static hooks property (decorator-free)
  for (const fn of (m.hooks[event] || [])) await fn(arg)
}


/**
 * Recursively strip MongoDB query operators from an untrusted filter object.
 *
 * Keys that start with `$` (operators like `$ne`, `$gt`, `$where`, `$regex`,
 * `$function`) or contain a `.` (dotted path traversal) are dropped, and nested
 * objects are sanitized in place. This neutralizes NoSQL operator injection when
 * a raw `req.body`/`req.query` object is passed straight into a query method.
 *
 * Plain primitives, `Date`, `ObjectId`, arrays, and `null` are passed through so
 * legitimate equality filters keep working.
 */
function sanitizeFilter(value: any, depth = 0): any {
  if (depth > 16) return value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => sanitizeFilter(v, depth + 1))
  // Leave non-plain objects (Date, ObjectId, Buffer, etc.) untouched.
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const clean: Record<string, any> = {}
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) continue
    clean[key] = sanitizeFilter(value[key], depth + 1)
  }
  return clean
}


/**
 * Abstract base class for MongoDB models providing an Active Record-style API.
 *
 * Subclass `BaseModel` and define `schema`, `modelName`, and optionally `config`,
 * `hidden`, `fillable`, and `hooks` to create a fully featured model with CRUD,
 * soft deletes, pagination, and lifecycle hooks.
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   static modelName = 'User'
 *   static schema = { name: String, email: String }
 *   static fillable = ['name', 'email']
 *   static hidden = ['__v']
 * }
 *
 * const user = await User.create({ name: 'Alice', email: 'alice@example.com' })
 * const users = await User.find({ name: 'Alice' })
 * ```
 */
export class BaseModel {
  /** The Mongoose model name. Falls back to the class name if not set. */
  static modelName = ''
  /** Mongoose schema definition object. */
  static schema: SchemaDefinition = {}
  /** Model-level configuration (collection name, timestamps, soft deletes). */
  static config: MongoModelConfig = {}
  /** Fields excluded from `toJSON` output. */
  static hidden: string[] = []
  /** Fields allowed for mass assignment in `create` and `update`. Empty means all fields are allowed. */
  static fillable: string[] = []
  /** Programmatic lifecycle hooks (alternative to decorators). */
  static hooks: Partial<Record<HookEvent, HookFn[]>> = {}

  private static _model: any | null = null

  /**
   * Get or lazily create the underlying Mongoose model for this class.
   *
   * @returns The compiled Mongoose model.
   */
  static getModel(): any {
    if (this._model) return this._model

    const mongoose = loadMongoose()
    const { Schema } = mongoose

    const schemaOpts: any = {}
    if (this.config.timestamps !== false) schemaOpts.timestamps = true
    if (this.config.collection) schemaOpts.collection = this.config.collection

    if (this.config.softDeletes) {
      this.schema.deletedAt = { type: Date, default: null }
    }

    const mongooseSchema = new Schema(this.schema, schemaOpts)

    // Hidden fields — exclude from toJSON
    if (this.hidden.length > 0) {
      mongooseSchema.set('toJSON', {
        transform: (_doc: any, ret: any) => {
          for (const field of this.hidden) delete ret[field]
          delete ret.__v
          return ret
        },
      })
    } else {
      mongooseSchema.set('toJSON', {
        transform: (_doc: any, ret: any) => {
          delete ret.__v
          return ret
        },
      })
    }

    const name = this.modelName || this.name
    const conn = mongo.connection
    this._model = conn.models[name] || conn.model(name, mongooseSchema)
    return this._model
  }

  // ─── Query Methods ───────────────────────────────────────

  /**
   * Find documents matching a filter.
   *
   * @param filter - MongoDB query filter (default: `{}`).
   * @param options - Mongoose query options (e.g. `{ sort, limit }`).
   * @returns An array of matching plain objects.
   *
   * @example
   * ```ts
   * const admins = await User.find({ role: 'admin' })
   * ```
   */
  static async find(filter: any = {}, options?: any): Promise<any[]> {
    filter = sanitizeFilter(filter)
    await runHooks(this, 'beforeFetch', filter)
    const model = this.getModel()
    const query = this.config.softDeletes
      ? { ...filter, deletedAt: null }
      : filter
    const results = await model.find(query, null, options).lean()
    await runHooks(this, 'afterFetch', results)
    return results
  }

  /**
   * Find a single document by its `_id`.
   *
   * @param id - The document ID.
   * @returns The matching document, or `null` if not found (or soft-deleted).
   *
   * @example
   * ```ts
   * const user = await User.findById('507f1f77bcf86cd799439011')
   * ```
   */
  static async findById(id: string): Promise<any | null> {
    if (!this.isValidId(id)) return null
    await runHooks(this, 'beforeFind', id)
    const doc = await this.getModel().findById(id).lean()
    if (this.config.softDeletes && doc?.deletedAt) return null
    await runHooks(this, 'afterFind', doc)
    return doc
  }

  /**
   * Validate that a value is a usable document id, guarding against
   * operator-injection objects (`{$gt:''}`) and malformed ObjectId strings.
   */
  private static isValidId(id: unknown): boolean {
    if (typeof id !== 'string') return false
    const mongoose = loadMongoose()
    return mongoose.Types.ObjectId.isValid(id)
  }

  /**
   * Find the first document matching a filter.
   *
   * @param filter - MongoDB query filter.
   * @returns The matching document, or `null` if none found.
   *
   * @example
   * ```ts
   * const user = await User.findOne({ email: 'alice@example.com' })
   * ```
   */
  static async findOne(filter: any): Promise<any | null> {
    filter = sanitizeFilter(filter)
    await runHooks(this, 'beforeFind', filter)
    const query = this.config.softDeletes
      ? { ...filter, deletedAt: null }
      : filter
    const doc = await this.getModel().findOne(query).lean()
    await runHooks(this, 'afterFind', doc)
    return doc
  }

  /**
   * Find a document by ID, throwing an error if not found.
   *
   * @param id - The document ID.
   * @returns The matching document.
   * @throws If no document with the given ID exists.
   *
   * @example
   * ```ts
   * const user = await User.findOrFail('507f1f77bcf86cd799439011')
   * ```
   */
  static async findOrFail(id: string): Promise<any> {
    const doc = await this.findById(id)
    if (!doc) throw new Error(`${this.modelName || this.name} not found: ${id}`)
    return doc
  }

  // ─── Create / Update / Delete ────────────────────────────

  /**
   * Create a new document.
   *
   * @param data - The document data. Filtered through `fillable` if defined.
   * @returns The created document as a plain JSON object.
   *
   * @example
   * ```ts
   * const user = await User.create({ name: 'Alice', email: 'alice@example.com' })
   * ```
   */
  static async create(data: any): Promise<any> {
    const filtered = this.filterFillable(data)
    await runHooks(this, 'beforeSave', filtered)
    await runHooks(this, 'beforeCreate', filtered)
    const doc = await this.getModel().create(filtered)
    const json = doc.toJSON()
    await runHooks(this, 'afterCreate', json)
    await runHooks(this, 'afterSave', json)
    return json
  }

  /**
   * Create multiple documents in a single batch insert.
   *
   * @param items - Array of document data objects.
   * @returns An array of the created documents as plain JSON objects.
   *
   * @example
   * ```ts
   * const users = await User.createMany([
   *   { name: 'Alice' },
   *   { name: 'Bob' },
   * ])
   * ```
   */
  static async createMany(items: any[]): Promise<any[]> {
    const filtered = items.map((item) => this.filterFillable(item))
    for (const item of filtered) {
      await runHooks(this, 'beforeSave', item)
      await runHooks(this, 'beforeCreate', item)
    }
    const docs = await this.getModel().insertMany(filtered)
    const results = docs.map((d: any) => d.toJSON())
    for (const item of results) {
      await runHooks(this, 'afterCreate', item)
      await runHooks(this, 'afterSave', item)
    }
    return results
  }

  /**
   * Update a document by its ID.
   *
   * @param id - The document ID.
   * @param data - The fields to update. Filtered through `fillable` if defined.
   * @returns The updated document, or `null` if not found.
   *
   * @example
   * ```ts
   * const updated = await User.update('507f...', { name: 'Bob' })
   * ```
   */
  static async update(id: string, data: any): Promise<any | null> {
    const filtered = this.filterFillable(data)
    await runHooks(this, 'beforeSave', filtered)
    await runHooks(this, 'beforeUpdate', filtered)
    const doc = await this.getModel().findByIdAndUpdate(id, filtered, { new: true }).lean()
    await runHooks(this, 'afterUpdate', doc)
    await runHooks(this, 'afterSave', doc)
    return doc
  }

  /**
   * Update multiple documents matching a filter.
   *
   * @param filter - MongoDB query filter.
   * @param update - The update operations to apply.
   * @returns The number of documents modified.
   */
  static async updateMany(filter: any, update: any): Promise<number> {
    const result = await this.getModel().updateMany(sanitizeFilter(filter), this.sanitizeUpdate(update))
    return result.modifiedCount
  }

  /**
   * Delete a document by its ID. Uses soft delete if enabled.
   *
   * @param id - The document ID.
   * @returns `true` if a document was deleted, `false` otherwise.
   *
   * @example
   * ```ts
   * const deleted = await User.delete('507f...')
   * ```
   */
  static async delete(id: string): Promise<boolean> {
    await runHooks(this, 'beforeDelete', id)
    let result: any
    if (this.config.softDeletes) {
      result = await this.getModel().findByIdAndUpdate(id, { deletedAt: new Date() })
    } else {
      result = await this.getModel().findByIdAndDelete(id)
    }
    await runHooks(this, 'afterDelete', id)
    return !!result
  }

  /**
   * Delete multiple documents matching a filter. Uses soft delete if enabled.
   *
   * @param filter - MongoDB query filter.
   * @returns The number of documents deleted (or soft-deleted).
   */
  static async deleteMany(filter: any): Promise<number> {
    filter = sanitizeFilter(filter)
    if (this.config.softDeletes) {
      const result = await this.getModel().updateMany(filter, { deletedAt: new Date() })
      return result.modifiedCount
    }
    const result = await this.getModel().deleteMany(filter)
    return result.deletedCount
  }

  // ─── Soft Deletes ────────────────────────────────────────

  /**
   * Restore a soft-deleted document by clearing its `deletedAt` field.
   *
   * @param id - The document ID.
   * @returns `true` if a document was restored, `false` otherwise.
   * @throws If soft deletes are not enabled on this model.
   */
  static async restore(id: string): Promise<boolean> {
    if (!this.config.softDeletes) throw new Error('Soft deletes not enabled')
    const result = await this.getModel().findByIdAndUpdate(id, { deletedAt: null })
    return !!result
  }

  /**
   * Permanently delete a document, bypassing soft deletes.
   *
   * @param id - The document ID.
   * @returns `true` if a document was deleted, `false` otherwise.
   */
  static async forceDelete(id: string): Promise<boolean> {
    const result = await this.getModel().findByIdAndDelete(id)
    return !!result
  }

  /**
   * Find documents including soft-deleted ones.
   *
   * @param filter - MongoDB query filter (default: `{}`).
   * @returns An array of matching documents, including those with a `deletedAt` value.
   */
  static async withTrashed(filter: any = {}): Promise<any[]> {
    return this.getModel().find(sanitizeFilter(filter)).lean()
  }

  /**
   * Find only soft-deleted documents.
   *
   * @param filter - MongoDB query filter (default: `{}`).
   * @returns An array of soft-deleted documents.
   */
  static async onlyTrashed(filter: any = {}): Promise<any[]> {
    return this.getModel().find({ ...sanitizeFilter(filter), deletedAt: { $ne: null } }).lean()
  }

  // ─── Aggregation ─────────────────────────────────────────

  /**
   * Count documents matching a filter.
   *
   * @param filter - MongoDB query filter (default: `{}`).
   * @returns The number of matching documents (excluding soft-deleted if enabled).
   */
  static async count(filter: any = {}): Promise<number> {
    filter = sanitizeFilter(filter)
    const query = this.config.softDeletes ? { ...filter, deletedAt: null } : filter
    return this.getModel().countDocuments(query)
  }

  /**
   * Check whether at least one document matches a filter.
   *
   * @param filter - MongoDB query filter.
   * @returns `true` if a matching document exists.
   */
  static async exists(filter: any): Promise<boolean> {
    filter = sanitizeFilter(filter)
    const query = this.config.softDeletes ? { ...filter, deletedAt: null } : filter
    return !!(await this.getModel().exists(query))
  }

  /**
   * Get distinct values for a field across matching documents.
   *
   * @param field - The field name to get distinct values for.
   * @param filter - MongoDB query filter (default: `{}`).
   * @returns An array of distinct values.
   */
  static async distinct(field: string, filter: any = {}): Promise<any[]> {
    return this.getModel().distinct(field, sanitizeFilter(filter))
  }

  /**
   * Paginate documents matching a filter.
   *
   * @param filter - MongoDB query filter (default: `{}`).
   * @param page - The page number (1-based, default: `1`).
   * @param perPage - Number of documents per page (default: `20`).
   * @returns An object with `data`, `total`, `page`, `perPage`, and `lastPage`.
   *
   * @example
   * ```ts
   * const result = await User.paginate({ role: 'admin' }, 2, 10)
   * // { data: [...], total: 50, page: 2, perPage: 10, lastPage: 5 }
   * ```
   */
  static async paginate<T = any>(filter: any = {}, page = 1, perPage = 20): Promise<{
    data: T[]
    total: number
    page: number
    perPage: number
    lastPage: number
  }> {
    filter = sanitizeFilter(filter)
    page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
    perPage = Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : 20
    await runHooks(this, 'beforePaginate', { filter, page, perPage })
    const query = this.config.softDeletes ? { ...filter, deletedAt: null } : filter
    const [data, total] = await Promise.all([
      this.getModel().find(query).skip((page - 1) * perPage).limit(perPage).lean(),
      this.getModel().countDocuments(query),
    ])
    const result = {
      data: data as T[],
      total,
      page,
      perPage,
      lastPage: Math.ceil(total / perPage),
    }
    await runHooks(this, 'afterPaginate', result)
    return result
  }

  // ─── Raw Mongoose Access ─────────────────────────────────

  /**
   * Execute a raw Mongoose aggregation pipeline.
   *
   * @param pipeline - The MongoDB aggregation pipeline stages.
   * @returns The Mongoose aggregation result.
   */
  static aggregate(pipeline: any[]) {
    return this.getModel().aggregate(pipeline)
  }

  /**
   * Get the underlying Mongoose model for advanced queries.
   *
   * @returns The compiled Mongoose model instance.
   */
  static query() {
    return this.getModel()
  }

  // ─── Helpers ─────────────────────────────────────────────

  private static filterFillable(data: any): any {
    if (this.fillable.length === 0) return data
    const filtered: any = {}
    for (const key of this.fillable) {
      if (key in data) filtered[key] = data[key]
    }
    return filtered
  }

  /**
   * Neutralize operator injection in an `updateMany` payload.
   *
   * A plain field map (no `$` keys) is wrapped in `$set` so untrusted input can
   * only set fields, never inject `$rename`/`$unset`/`$where`. When the developer
   * supplies an explicit operator document, only known-safe update operators are
   * kept and their field maps are sanitized.
   */
  private static sanitizeUpdate(update: any): any {
    if (update === null || typeof update !== 'object' || Array.isArray(update)) {
      return { $set: {} }
    }
    const keys = Object.keys(update)
    const hasOperator = keys.some((k) => k.startsWith('$'))
    if (!hasOperator) {
      return { $set: sanitizeFilter(update) }
    }
    const allowed = new Set(['$set', '$inc', '$push', '$pull', '$addToSet', '$min', '$max', '$mul', '$currentDate'])
    const clean: Record<string, any> = {}
    for (const op of keys) {
      if (!allowed.has(op)) continue
      clean[op] = sanitizeFilter(update[op])
    }
    return clean
  }
}

export { sanitizeFilter }
