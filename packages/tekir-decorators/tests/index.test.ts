import { test, expect, describe } from 'bun:test'
import {
  setStatic, createClassDecorator,
  pushToArray, setInMap, createFieldDecorator,
  pushMethodToArray, createEventDecorator, createMethodDecorator,
  compose
} from '../src/index'

// setStatic

describe('setStatic', () => {
  test('sets a static property on the class', () => {
    const Cacheable = setStatic('cacheTtl')
    @Cacheable(300)
    class Svc {}
    expect((Svc as any).cacheTtl).toBe(300)
  })

  test('sets string value', () => {
    const Table = setStatic('tableName')
    @Table('users')
    class Model {}
    expect((Model as any).tableName).toBe('users')
  })

  test('sets boolean value', () => {
    const Soft = setStatic('softDeletes')
    @Soft(true)
    class Model {}
    expect((Model as any).softDeletes).toBe(true)
  })

  test('sets object value', () => {
    const Config = setStatic('config')
    @Config({ driver: 'redis', ttl: 60 })
    class Cache {}
    expect((Cache as any).config).toEqual({ driver: 'redis', ttl: 60 })
  })

  test('different classes are independent', () => {
    const Tag = setStatic('tag')
    @Tag('a') class A {}
    @Tag('b') class B {}
    expect((A as any).tag).toBe('a')
    expect((B as any).tag).toBe('b')
  })
})

// createClassDecorator

describe('createClassDecorator', () => {
  test('runs handler with class and args', () => {
    const Entity = createClassDecorator((target, name: string, conn: string) => {
      target.table = name
      target.connection = conn
    })
    @Entity('users', 'primary')
    class User {}
    expect((User as any).table).toBe('users')
    expect((User as any).connection).toBe('primary')
  })

  test('no-arg class decorator', () => {
    const Timestamps = createClassDecorator((target) => {
      target.timestamps = true
    })
    @Timestamps()
    class Model {}
    expect((Model as any).timestamps).toBe(true)
  })

  test('handler can read existing static props', () => {
    const Extend = createClassDecorator((target, extra: string) => {
      target.features = [...(target.features || []), extra]
    })
    @Extend('logging')
    @Extend('caching')
    class Svc { static features: string[] = [] }
    expect((Svc as any).features).toContain('logging')
    expect((Svc as any).features).toContain('caching')
  })
})

// pushToArray

describe('pushToArray', () => {
  test('pushes field name to static array', () => {
    const Searchable = pushToArray('searchable')
    class Post {
      @Searchable() title!: string
      @Searchable() body!: string
    }
    new Post()
    expect((Post as any).searchable).toEqual(['title', 'body'])
  })

  test('no duplicates', () => {
    const Index = pushToArray('indexed')
    class T {
      @Index() name!: string
    }
    new T(); new T()
    expect((T as any).indexed).toEqual(['name'])
  })

  test('works on multiple unrelated classes', () => {
    const Idx = pushToArray('idxFields')
    class Users { @Idx() email!: string }
    new Users()
    expect((Users as any).idxFields).toContain('email')
  })

  test('preserves order', () => {
    const F = pushToArray('fields')
    class T {
      @F() a!: string
      @F() b!: string
      @F() c!: string
    }
    new T()
    expect((T as any).fields).toEqual(['a', 'b', 'c'])
  })
})

// setInMap

describe('setInMap', () => {
  test('sets field name as key with value', () => {
    const Rule = setInMap('rules')
    class User {
      @Rule('email') email!: string
      @Rule('min:6') password!: string
    }
    new User()
    expect((User as any).rules).toEqual({ email: 'email', password: 'min:6' })
  })

  test('accepts any value type', () => {
    const Cast = setInMap('casts')
    class M {
      @Cast('boolean') active!: boolean
      @Cast(42) count!: number
      @Cast({ parse: true }) data!: any
    }
    new M()
    expect((M as any).casts.active).toBe('boolean')
    expect((M as any).casts.count).toBe(42)
    expect((M as any).casts.data).toEqual({ parse: true })
  })

  test('works on standalone class', () => {
    const Label = setInMap('labels')
    class Items { @Label('product') name!: string }
    new Items()
    expect((Items as any).labels.name).toBe('product')
  })
})

// createFieldDecorator

describe('createFieldDecorator', () => {
  test('handler receives ctor, fieldName, and args', () => {
    const Transform = createFieldDecorator((ctor, name, fn: (v: any) => any) => {
      if (!ctor.transforms) ctor.transforms = {}
      ctor.transforms[name] = fn
    })
    const lower = (v: string) => v.toLowerCase()
    class User {
      @Transform(lower) email!: string
    }
    new User()
    expect((User as any).transforms.email).toBe(lower)
  })

  test('multiple args', () => {
    const Validate = createFieldDecorator((ctor, name, rule: string, msg: string) => {
      if (!ctor.validation) ctor.validation = {}
      ctor.validation[name] = { rule, msg }
    })
    class Form {
      @Validate('required', 'Name is required') name!: string
    }
    new Form()
    expect((Form as any).validation.name).toEqual({ rule: 'required', msg: 'Name is required' })
  })
})

// pushMethodToArray

describe('pushMethodToArray', () => {
  test('pushes static method to array', () => {
    const OnBoot = pushMethodToArray('bootHooks')
    class App {
      @OnBoot()
      static async seedDb() {}
      @OnBoot()
      static async warmCache() {}
    }
    new App()
    expect((App as any).bootHooks).toHaveLength(2)
  })

  test('methods are callable', () => {
    let called = false
    const Hook = pushMethodToArray('hooks')
    class S {
      @Hook()
      static run() { called = true }
    }
    new S()
    ;(S as any).hooks[0]()
    expect(called).toBe(true)
  })

  test('different classes independent', () => {
    const Init = pushMethodToArray('inits')
    class A { @Init() static a() {} }
    class B { @Init() static b() {} }
    new A(); new B()
    expect((A as any).inits).toHaveLength(1)
    expect((B as any).inits).toHaveLength(1)
  })
})

// createEventDecorator

describe('createEventDecorator', () => {
  test('groups methods by event name', () => {
    const On = createEventDecorator('listeners')
    class Events {
      @On('created')
      static async sendWelcome() {}
      @On('created')
      static async notifyAdmin() {}
      @On('deleted')
      static async cleanup() {}
    }
    new Events()
    expect((Events as any).listeners.created).toHaveLength(2)
    expect((Events as any).listeners.deleted).toHaveLength(1)
  })

  test('methods are callable', () => {
    let result = ''
    const On = createEventDecorator('on')
    class E {
      @On('test')
      static handler() { result = 'ok' }
    }
    new E()
    ;(E as any).on.test[0]()
    expect(result).toBe('ok')
  })

  test('different classes independent', () => {
    const On = createEventDecorator('events')
    class A { @On('x') static a() {} }
    class B { @On('x') static b() {} }
    new A(); new B()
    expect((A as any).events.x).toHaveLength(1)
    expect((B as any).events.x).toHaveLength(1)
  })
})

// createMethodDecorator

describe('createMethodDecorator', () => {
  test('handler receives ctor, name, fn, and args', () => {
    const Throttle = createMethodDecorator((ctor, name, _fn, ms: number) => {
      if (!ctor.throttles) ctor.throttles = {}
      ctor.throttles[name] = ms
    })
    class Api {
      @Throttle(1000)
      static async fetch() {}
    }
    new Api()
    expect((Api as any).throttles.fetch).toBe(1000)
  })

  test('multiple method decorators', () => {
    const Rate = createMethodDecorator((ctor, name, _fn, limit: number) => {
      if (!ctor.rates) ctor.rates = {}
      ctor.rates[name] = limit
    })
    class Svc {
      @Rate(100) static a() {}
      @Rate(200) static b() {}
    }
    new Svc()
    expect((Svc as any).rates).toEqual({ a: 100, b: 200 })
  })
})

// compose

describe('compose', () => {
  test('composes multiple class decorators', () => {
    const A = createClassDecorator((t) => { t.a = true })
    const B = createClassDecorator((t) => { t.b = true })
    const C = createClassDecorator((t) => { t.c = true })

    const combined = compose(A() as any, B() as any, C() as any)
    class Target {}
    combined(Target)
    expect((Target as any).a).toBe(true)
    expect((Target as any).b).toBe(true)
    expect((Target as any).c).toBe(true)
  })

  test('applies in correct order (last first)', () => {
    const order: string[] = []
    const Track = (n: string) => createClassDecorator((t) => { order.push(n) })

    const combined = compose(Track('first')() as any, Track('second')() as any)
    class T {}
    combined(T)
    expect(order[0]).toBe('second')
    expect(order[1]).toBe('first')
  })
})

// Real-world examples

describe('Real-world patterns', () => {
  test('validation rules via setInMap', () => {
    const Validate = setInMap('validations')
    class RegisterForm {
      @Validate('required|email') email!: string
      @Validate('required|min:8') password!: string
      @Validate('required|min:2') name!: string
    }
    new RegisterForm()
    expect((RegisterForm as any).validations).toEqual({
      email: 'required|email',
      password: 'required|min:8',
      name: 'required|min:2',
    })
  })

  test('searchable fields via pushToArray', () => {
    const Searchable = pushToArray('searchableFields')
    class Article {
      @Searchable() title!: string
      @Searchable() content!: string
      declare authorId: number // not searchable
    }
    new Article()
    expect((Article as any).searchableFields).toEqual(['title', 'content'])
  })

  test('lifecycle hooks via createEventDecorator', () => {
    const Hook = createEventDecorator('hooks')
    class Service {
      @Hook('start') static async connect() {}
      @Hook('start') static async loadConfig() {}
      @Hook('stop') static async disconnect() {}
    }
    new Service()
    expect(Object.keys((Service as any).hooks)).toEqual(['start', 'stop'])
    expect((Service as any).hooks.start).toHaveLength(2)
    expect((Service as any).hooks.stop).toHaveLength(1)
  })

  test('caching config via setStatic + setInMap', () => {
    const CacheTTL = setStatic('defaultTTL')
    const CacheKey = setInMap('cacheKeys')

    @CacheTTL(60)
    class UserService {
      @CacheKey('users:list') list!: any
      @CacheKey('users:detail') detail!: any
    }
    new UserService()
    expect((UserService as any).defaultTTL).toBe(60)
    expect((UserService as any).cacheKeys).toEqual({ list: 'users:list', detail: 'users:detail' })
  })
})


describe('setStatic — edge cases', () => {
  test('sets null value', () => {
    const Nullable = setStatic('nullable')
    @Nullable(null)
    class M {}
    expect((M as any).nullable).toBeNull()
  })

  test('sets undefined value', () => {
    const Undef = setStatic('undef')
    @Undef(undefined)
    class M {}
    expect((M as any).undef).toBeUndefined()
  })

  test('sets array value', () => {
    const Arr = setStatic('items')
    @Arr([1, 2, 3])
    class M {}
    expect((M as any).items).toEqual([1, 2, 3])
  })

  test('sets numeric zero', () => {
    const Zero = setStatic('val')
    @Zero(0)
    class M {}
    expect((M as any).val).toBe(0)
  })

  test('sets empty string', () => {
    const Empty = setStatic('str')
    @Empty('')
    class M {}
    expect((M as any).str).toBe('')
  })

  test('overrides previous static on same class', () => {
    const Tag = setStatic('tag')
    @Tag('second')
    @Tag('first')
    class M {}
    // Last applied (outermost) wins
    expect((M as any).tag).toBe('second')
  })
})

describe('pushToArray — edge cases', () => {
  test('single field class', () => {
    const F = pushToArray('cols')
    class T { @F() only!: string }
    new T()
    expect((T as any).cols).toEqual(['only'])
  })

  test('five fields collected in order', () => {
    const F = pushToArray('all')
    class T {
      @F() a!: string
      @F() b!: string
      @F() c!: string
      @F() d!: string
      @F() e!: string
    }
    new T()
    expect((T as any).all).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('createClassDecorator — edge cases', () => {
  test('handler receives the class constructor', () => {
    let receivedTarget: any = null
    const Capture = createClassDecorator((target) => { receivedTarget = target })
    @Capture()
    class Foo {}
    expect(receivedTarget).toBe(Foo)
  })

  test('handler can set multiple properties', () => {
    const Multi = createClassDecorator((target, a: string, b: number) => {
      target.a = a
      target.b = b
    })
    @Multi('hello', 42)
    class M {}
    expect((M as any).a).toBe('hello')
    expect((M as any).b).toBe(42)
  })

  test('decorator with no args sets default', () => {
    const Default = createClassDecorator((target) => {
      target.initialized = true
    })
    @Default()
    class M {}
    expect((M as any).initialized).toBe(true)
  })
})

describe('compose — edge cases', () => {
  test('compose with single decorator', () => {
    const A = createClassDecorator((t) => { t.a = true })
    const combined = compose(A() as any)
    class T {}
    combined(T)
    expect((T as any).a).toBe(true)
  })

  test('compose with four decorators', () => {
    const A = createClassDecorator((t) => { t.a = 1 })
    const B = createClassDecorator((t) => { t.b = 2 })
    const C = createClassDecorator((t) => { t.c = 3 })
    const D = createClassDecorator((t) => { t.d = 4 })
    const combined = compose(A() as any, B() as any, C() as any, D() as any)
    class T {}
    combined(T)
    expect((T as any).a).toBe(1)
    expect((T as any).b).toBe(2)
    expect((T as any).c).toBe(3)
    expect((T as any).d).toBe(4)
  })

  test('compose preserves decoration on different classes', () => {
    const A = createClassDecorator((t) => { t.val = (t.val || 0) + 1 })
    const combined = compose(A() as any, A() as any)
    class X {}
    class Y {}
    combined(X)
    combined(Y)
    expect((X as any).val).toBe(2)
    expect((Y as any).val).toBe(2)
  })
})

describe('createMethodDecorator — edge cases', () => {
  test('handler receives method function', () => {
    let receivedFn: any = null
    const Capture = createMethodDecorator((_ctor, _name, fn) => { receivedFn = fn })
    class S {
      @Capture()
      static myMethod() { return 42 }
    }
    new S()
    expect(typeof receivedFn).toBe('function')
  })

  test('no-arg method decorator', () => {
    const Mark = createMethodDecorator((ctor, name) => {
      if (!ctor.marked) ctor.marked = []
      ctor.marked.push(name)
    })
    class S {
      @Mark()
      static a() {}
      @Mark()
      static b() {}
    }
    new S()
    expect((S as any).marked).toContain('a')
    expect((S as any).marked).toContain('b')
  })
})

describe('setInMap — edge cases', () => {
  test('map with boolean true value', () => {
    const Flag = setInMap('flags')
    class M { @Flag(true) active!: boolean }
    new M()
    expect((M as any).flags.active).toBe(true)
  })

  test('map with null value', () => {
    const Nullable = setInMap('nulls')
    class M { @Nullable(null) field!: any }
    new M()
    expect((M as any).nulls.field).toBeNull()
  })

  test('map with numeric zero', () => {
    const Val = setInMap('vals')
    class M { @Val(0) count!: number }
    new M()
    expect((M as any).vals.count).toBe(0)
  })

  test('map with array value', () => {
    const ArrVal = setInMap('arrs')
    class M { @ArrVal([1, 2, 3]) items!: any }
    new M()
    expect((M as any).arrs.items).toEqual([1, 2, 3])
  })

  test('multiple fields in map preserved', () => {
    const V = setInMap('v')
    class M {
      @V('a') f1!: any
      @V('b') f2!: any
      @V('c') f3!: any
      @V('d') f4!: any
      @V('e') f5!: any
    }
    new M()
    expect(Object.keys((M as any).v)).toHaveLength(5)
  })
})

describe('createFieldDecorator — additional', () => {
  test('field decorator with no extra args', () => {
    const Required = createFieldDecorator((ctor, name) => {
      if (!ctor.required) ctor.required = []
      ctor.required.push(name)
    })
    class Form { @Required() email!: string }
    new Form()
    expect((Form as any).required).toContain('email')
  })

  test('field decorator applied to multiple fields', () => {
    const Index = createFieldDecorator((ctor, name) => {
      if (!ctor.indexes) ctor.indexes = []
      ctor.indexes.push(name)
    })
    class T {
      @Index() a!: string
      @Index() b!: string
      @Index() c!: string
    }
    new T()
    expect((T as any).indexes).toEqual(['a', 'b', 'c'])
  })
})

describe('pushMethodToArray — additional', () => {
  test('single method pushed', () => {
    const Before = pushMethodToArray('before')
    class S { @Before() static init() {} }
    new S()
    expect((S as any).before).toHaveLength(1)
  })

  test('pushed methods are actual functions', () => {
    const After = pushMethodToArray('after')
    let ran = false
    class S { @After() static cleanup() { ran = true } }
    new S()
    ;(S as any).after[0]()
    expect(ran).toBe(true)
  })
})

describe('createEventDecorator — additional', () => {
  test('event with single handler', () => {
    const On = createEventDecorator('handlers')
    class E { @On('click') static onClick() {} }
    new E()
    expect((E as any).handlers.click).toHaveLength(1)
  })

  test('event with three handlers', () => {
    const On = createEventDecorator('h')
    class E {
      @On('save') static a() {}
      @On('save') static b() {}
      @On('save') static c() {}
    }
    new E()
    expect((E as any).h.save).toHaveLength(3)
  })

  test('different events are separate keys', () => {
    const On = createEventDecorator('ev')
    class E {
      @On('start') static s() {}
      @On('stop') static t() {}
      @On('pause') static p() {}
    }
    new E()
    expect(Object.keys((E as any).ev).sort()).toEqual(['pause', 'start', 'stop'])
  })
})

describe('compose idempotency', () => {
  test('the same composed decorator applies in the same order to two classes', () => {
    const order: string[] = []
    const A = (target: any) => { order.push(`A:${target.name}`); return target }
    const B = (target: any) => { order.push(`B:${target.name}`); return target }
    const C = (target: any) => { order.push(`C:${target.name}`); return target }

    const Combined = compose(A as any, B as any, C as any)

    @Combined
    class First {}
    @Combined
    class Second {}
    void First; void Second

    // Reverse order (innermost first): C, B, A for each class — and the order
    // must be identical for the second application (no in-place mutation).
    expect(order).toEqual([
      'C:First', 'B:First', 'A:First',
      'C:Second', 'B:Second', 'A:Second',
    ])
  })

  test('does not mutate the caller-visible decorator order between applications', () => {
    const seen: string[] = []
    const mk = (tag: string) => ((t: any) => { seen.push(tag); return t })
    const Combined = compose(mk('x') as any, mk('y') as any)
    @Combined class P {}
    @Combined class Q {}
    void P; void Q
    expect(seen).toEqual(['y', 'x', 'y', 'x'])
  })
})

describe('createEventDecorator on instance methods', () => {
  test('instance-method handlers are registered (not a silent no-op)', () => {
    const On = createEventDecorator('listeners')
    class Events {
      @On('created') onCreated() {}
      @On('created') alsoCreated() {}
      @On('deleted') onDeleted() {}
    }
    new Events()
    const listeners = (Events as any).listeners
    expect(listeners.created).toHaveLength(2)
    expect(listeners.deleted).toHaveLength(1)
  })

  test('instance event maps do not leak across classes', () => {
    const On = createEventDecorator('evmap')
    function makeA() {
      class A { @On('a') h() {} }
      return A
    }
    function makeB() {
      class B { @On('b') h() {} }
      return B
    }
    const A = makeA(); const B = makeB()
    new A(); new B()
    expect(Object.keys((A as any).evmap)).toEqual(['a'])
    expect(Object.keys((B as any).evmap)).toEqual(['b'])
  })
})
