
// Class Decorators

/**
 * Create a class decorator that sets a static property on the decorated class.
 *
 * @param {string} key - The static property name to set
 * @returns {(value: any) => ClassDecorator} A decorator factory that accepts the value to assign
 *
 * @example
 * ```ts
 * const Cacheable = setStatic('cacheTtl')
 * @Cacheable(300)
 * class UserService {}
 * // UserService.cacheTtl === 300
 * ```
 */
export function setStatic(key: string) {
  return function (value: any) {
    return function <T extends { new (...args: any[]): any }>(target: T) {
      ;(target as any)[key] = value
      return target
    }
  }
}

/**
 * Create a class decorator with a custom handler function.
 *
 * @param {(target: any, ...args: Args) => void} handler - Handler that receives the class and decorator arguments
 * @returns {(...args: Args) => ClassDecorator} A decorator factory
 *
 * @example
 * ```ts
 * const Entity = createClassDecorator((target, tableName: string) => {
 *   target.table = tableName
 *   target.connection = 'default'
 * })
 *
 * @Entity('users')
 * class User {}
 * ```
 */
export function createClassDecorator<Args extends any[]>(
  handler: (target: any, ...args: Args) => void
) {
  return function (...args: Args) {
    return function <T extends { new (...args: any[]): any }>(target: T) {
      handler(target, ...args)
      return target
    }
  }
}

// Field Decorators

/**
 * Create a field decorator that pushes the field name to a static array on the class.
 *
 * @param {string} key - The static array property name
 * @returns {() => ClassFieldDecorator} A decorator factory
 *
 * @example
 * ```ts
 * const Searchable = pushToArray('searchableFields')
 *
 * class Post {
 *   @Searchable() declare title: string
 *   @Searchable() declare body: string
 * }
 * // Post.searchableFields === ['title', 'body']
 * ```
 */
export function pushToArray(key: string) {
  return function () {
    return function (_value: undefined, context: ClassFieldDecoratorContext) {
      context.addInitializer(function (this: any) {
        const ctor = this.constructor
        if (!Object.hasOwn(ctor, key)) ctor[key] = []
        const arr = ctor[key] as string[]
        const name = String(context.name)
        if (!arr.includes(name)) arr.push(name)
      })
    }
  }
}

/**
 * Create a field decorator that sets a value in a static object (map) on the class.
 *
 * @param {string} key - The static object property name
 * @returns {(value: any) => ClassFieldDecorator} A decorator factory that accepts a value
 *
 * @example
 * ```ts
 * const Rule = setInMap('validationRules')
 *
 * class User {
 *   @Rule('email') declare email: string
 *   @Rule('min:6') declare password: string
 * }
 * // User.validationRules === { email: 'email', password: 'min:6' }
 * ```
 */
export function setInMap(key: string) {
  return function (value: any) {
    return function (_target: undefined, context: ClassFieldDecoratorContext) {
      context.addInitializer(function (this: any) {
        const ctor = this.constructor
        if (!Object.hasOwn(ctor, key)) ctor[key] = {}
        ctor[key][String(context.name)] = value
      })
    }
  }
}

/**
 * Create a field decorator with a custom handler function.
 *
 * @param {(ctor: any, fieldName: string, ...args: Args) => void} handler - Handler that receives the class constructor, field name, and decorator arguments
 * @returns {(...args: Args) => ClassFieldDecorator} A decorator factory
 *
 * @example
 * ```ts
 * const Transform = createFieldDecorator((ctor, fieldName, transformer: (v: any) => any) => {
 *   if (!ctor.transforms) ctor.transforms = {}
 *   ctor.transforms[fieldName] = transformer
 * })
 *
 * class User {
 *   @Transform((v) => v.toLowerCase())
 *   declare email: string
 * }
 * ```
 */
export function createFieldDecorator<Args extends any[]>(
  handler: (ctor: any, fieldName: string, ...args: Args) => void
) {
  return function (...args: Args) {
    return function (_target: undefined, context: ClassFieldDecoratorContext) {
      context.addInitializer(function (this: any) {
        handler(this.constructor, String(context.name), ...args)
      })
    }
  }
}

// Method Decorators

/**
 * Create a method decorator that pushes the method to a static array on the class.
 *
 * @param {string} key - The static array property name
 * @returns {() => ClassMethodDecorator} A decorator factory
 *
 * @example
 * ```ts
 * const OnInit = pushMethodToArray('initHooks')
 *
 * class App {
 *   @OnInit()
 *   static async seedDb() { ... }
 *
 *   @OnInit()
 *   static async warmCache() { ... }
 * }
 * // App.initHooks === [seedDb, warmCache]
 * ```
 */
export function pushMethodToArray(key: string) {
  return function () {
    return function (target: any, context: ClassMethodDecoratorContext) {
      if (context.static) {
        context.addInitializer(function (this: any) {
          if (!Object.hasOwn(this, key)) this[key] = []
          this[key].push(target)
        })
      } else {
        context.addInitializer(function (this: any) {
          const ctor = this.constructor
          if (!Object.hasOwn(ctor, key)) ctor[key] = []
          ctor[key].push(target.bind(this))
        })
      }
    }
  }
}

/**
 * Create a method decorator that registers the method under an event key
 * in a static hooks-style object.
 *
 * @param {string} key - The static object property name for storing event handlers
 * @returns {(event: string) => ClassMethodDecorator} A decorator factory that accepts an event name
 *
 * @example
 * ```ts
 * const On = createEventDecorator('listeners')
 *
 * class UserEvents {
 *   @On('created')
 *   static async sendWelcome(user: any) { ... }
 *
 *   @On('created')
 *   static async notifyAdmin(user: any) { ... }
 *
 *   @On('deleted')
 *   static async cleanup(user: any) { ... }
 * }
 * // UserEvents.listeners === {
 * //   created: [sendWelcome, notifyAdmin],
 * //   deleted: [cleanup]
 * // }
 * ```
 */
export function createEventDecorator(key: string) {
  return function (event: string) {
    return function (target: any, context: ClassMethodDecoratorContext) {
      if (context.static) {
        context.addInitializer(function (this: any) {
          if (!Object.hasOwn(this, key)) this[key] = {}
          if (!this[key][event]) this[key][event] = []
          this[key][event].push(target)
        })
      } else {
        // Instance methods: register on the constructor (own-property checked so
        // subclasses don't share the parent's map) binding to the instance.
        // Previously this branch was missing, silently dropping instance-method
        // event handlers.
        context.addInitializer(function (this: any) {
          const ctor = this.constructor
          if (!Object.hasOwn(ctor, key)) ctor[key] = {}
          if (!ctor[key][event]) ctor[key][event] = []
          ctor[key][event].push(target.bind(this))
        })
      }
    }
  }
}

/**
 * Create a method decorator with a custom handler function.
 *
 * @param {(ctor: any, methodName: string, fn: Function, ...args: Args) => void} handler - Handler that receives the class constructor, method name, the method function, and decorator arguments
 * @returns {(...args: Args) => ClassMethodDecorator} A decorator factory
 *
 * @example
 * ```ts
 * const Throttle = createMethodDecorator((ctor, methodName, fn, ms: number) => {
 *   if (!ctor.throttles) ctor.throttles = {}
 *   ctor.throttles[methodName] = ms
 * })
 *
 * class Api {
 *   @Throttle(1000)
 *   static async fetch() { ... }
 * }
 * ```
 */
export function createMethodDecorator<Args extends any[]>(
  handler: (ctor: any, methodName: string, fn: Function, ...args: Args) => void
) {
  return function (...args: Args) {
    return function (target: any, context: ClassMethodDecoratorContext) {
      if (context.static) {
        context.addInitializer(function (this: any) {
          handler(this, String(context.name), target, ...args)
        })
      } else {
        context.addInitializer(function (this: any) {
          handler(this.constructor, String(context.name), target, ...args)
        })
      }
    }
  }
}

// Convenience: compose multiple class decorators

/**
 * Compose multiple class decorators into a single decorator.
 * Decorators are applied in reverse order (innermost first).
 *
 * @param {...ClassDecorator} decorators - The class decorators to compose
 * @returns {ClassDecorator} A combined class decorator
 *
 * @example
 * ```ts
 * const Model = compose(
 *   Entity('users'),
 *   Timestamps(),
 *   SoftDeletes()
 * )
 *
 * @Model
 * class User extends BaseModel {}
 * ```
 */
export function compose(...decorators: ClassDecorator[]): ClassDecorator {
  return function (target: any) {
    // Copy before reversing so the returned decorator is idempotent — reversing
    // in place would re-order the original array on every application, breaking
    // the second class the composed decorator is applied to.
    for (const decorator of [...decorators].reverse()) {
      decorator(target)
    }
    return target
  } as ClassDecorator
}
