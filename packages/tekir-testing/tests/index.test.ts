import { test, expect, describe, afterEach } from 'bun:test'
import { defineFactory, fakeTime, assertThrows, assertNotThrows } from '../src/index'


describe('defineFactory', () => {
  type User = { name: string; email: string; role: string; age: number; id?: number }

  const UserFactory = defineFactory<User>(() => ({
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
    age: 30,
  }))

  describe('make()', () => {
    test('returns an object with the default values', () => {
      const user = UserFactory.make()
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
      expect(user.role).toBe('user')
      expect(user.age).toBe(30)
    })

    test('applies overrides on top of defaults', () => {
      const user = UserFactory.make({ role: 'admin' })
      expect(user.role).toBe('admin')
      // Non-overridden fields keep defaults
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
    })

    test('applies multiple overrides', () => {
      const user = UserFactory.make({ name: 'Alice', age: 25 })
      expect(user.name).toBe('Alice')
      expect(user.age).toBe(25)
      expect(user.role).toBe('user')
    })

    test('make() with no arguments returns a plain object', () => {
      const user = UserFactory.make()
      expect(typeof user).toBe('object')
      expect(user).not.toBeNull()
    })

    test('make() returns a fresh object each call (no shared reference)', () => {
      const a = UserFactory.make()
      const b = UserFactory.make()
      expect(a).not.toBe(b)
    })

    test('empty overrides object behaves as no override', () => {
      const user = UserFactory.make({})
      expect(user).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        role: 'user',
        age: 30,
      })
    })

    test('override can set a field to undefined', () => {
      const user = UserFactory.make({ name: undefined })
      expect(user.name).toBeUndefined()
    })
  })

  describe('makeMany()', () => {
    test('returns an array of the requested length', () => {
      const users = UserFactory.makeMany(5)
      expect(users).toHaveLength(5)
    })

    test('each element has default values', () => {
      const users = UserFactory.makeMany(3)
      for (const user of users) {
        expect(user.name).toBe('John Doe')
        expect(user.role).toBe('user')
      }
    })

    test('applies overrides to every element', () => {
      const users = UserFactory.makeMany(4, { role: 'mod' })
      for (const user of users) {
        expect(user.role).toBe('mod')
      }
    })

    test('makeMany(0) returns empty array', () => {
      expect(UserFactory.makeMany(0)).toEqual([])
    })

    test('makeMany(1) returns array with one element', () => {
      const users = UserFactory.makeMany(1)
      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('John Doe')
    })

    test('elements are independent objects', () => {
      const users = UserFactory.makeMany(2)
      expect(users[0]).not.toBe(users[1])
    })
  })

  describe('state()', () => {
    test('returns a new factory (not the same reference)', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      expect(AdminFactory).not.toBe(UserFactory)
    })

    test('state factory make() applies state overrides', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      const user = AdminFactory.make()
      expect(user.role).toBe('admin')
    })

    test('state factory preserves non-overridden defaults', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      const user = AdminFactory.make()
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
    })

    test('make() on state factory still accepts further overrides', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      const user = AdminFactory.make({ name: 'Super Admin' })
      expect(user.role).toBe('admin')
      expect(user.name).toBe('Super Admin')
    })

    test('state() accepts a function', () => {
      const ModFactory = UserFactory.state(() => ({ role: 'mod', age: 99 }))
      const user = ModFactory.make()
      expect(user.role).toBe('mod')
      expect(user.age).toBe(99)
    })

    test('state() with function preserves defaults', () => {
      const ModFactory = UserFactory.state(() => ({ role: 'mod' }))
      const user = ModFactory.make()
      expect(user.name).toBe('John Doe')
    })

    test('states can be chained', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      const SuperAdminFactory = AdminFactory.state({ age: 100 })
      const user = SuperAdminFactory.make()
      expect(user.role).toBe('admin')
      expect(user.age).toBe(100)
      expect(user.name).toBe('John Doe')
    })

    test('state factory makeMany() works correctly', () => {
      const AdminFactory = UserFactory.state({ role: 'admin' })
      const admins = AdminFactory.makeMany(3)
      expect(admins).toHaveLength(3)
      for (const a of admins) expect(a.role).toBe('admin')
    })
  })

  describe('create() without model throws', () => {
    test('create() throws when no model is provided', async () => {
      await expect(UserFactory.create()).rejects.toThrow('Factory has no model.create()')
    })

    test('createMany() throws when no model is provided', async () => {
      await expect(UserFactory.createMany(2)).rejects.toThrow('Factory has no model.createMany()')
    })
  })

  describe('create() with model', () => {
    test('create() calls model.create with made data', async () => {
      let capturedData: any = null
      const MockModel = {
        create: async (data: any) => { capturedData = data; return { id: 1, ...data } },
      }
      const PersistedFactory = defineFactory<User>(
        () => ({ name: 'Persisted', email: 'p@test.com', role: 'user', age: 20 }),
        MockModel
      )
      const result = await PersistedFactory.create()
      expect(capturedData).toMatchObject({ name: 'Persisted', role: 'user' })
      expect(result.id).toBe(1)
    })

    test('create() applies overrides before passing to model.create', async () => {
      let capturedData: any = null
      const MockModel = {
        create: async (data: any) => { capturedData = data; return data },
      }
      const PersistedFactory = defineFactory<User>(
        () => ({ name: 'Default', email: 'x@test.com', role: 'user', age: 20 }),
        MockModel
      )
      await PersistedFactory.create({ role: 'admin' })
      expect(capturedData.role).toBe('admin')
    })

    test('createMany() calls model.createMany with array of made data', async () => {
      let capturedData: any = null
      const MockModel = {
        createMany: async (data: any[]) => { capturedData = data; return data },
      }
      const PersistedFactory = defineFactory<User>(
        () => ({ name: 'M', email: 'm@test.com', role: 'user', age: 1 }),
        MockModel
      )
      await PersistedFactory.createMany(3)
      expect(Array.isArray(capturedData)).toBe(true)
      expect(capturedData).toHaveLength(3)
    })
  })
})


describe('fakeTime', () => {
  // Always restore Date after each test
  let restore: (() => void) | null = null
  afterEach(() => { if (restore) { restore(); restore = null } })

  test('returns a function (restore callback)', () => {
    restore = fakeTime(new Date('2025-01-01T00:00:00Z'))
    expect(typeof restore).toBe('function')
  })

  test('Date.now() returns the frozen timestamp', () => {
    const frozen = new Date('2025-06-15T12:00:00Z')
    restore = fakeTime(frozen)
    expect(Date.now()).toBe(frozen.getTime())
  })

  test('new Date() (no args) returns the frozen date', () => {
    const frozen = new Date('2024-03-01T00:00:00Z')
    restore = fakeTime(frozen)
    const now = new Date()
    expect(now.getTime()).toBe(frozen.getTime())
  })

  test('new Date(explicit) still works correctly', () => {
    const frozen = new Date('2025-01-01T00:00:00Z')
    restore = fakeTime(frozen)
    const specific = new Date('2000-01-01')
    expect(specific.getFullYear()).toBe(2000)
  })

  test('restore() brings back the real Date', () => {
    const realNow = Date.now()
    const frozen = new Date('2000-01-01T00:00:00Z')
    const restoreFn = fakeTime(frozen)
    expect(Date.now()).toBe(frozen.getTime())
    restoreFn()
    restore = null // already restored
    // After restore, Date.now() should be close to the real time
    expect(Date.now()).toBeGreaterThanOrEqual(realNow)
  })

  test('Date.now() does not advance while frozen', () => {
    const frozen = new Date('2025-07-04T00:00:00Z')
    restore = fakeTime(frozen)
    const t1 = Date.now()
    const t2 = Date.now()
    expect(t1).toBe(t2)
    expect(t1).toBe(frozen.getTime())
  })

  test('two consecutive fakeTime calls freeze to the last one', () => {
    const first = new Date('2020-01-01T00:00:00Z')
    const second = new Date('2030-12-31T00:00:00Z')
    const r1 = fakeTime(first)
    const r2 = fakeTime(second)
    expect(Date.now()).toBe(second.getTime())
    r2()  // restore to first fake (since r1 wrapped the original)
    r1()  // restore to actual Date
    restore = null
  })
})


describe('assertThrows', () => {
  test('passes when function throws', async () => {
    await expect(
      assertThrows(() => { throw new Error('boom') })
    ).resolves.toBeUndefined()
  })

  test('fails when function does NOT throw', async () => {
    await expect(
      assertThrows(() => 'no throw')
    ).rejects.toThrow('Expected function to throw, but it did not')
  })

  test('passes for async function that rejects', async () => {
    await expect(
      assertThrows(async () => { throw new Error('async boom') })
    ).resolves.toBeUndefined()
  })

  test('fails for async function that resolves', async () => {
    await expect(
      assertThrows(async () => 'resolved')
    ).rejects.toThrow('Expected function to throw, but it did not')
  })

  describe('string expected message', () => {
    test('passes when error message matches exactly', async () => {
      await expect(
        assertThrows(() => { throw new Error('exact message') }, 'exact message')
      ).resolves.toBeUndefined()
    })

    test('fails when error message does not match', async () => {
      await expect(
        assertThrows(() => { throw new Error('wrong') }, 'right')
      ).rejects.toThrow('Expected error message "right", got "wrong"')
    })
  })

  describe('RegExp expected message', () => {
    test('passes when error message matches regex', async () => {
      await expect(
        assertThrows(() => { throw new Error('something failed badly') }, /failed/)
      ).resolves.toBeUndefined()
    })

    test('fails when error message does not match regex', async () => {
      await expect(
        assertThrows(() => { throw new Error('all good') }, /failed/)
      ).rejects.toThrow(/Expected error message to match/)
    })
  })

  describe('object expected { message, code, statusCode }', () => {
    test('passes when all three properties match', async () => {
      const err: any = new Error('not found')
      err.code = 'NOT_FOUND'
      err.statusCode = 404
      await expect(
        assertThrows(() => { throw err }, { message: 'not found', code: 'NOT_FOUND', statusCode: 404 })
      ).resolves.toBeUndefined()
    })

    test('passes when only message is specified and matches', async () => {
      await expect(
        assertThrows(() => { throw new Error('only message') }, { message: 'only message' })
      ).resolves.toBeUndefined()
    })

    test('fails when message does not match', async () => {
      await expect(
        assertThrows(() => { throw new Error('actual') }, { message: 'expected' })
      ).rejects.toThrow('Expected error message "expected", got "actual"')
    })

    test('passes when only code is specified and matches', async () => {
      const err: any = new Error('x')
      err.code = 'GONE'
      await expect(
        assertThrows(() => { throw err }, { code: 'GONE' })
      ).resolves.toBeUndefined()
    })

    test('fails when code does not match', async () => {
      const err: any = new Error('x')
      err.code = 'ACTUAL_CODE'
      await expect(
        assertThrows(() => { throw err }, { code: 'EXPECTED_CODE' })
      ).rejects.toThrow('Expected error code "EXPECTED_CODE", got "ACTUAL_CODE"')
    })

    test('passes when only statusCode is specified and matches', async () => {
      const err: any = new Error('x')
      err.statusCode = 422
      await expect(
        assertThrows(() => { throw err }, { statusCode: 422 })
      ).resolves.toBeUndefined()
    })

    test('fails when statusCode does not match', async () => {
      const err: any = new Error('x')
      err.statusCode = 500
      await expect(
        assertThrows(() => { throw err }, { statusCode: 400 })
      ).rejects.toThrow('Expected status code 400, got 500')
    })

    test('passes when empty object is expected (no constraints)', async () => {
      await expect(
        assertThrows(() => { throw new Error('anything') }, {})
      ).resolves.toBeUndefined()
    })
  })

  test('no expected argument — just checks that something was thrown', async () => {
    await expect(
      assertThrows(() => { throw new TypeError('type error') })
    ).resolves.toBeUndefined()
  })
})


describe('assertNotThrows', () => {
  test('passes when sync function returns normally', async () => {
    await expect(
      assertNotThrows(() => 42)
    ).resolves.toBeUndefined()
  })

  test('passes when async function resolves', async () => {
    await expect(
      assertNotThrows(async () => 'resolved value')
    ).resolves.toBeUndefined()
  })

  test('passes when function returns undefined', async () => {
    await expect(
      assertNotThrows(() => undefined)
    ).resolves.toBeUndefined()
  })

  test('passes when function returns null', async () => {
    await expect(
      assertNotThrows(() => null)
    ).resolves.toBeUndefined()
  })

  test('fails when sync function throws', async () => {
    await expect(
      assertNotThrows(() => { throw new Error('unexpected error') })
    ).rejects.toThrow('Expected function not to throw, but got: unexpected error')
  })

  test('fails when async function rejects', async () => {
    await expect(
      assertNotThrows(async () => { throw new Error('async fail') })
    ).rejects.toThrow('Expected function not to throw, but got: async fail')
  })

  test('error message includes the original error message', async () => {
    let caughtMessage = ''
    try {
      await assertNotThrows(() => { throw new Error('the real problem') })
    } catch (e: any) {
      caughtMessage = e.message
    }
    expect(caughtMessage).toContain('the real problem')
  })

  test('passes when function does async work and resolves', async () => {
    await expect(
      assertNotThrows(async () => {
        await new Promise(r => setTimeout(r, 0))
        return 'done'
      })
    ).resolves.toBeUndefined()
  })
})


describe('defineFactory — complex types', () => {
  type Product = { name: string; price: number; inStock: boolean; tags: string[] }

  const ProductFactory = defineFactory<Product>(() => ({
    name: 'Widget',
    price: 9.99,
    inStock: true,
    tags: ['electronics'],
  }))

  test('make() returns correct defaults for complex type', () => {
    const p = ProductFactory.make()
    expect(p.name).toBe('Widget')
    expect(p.price).toBe(9.99)
    expect(p.inStock).toBe(true)
    expect(p.tags).toEqual(['electronics'])
  })

  test('override array field', () => {
    const p = ProductFactory.make({ tags: ['sale', 'new'] })
    expect(p.tags).toEqual(['sale', 'new'])
  })

  test('override boolean field', () => {
    const p = ProductFactory.make({ inStock: false })
    expect(p.inStock).toBe(false)
  })

  test('override numeric field', () => {
    const p = ProductFactory.make({ price: 0 })
    expect(p.price).toBe(0)
  })

  test('makeMany with overrides on complex type', () => {
    const products = ProductFactory.makeMany(3, { inStock: false })
    for (const p of products) {
      expect(p.inStock).toBe(false)
      expect(p.name).toBe('Widget')
    }
  })

  test('state with function returning partial', () => {
    const SaleFactory = ProductFactory.state(() => ({ price: 4.99, tags: ['sale'] }))
    const p = SaleFactory.make()
    expect(p.price).toBe(4.99)
    expect(p.tags).toEqual(['sale'])
    expect(p.name).toBe('Widget')
  })

  test('state chaining on complex type', () => {
    const OutOfStock = ProductFactory.state({ inStock: false })
    const CheapOutOfStock = OutOfStock.state({ price: 1.00 })
    const p = CheapOutOfStock.make()
    expect(p.inStock).toBe(false)
    expect(p.price).toBe(1.00)
  })

  test('makeMany(10) returns 10 items', () => {
    expect(ProductFactory.makeMany(10)).toHaveLength(10)
  })
})

describe('fakeTime — additional scenarios', () => {
  let restore: (() => void) | null = null
  afterEach(() => { if (restore) { restore(); restore = null } })

  test('frozen time at epoch zero', () => {
    restore = fakeTime(new Date(0))
    expect(Date.now()).toBe(0)
  })

  test('frozen time at far future', () => {
    const future = new Date('2099-12-31T23:59:59Z')
    restore = fakeTime(future)
    expect(Date.now()).toBe(future.getTime())
  })

  test('new Date() toString includes frozen year', () => {
    restore = fakeTime(new Date('2023-06-15T00:00:00Z'))
    const d = new Date()
    expect(d.getFullYear()).toBe(2023)
  })

  test('new Date(timestamp) still works when time is faked', () => {
    restore = fakeTime(new Date('2025-01-01T00:00:00Z'))
    const d = new Date(0)
    expect(d.getTime()).toBe(0)
  })
})

describe('assertThrows — additional error types', () => {
  test('catches TypeError', async () => {
    await expect(
      assertThrows(() => { throw new TypeError('type error') })
    ).resolves.toBeUndefined()
  })

  test('catches RangeError', async () => {
    await expect(
      assertThrows(() => { throw new RangeError('range error') })
    ).resolves.toBeUndefined()
  })

  test('matches message on TypeError', async () => {
    await expect(
      assertThrows(() => { throw new TypeError('bad type') }, 'bad type')
    ).resolves.toBeUndefined()
  })

  test('regex match on async error', async () => {
    await expect(
      assertThrows(async () => { throw new Error('connection timeout after 5000ms') }, /timeout/)
    ).resolves.toBeUndefined()
  })

  test('object match with only statusCode on async', async () => {
    const err: any = new Error('x')
    err.statusCode = 503
    await expect(
      assertThrows(async () => { throw err }, { statusCode: 503 })
    ).resolves.toBeUndefined()
  })

  test('object match with code and statusCode', async () => {
    const err: any = new Error('forbidden')
    err.code = 'FORBIDDEN'
    err.statusCode = 403
    await expect(
      assertThrows(() => { throw err }, { code: 'FORBIDDEN', statusCode: 403 })
    ).resolves.toBeUndefined()
  })
})

describe('assertNotThrows — additional scenarios', () => {
  test('passes for function returning empty string', async () => {
    await expect(assertNotThrows(() => '')).resolves.toBeUndefined()
  })

  test('passes for function returning zero', async () => {
    await expect(assertNotThrows(() => 0)).resolves.toBeUndefined()
  })

  test('passes for function returning false', async () => {
    await expect(assertNotThrows(() => false)).resolves.toBeUndefined()
  })

  test('passes for async function returning object', async () => {
    await expect(assertNotThrows(async () => ({ key: 'value' }))).resolves.toBeUndefined()
  })
})

describe('defineFactory — nested factory', () => {
  type Address = { street: string; city: string; zip: string }

  const AddressFactory = defineFactory<Address>(() => ({
    street: '123 Main St',
    city: 'Springfield',
    zip: '62701',
  }))

  test('make returns nested defaults', () => {
    const addr = AddressFactory.make()
    expect(addr.street).toBe('123 Main St')
    expect(addr.city).toBe('Springfield')
    expect(addr.zip).toBe('62701')
  })

  test('override city', () => {
    const addr = AddressFactory.make({ city: 'Shelbyville' })
    expect(addr.city).toBe('Shelbyville')
    expect(addr.street).toBe('123 Main St')
  })

  test('state with different zip', () => {
    const CAFactory = AddressFactory.state({ zip: '90210', city: 'Beverly Hills' })
    const addr = CAFactory.make()
    expect(addr.zip).toBe('90210')
    expect(addr.city).toBe('Beverly Hills')
  })

  test('makeMany with state', () => {
    const NYFactory = AddressFactory.state({ city: 'New York' })
    const addrs = NYFactory.makeMany(5)
    expect(addrs).toHaveLength(5)
    for (const a of addrs) expect(a.city).toBe('New York')
  })
})

describe('defineFactory — factory with boolean defaults', () => {
  type Feature = { enabled: boolean; name: string; priority: number }

  const FeatureFactory = defineFactory<Feature>(() => ({
    enabled: false,
    name: 'Default Feature',
    priority: 0,
  }))

  test('defaults have correct types', () => {
    const f = FeatureFactory.make()
    expect(typeof f.enabled).toBe('boolean')
    expect(typeof f.name).toBe('string')
    expect(typeof f.priority).toBe('number')
  })

  test('override boolean to true', () => {
    const f = FeatureFactory.make({ enabled: true })
    expect(f.enabled).toBe(true)
  })

  test('state with enabled true', () => {
    const EnabledFactory = FeatureFactory.state({ enabled: true })
    expect(EnabledFactory.make().enabled).toBe(true)
  })

  test('make returns independent objects', () => {
    const a = FeatureFactory.make()
    const b = FeatureFactory.make()
    a.priority = 99
    expect(b.priority).toBe(0)
  })
})

describe('fakeTime — edge cases', () => {
  let restore: (() => void) | null = null
  afterEach(() => { if (restore) { restore(); restore = null } })

  test('fakeTime with negative timestamp', () => {
    const old = new Date('1969-01-01T00:00:00Z')
    restore = fakeTime(old)
    expect(Date.now()).toBe(old.getTime())
  })

  test('fakeTime preserves Date.parse', () => {
    restore = fakeTime(new Date('2025-01-01'))
    expect(typeof Date.parse('2020-01-01')).toBe('number')
  })

  test('new Date(numericTimestamp) parses as a number, not a string', () => {
    restore = fakeTime(new Date('2025-01-01T00:00:00Z'))
    const ts = 1_700_000_000_000
    // Regression: the override used to coerce numbers to string, so
    // new Date(ts) produced an Invalid Date.
    expect(new Date(ts).getTime()).toBe(ts)
  })

  test('new Date(iso string) still parses correctly under fakeTime', () => {
    restore = fakeTime(new Date('2025-01-01T00:00:00Z'))
    expect(new Date('2020-06-15T00:00:00Z').getUTCFullYear()).toBe(2020)
  })

  test('new Date(year, month, day) component form works under fakeTime', () => {
    restore = fakeTime(new Date('2025-01-01T00:00:00Z'))
    const d = new (Date as any)(2021, 0, 15)
    expect(d.getFullYear()).toBe(2021)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(15)
  })
})

describe('defineFactory — empty defaults', () => {
  type Empty = {}
  const EmptyFactory = defineFactory<Empty>(() => ({}))

  test('make returns empty object', () => {
    expect(EmptyFactory.make()).toEqual({})
  })

  test('makeMany returns array of empty objects', () => {
    const items = EmptyFactory.makeMany(3)
    expect(items).toHaveLength(3)
    for (const item of items) expect(item).toEqual({})
  })

  test('state on empty factory adds fields', () => {
    const WithName = EmptyFactory.state({ name: 'test' } as any)
    expect((WithName.make() as any).name).toBe('test')
  })
})

describe('defineFactory — large makeMany', () => {
  type Simple = { id: number }
  const SimpleFactory = defineFactory<Simple>(() => ({ id: 0 }))

  test('makeMany(50) returns 50 items', () => {
    expect(SimpleFactory.makeMany(50)).toHaveLength(50)
  })

  test('makeMany(100) returns 100 items', () => {
    expect(SimpleFactory.makeMany(100)).toHaveLength(100)
  })

  test('all items from makeMany are independent', () => {
    const items = SimpleFactory.makeMany(5)
    items[0].id = 999
    expect(items[1].id).toBe(0)
  })
})
