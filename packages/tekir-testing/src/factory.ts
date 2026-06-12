
// ORM model class shape expected by defineFactory. Both methods are
// optional so a factory can be backed by a model that only implements
// `create` (the common shape for ORMs without bulk-insert) or only
// `createMany` (some sql-builders); callers get a runtime error if
// they invoke a factory method that requires a missing model method.
interface FactoryModel<T> {
  create?(data: T): Promise<T>
  createMany?(data: T[]): Promise<T[]>
}

/**
 * Define a model factory for generating test data.
 *
 * @param {() => T} defaults - Factory function that returns default field values
 * @param {FactoryModel<T>} [model] - Optional ORM model class for persisting records via create/createMany
 * @returns {{ make(overrides?: Partial<T>): T; makeMany(count: number, overrides?: Partial<T>): T[]; create(overrides?: Partial<T>): Promise<T>; createMany(count: number, overrides?: Partial<T>): Promise<T[]>; state(stateOverrides: Partial<T> | (() => Partial<T>)): ReturnType<typeof defineFactory> }} Factory instance with make, makeMany, create, createMany, and state methods
 *
 * @example
 * ```ts
 * const UserFactory = defineFactory<User>(() => ({
 *   name: `User ${Math.random().toString(36).slice(2)}`,
 *   email: `${crypto.randomUUID()}@test.dev`,
 *   password: 'secret',
 *   role: 'user',
 * }))
 *
 * const user = UserFactory.make()
 * const users = UserFactory.makeMany(5)
 * const persisted = await UserFactory.create()           // calls Model.create()
 * const many = await UserFactory.createMany(3)
 * const admin = UserFactory.make({ role: 'admin' })      // override
 * ```
 */
export function defineFactory<T extends Record<string, unknown>>(defaults: () => T, model?: FactoryModel<T>) {
  return {
    /** Generate a single object (not persisted) */
    make(overrides: Partial<T> = {}): T {
      return { ...defaults(), ...overrides }
    },

    /** Generate multiple objects (not persisted) */
    makeMany(count: number, overrides: Partial<T> = {}): T[] {
      return Array.from({ length: count }, () => this.make(overrides))
    },

    /** Create and persist a single record via Model.create() */
    async create(overrides: Partial<T> = {}): Promise<T> {
      if (!model?.create) throw new Error('Factory has no model.create(). Pass a model implementing `create(data)` to defineFactory.')
      return model.create(this.make(overrides))
    },

    /** Create and persist multiple records */
    async createMany(count: number, overrides: Partial<T> = {}): Promise<T[]> {
      if (!model?.createMany) throw new Error('Factory has no model.createMany(). Pass a model implementing `createMany(data)` to defineFactory.')
      return model.createMany(this.makeMany(count, overrides))
    },

    /** Return a new factory with merged defaults */
    state(stateOverrides: Partial<T> | (() => Partial<T>)) {
      return defineFactory<T>(
        () => ({
          ...defaults(),
          ...(typeof stateOverrides === 'function' ? stateOverrides() : stateOverrides),
        }),
        model,
      )
    },
  }
}
