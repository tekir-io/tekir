import { hasOne, hasMany, belongsTo, manyToMany, type Relation } from '@tekir/db'

// Ensure the decorated class owns its own metadata collection rather than
// sharing (and mutating) one inherited from a parent model. Without this an
// `@hidden`/`@fillable` field declared on a subclass would leak into the
// parent and every sibling, which for `@fillable` breaks the mass-assignment
// boundary. When a parent already has the collection we shallow-copy it so the
// subclass still inherits the parent's fields.
function ownArray(ctor: any, key: string): string[] {
  if (!Object.hasOwn(ctor, key)) {
    const inherited = ctor[key]
    ctor[key] = Array.isArray(inherited) ? [...inherited] : []
  }
  return ctor[key]
}

function ownObject(ctor: any, key: string): Record<string, any> {
  if (!Object.hasOwn(ctor, key)) {
    const inherited = ctor[key]
    ctor[key] = inherited && typeof inherited === 'object' ? { ...inherited } : {}
  }
  return ctor[key]
}

// `hooks` maps an event to an array of handlers. Cloning the object alone would
// still share the per-event arrays with the parent, so each inherited array is
// copied too — a subclass extends its own copy without touching the parent's.
function ownHooks(ctor: any): Record<string, Function[]> {
  if (!Object.hasOwn(ctor, 'hooks')) {
    const inherited = ctor.hooks
    const next: Record<string, Function[]> = {}
    if (inherited && typeof inherited === 'object') {
      for (const ev of Object.keys(inherited)) next[ev] = [...inherited[ev]]
    }
    ctor.hooks = next
  }
  return ctor.hooks
}


type HookEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' |
  'beforeSave' | 'afterSave' | 'beforeDelete' | 'afterDelete' |
  'beforeFind' | 'afterFind' | 'beforeFetch' | 'afterFetch' |
  'beforePaginate' | 'afterPaginate'


/**
 * Class decorator that sets the database table name for a model.
 * @param {string} name - The table name
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @table('users')
 * class User extends BaseModel {}
 * ```
 */
export function table(name: string) {
  return function <T extends { new(...args: any[]): any }>(target: T) {
    ;(target as any).table = name
    return target
  }
}


/**
 * Class decorator that enables automatic created_at/updated_at timestamp management.
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @timestamps()
 * class Post extends BaseModel {}
 * ```
 */
export function timestamps() {
  return function <T extends { new(...args: any[]): any }>(target: T) {
    ;(target as any).timestamps = true
    return target
  }
}


/**
 * Class decorator that enables soft-delete behavior (sets deleted_at instead of removing rows).
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @softDeletes()
 * class User extends BaseModel {}
 * ```
 */
export function softDeletes() {
  return function <T extends { new(...args: any[]): any }>(target: T) {
    ;(target as any).softDeletes = true
    return target
  }
}


/**
 * Field decorator that marks a field as hidden (excluded from serialization/toJSON).
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   @hidden() declare password: string
 * }
 * ```
 */
export function hidden() {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    context.addInitializer(function (this: any) {
      const arr = ownArray(this.constructor, 'hidden')
      const name = String(context.name)
      if (!arr.includes(name)) arr.push(name)
    })
  }
}


/**
 * Field decorator that defines a type cast for the field when reading from the database.
 * @param {'boolean' | 'json' | 'integer' | 'float' | 'date' | 'string' | ((v: any) => any)} type - The cast type or a custom cast function
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class Settings extends BaseModel {
 *   @cast('json') declare config: Record<string, any>
 *   @cast('boolean') declare isActive: boolean
 * }
 * ```
 */
export function cast(type: 'boolean' | 'json' | 'integer' | 'float' | 'date' | 'string' | ((v: any) => any)) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    context.addInitializer(function (this: any) {
      const casts = ownObject(this.constructor, 'casts')
      casts[String(context.name)] = type
    })
  }
}


/**
 * Field decorator that marks a field as mass-assignable (fillable).
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   @fillable() declare name: string
 *   @fillable() declare email: string
 * }
 * ```
 */
export function fillable() {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    context.addInitializer(function (this: any) {
      const arr = ownArray(this.constructor, 'fillable')
      const name = String(context.name)
      if (!arr.includes(name)) arr.push(name)
    })
  }
}


function relationDecorator(
  factory: (model: () => any, opts?: any) => Relation,
  model: () => any,
  opts?: any
) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    context.addInitializer(function (this: any) {
      const relations = ownObject(this.constructor, 'relations')
      relations[String(context.name)] = factory(model, opts)
    })
  }
}

/**
 * Field decorator that defines a has-one relationship.
 * @param {() => any} model - Factory function returning the related model class
 * @param {object} [opts] - Relationship options
 * @param {string} [opts.foreignKey] - Custom foreign key column
 * @param {string} [opts.localKey] - Custom local key column
 * @param {any} [opts.withDefault] - Default value when relation is null
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   @HasOne(() => Profile)
 *   declare profile: Profile
 * }
 * ```
 */
export function HasOne(model: () => any, opts?: { foreignKey?: string; localKey?: string; withDefault?: any }) {
  return relationDecorator(hasOne, model, opts)
}

/**
 * Field decorator that defines a has-many relationship.
 * @param {() => any} model - Factory function returning the related model class
 * @param {object} [opts] - Relationship options
 * @param {string} [opts.foreignKey] - Custom foreign key column
 * @param {string} [opts.localKey] - Custom local key column
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   @HasMany(() => Post)
 *   declare posts: Post[]
 * }
 * ```
 */
export function HasMany(model: () => any, opts?: { foreignKey?: string; localKey?: string }) {
  return relationDecorator(hasMany, model, opts)
}

/**
 * Field decorator that defines a belongs-to (inverse has-one) relationship.
 * @param {() => any} model - Factory function returning the parent model class
 * @param {object} [opts] - Relationship options
 * @param {string} [opts.foreignKey] - Custom foreign key column
 * @param {string} [opts.localKey] - Custom local key column
 * @param {any} [opts.withDefault] - Default value when relation is null
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class Post extends BaseModel {
 *   @BelongsTo(() => User)
 *   declare author: User
 * }
 * ```
 */
export function BelongsTo(model: () => any, opts?: { foreignKey?: string; localKey?: string; withDefault?: any }) {
  return relationDecorator(belongsTo, model, opts)
}

/**
 * Field decorator that defines a many-to-many relationship via a pivot table.
 * @param {() => any} model - Factory function returning the related model class
 * @param {object} [opts] - Relationship options
 * @param {string} [opts.pivotTable] - Custom pivot table name
 * @param {string} [opts.pivotForeignKey] - Custom foreign key in the pivot table
 * @param {string} [opts.pivotRelatedForeignKey] - Custom related foreign key in the pivot table
 * @returns {ClassFieldDecorator} A field decorator
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   @ManyToMany(() => Role, { pivotTable: 'user_roles' })
 *   declare roles: Role[]
 * }
 * ```
 */
export function ManyToMany(model: () => any, opts?: { pivotTable?: string; pivotForeignKey?: string; pivotRelatedForeignKey?: string }) {
  return relationDecorator(manyToMany, model, opts)
}


function hookDecorator(event: HookEvent) {
  return function () {
    return function (target: any, context: ClassMethodDecoratorContext) {
      // For static methods, addInitializer's `this` is the class constructor
      if (context.static) {
        context.addInitializer(function (this: any) {
          ownHooks(this)[event] = [...(this.hooks[event] || []), target]
        })
      } else {
        // For instance methods, `this` is the instance — go up to constructor
        context.addInitializer(function (this: any) {
          const ctor = this.constructor
          ownHooks(ctor)[event] = [...(ctor.hooks[event] || []), target.bind(this)]
        })
      }
    }
  }
}

/** Method decorator that registers a hook to run before a model save operation. */
export const BeforeSave = hookDecorator('beforeSave')
/** Method decorator that registers a hook to run after a model save operation. */
export const AfterSave = hookDecorator('afterSave')
/** Method decorator that registers a hook to run before a model create operation. */
export const BeforeCreate = hookDecorator('beforeCreate')
/** Method decorator that registers a hook to run after a model create operation. */
export const AfterCreate = hookDecorator('afterCreate')
/** Method decorator that registers a hook to run before a model update operation. */
export const BeforeUpdate = hookDecorator('beforeUpdate')
/** Method decorator that registers a hook to run after a model update operation. */
export const AfterUpdate = hookDecorator('afterUpdate')
/** Method decorator that registers a hook to run before a model delete operation. */
export const BeforeDelete = hookDecorator('beforeDelete')
/** Method decorator that registers a hook to run after a model delete operation. */
export const AfterDelete = hookDecorator('afterDelete')
/** Method decorator that registers a hook to run before a model find operation. */
export const BeforeFind = hookDecorator('beforeFind')
/** Method decorator that registers a hook to run after a model find operation. */
export const AfterFind = hookDecorator('afterFind')
/** Method decorator that registers a hook to run before a model fetch operation. */
export const BeforeFetch = hookDecorator('beforeFetch')
/** Method decorator that registers a hook to run after a model fetch operation. */
export const AfterFetch = hookDecorator('afterFetch')
/** Method decorator that registers a hook to run before a model paginate operation. */
export const BeforePaginate = hookDecorator('beforePaginate')
/** Method decorator that registers a hook to run after a model paginate operation. */
export const AfterPaginate = hookDecorator('afterPaginate')
