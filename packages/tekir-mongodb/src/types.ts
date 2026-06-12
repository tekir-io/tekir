/** Configuration for connecting to a MongoDB instance. */
export interface MongoConfig {
  /** MongoDB connection URI (e.g. `'mongodb://localhost:27017/mydb'`). */
  uri: string
  /** Additional Mongoose connection options. */
  options?: Record<string, any>
  /** Enable Mongoose debug logging (default: `false`). */
  debug?: boolean
}

/** Per-model configuration options for {@link BaseModel}. */
export interface MongoModelConfig {
  /** Override the MongoDB collection name. */
  collection?: string
  /** Enable automatic `createdAt` / `updatedAt` fields (default: `true`). */
  timestamps?: boolean
  /** Enable soft deletes via a `deletedAt` field (default: `false`). */
  softDeletes?: boolean
}

/** Lifecycle hook events supported by {@link BaseModel}. */
export type HookEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' |
  'beforeSave' | 'afterSave' | 'beforeDelete' | 'afterDelete' |
  'beforeFind' | 'afterFind' | 'beforeFetch' | 'afterFetch' |
  'beforePaginate' | 'afterPaginate'

/** A lifecycle hook function invoked with the relevant document or filter argument. */
export type HookFn = (arg: unknown) => void | Promise<void>
