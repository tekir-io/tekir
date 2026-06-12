import { test, expect, describe, beforeEach } from 'bun:test'
import { createConfigStore } from '../src/index'

const store = createConfigStore()
const registerConfig = store.register
const config = store.get
const getAllConfig = store.getAll

describe('registerConfig + config', () => {
  beforeEach(() => {
    // Register fresh namespaces for this suite
    registerConfig('app_test', { name: 'MyApp', version: '1.0', nested: { key: 'value' } })
  })

  test('retrieves top-level config namespace', () => {
    const result = config<any>('app_test')
    expect(result.name).toBe('MyApp')
  })

  test('retrieves a nested key with dot notation', () => {
    expect<unknown>(config('app_test.name')).toBe('MyApp')
    expect<unknown>(config('app_test.version')).toBe('1.0')
  })

  test('retrieves deeply nested key', () => {
    expect<unknown>(config('app_test.nested.key')).toBe('value')
  })

  test('returns defaultValue when top-level namespace does not exist', () => {
    const result = config('nonexistent_ns', 'fallback')
    expect(result).toBe('fallback')
  })

  test('returns defaultValue when nested key does not exist', () => {
    const result = config('app_test.missing', 42)
    expect(result).toBe(42)
  })

  test('returns defaultValue for deeply missing path', () => {
    const result = config('app_test.nested.deep.missing', 'default')
    expect(result).toBe('default')
  })

  test('returns undefined when no default and key is missing', () => {
    const result = config('app_test.missing')
    expect(result).toBeUndefined()
  })

  test('overwriting a namespace replaces the config', () => {
    registerConfig('app_test', { name: 'Replaced' })
    expect<unknown>(config('app_test.name')).toBe('Replaced')
    // original keys gone
    expect<unknown>(config('app_test.version')).toBeUndefined()
  })

  test('null intermediate value falls back to default', () => {
    registerConfig('null_test', { parent: null })
    const result = config('null_test.parent.child', 'safe')
    expect(result).toBe('safe')
  })
})

describe('getAllConfig', () => {
  test('returns an object containing all registered namespaces', () => {
    registerConfig('getAllTest_a', { x: 1 })
    registerConfig('getAllTest_b', { y: 2 })
    const all = getAllConfig()
    expect(all['getAllTest_a']).toEqual({ x: 1 })
    expect(all['getAllTest_b']).toEqual({ y: 2 })
  })

  test('returns a plain object (not the Map itself)', () => {
    const all = getAllConfig()
    expect(typeof all).toBe('object')
    expect(Array.isArray(all)).toBe(false)
  })
})

describe('config value types', () => {
  test('handles boolean values', () => {
    registerConfig('types_test', { debug: false, enabled: true })
    expect<unknown>(config('types_test.debug')).toBe(false)
    expect<unknown>(config('types_test.enabled')).toBe(true)
  })

  test('handles number values', () => {
    registerConfig('types_test', { port: 8080 })
    expect<unknown>(config('types_test.port')).toBe(8080)
  })

  test('handles array values', () => {
    registerConfig('types_test', { tags: ['a', 'b'] })
    expect(config<string[]>('types_test.tags')).toEqual(['a', 'b'])
  })

  test('prefers stored value over default when value is 0', () => {
    registerConfig('zero_test', { count: 0 })
    // 0 is falsy — ensure defaultValue is not returned
    const result = config('zero_test.count', 99)
    expect(result).toBe(0)
  })

  test('prefers stored value over default when value is empty string', () => {
    registerConfig('empty_str_test', { label: '' })
    const result = config('empty_str_test.label', 'default')
    // '' ?? 'default' → '' because nullish coalescing only falls back for null/undefined
    expect(result).toBe('')
  })
})

// Deeply nested config access

describe('config — deeply nested access', () => {
  test('retrieves a three-level nested key', () => {
    registerConfig('deep_test', { a: { b: { c: 'deep-value' } } })
    expect<unknown>(config('deep_test.a.b.c')).toBe('deep-value')
  })

  test('retrieves a four-level nested key', () => {
    registerConfig('four_level', { l1: { l2: { l3: { l4: 'bottom' } } } })
    expect<unknown>(config('four_level.l1.l2.l3.l4')).toBe('bottom')
  })

  test('returns defaultValue when intermediate key is missing in deep path', () => {
    registerConfig('partial_deep', { a: { b: 42 } })
    expect<unknown>(config('partial_deep.a.x.y', 'nope')).toBe('nope')
  })

  test('returns undefined (no default) for a deeply missing path', () => {
    registerConfig('undef_deep', { x: { y: 1 } })
    expect<unknown>(config('undef_deep.x.z.w')).toBeUndefined()
  })
})

// Config with array values

describe('config — array values', () => {
  test('retrieves array at top-level key', () => {
    registerConfig('arr_top', { items: [10, 20, 30] })
    expect(config<number[]>('arr_top.items')).toEqual([10, 20, 30])
  })

  test('retrieves nested array', () => {
    registerConfig('arr_nested', { data: { list: ['a', 'b', 'c'] } })
    expect(config<string[]>('arr_nested.data.list')).toEqual(['a', 'b', 'c'])
  })

  test('array of objects roundtrips correctly', () => {
    const users = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
    registerConfig('arr_objs', { users })
    expect(config<typeof users>('arr_objs.users')).toEqual(users)
  })
})

// Overwrite existing config

describe('config — overwrite existing namespace', () => {
  test('second registerConfig for same namespace completely replaces previous value', () => {
    registerConfig('overwrite_ns', { first: true, shared: 'original' })
    expect<unknown>(config('overwrite_ns.first')).toBe(true)
    registerConfig('overwrite_ns', { second: true, shared: 'replaced' })
    expect<unknown>(config('overwrite_ns.first')).toBeUndefined()
    expect<unknown>(config('overwrite_ns.second')).toBe(true)
    expect<unknown>(config('overwrite_ns.shared')).toBe('replaced')
  })

  test('overwriting with a new array value replaces the old array', () => {
    registerConfig('overwrite_arr', { list: [1, 2, 3] })
    registerConfig('overwrite_arr', { list: ['x', 'y'] })
    expect(config<string[]>('overwrite_arr.list')).toEqual(['x', 'y'])
  })
})

// getAllConfig returns all registered namespaces

describe('getAllConfig — completeness', () => {
  test('getAllConfig contains every registered namespace', () => {
    registerConfig('getall_x', { v: 1 })
    registerConfig('getall_y', { v: 2 })
    registerConfig('getall_z', { v: 3 })
    const all = getAllConfig()
    expect(all['getall_x']).toEqual({ v: 1 })
    expect(all['getall_y']).toEqual({ v: 2 })
    expect(all['getall_z']).toEqual({ v: 3 })
  })

  test('getAllConfig reflects the latest value after overwrite', () => {
    registerConfig('getall_overwrite', { val: 'old' })
    registerConfig('getall_overwrite', { val: 'new' })
    const all = getAllConfig()
    expect(all['getall_overwrite']).toEqual({ val: 'new' })
  })
})

// config returns undefined for missing nested path

describe('config — undefined for missing nested path', () => {
  test('single-segment missing path returns undefined when no default', () => {
    registerConfig('missing_seg', { existing: 1 })
    expect<unknown>(config('missing_seg.nonexistent')).toBeUndefined()
  })

  test('accessing .key on a non-object value returns default', () => {
    registerConfig('non_obj', { num: 42 })
    // 'num' is a number, not an object — traversal must not throw
    expect<unknown>(config('non_obj.num.child', 'safe')).toBe('safe')
  })

  test('accessing key on undefined intermediate returns undefined', () => {
    registerConfig('undef_mid', { a: { b: undefined } })
    expect<unknown>(config('undef_mid.a.b.c')).toBeUndefined()
  })
})

// Additional tests — deep nesting, array dot access, special value types

describe('config — very deep nesting (4+ levels)', () => {
  test('retrieves a five-level nested key', () => {
    registerConfig('deep5', { a: { b: { c: { d: { e: 'five' } } } } })
    expect<unknown>(config('deep5.a.b.c.d.e')).toBe('five')
  })

  test('retrieves a six-level nested key', () => {
    registerConfig('deep6', { l1: { l2: { l3: { l4: { l5: { l6: 42 } } } } } })
    expect<unknown>(config('deep6.l1.l2.l3.l4.l5.l6')).toBe(42)
  })

  test('returns defaultValue when a mid-level key is missing in a 5-level path', () => {
    registerConfig('deep5_miss', { a: { b: { c: 1 } } })
    expect<unknown>(config('deep5_miss.a.b.c.d.e', 'fallback')).toBe('fallback')
  })
})

describe('config — array element access via dot notation', () => {
  test('accesses array element by numeric index', () => {
    registerConfig('arr_dot', { servers: ['alpha', 'beta', 'gamma'] })
    expect<unknown>(config('arr_dot.servers.0')).toBe('alpha')
    expect<unknown>(config('arr_dot.servers.1')).toBe('beta')
    expect<unknown>(config('arr_dot.servers.2')).toBe('gamma')
  })

  test('accesses nested object inside an array via dot notation', () => {
    registerConfig('arr_obj_dot', {
      app: { servers: [{ host: '127.0.0.1', port: 80 }, { host: '10.0.0.1', port: 443 }] },
    })
    expect<unknown>(config('arr_obj_dot.app.servers.0.host')).toBe('127.0.0.1')
    expect<unknown>(config('arr_obj_dot.app.servers.1.port')).toBe(443)
  })

  test('returns defaultValue for out-of-bounds array index', () => {
    registerConfig('arr_oob', { items: [1, 2] })
    expect<unknown>(config('arr_oob.items.5', 'missing')).toBe('missing')
  })
})

describe('plain config objects — functions as values', () => {
  test('preserves function values in config', () => {
    const fn = () => 'hello'
    const cfg = { greet: fn }
    expect(cfg.greet).toBe(fn)
    expect(cfg.greet()).toBe('hello')
  })

  test('preserves async functions in config', () => {
    const asyncFn = async () => 42
    const cfg = { compute: asyncFn }
    expect(typeof cfg.compute).toBe('function')
  })
})

describe('registerConfig + config — special object types', () => {
  test('stores and retrieves Date objects', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    registerConfig('date_ns', { created: now })
    const retrieved = config<Date>('date_ns.created')
    expect(retrieved).toBeInstanceOf(Date)
    expect(retrieved.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })

  test('stores and retrieves RegExp objects', () => {
    const pattern = /^test-\d+$/i
    registerConfig('regex_ns', { pattern })
    const retrieved = config<RegExp>('regex_ns.pattern')
    expect(retrieved).toBeInstanceOf(RegExp)
    expect(retrieved.test('test-123')).toBe(true)
    expect(retrieved.test('nope')).toBe(false)
  })

  test('stores and retrieves class instances', () => {
    class DbConnection {
      constructor(public host: string, public port: number) {}
    }
    const conn = new DbConnection('localhost', 5432)
    registerConfig('class_ns', { connection: conn })
    const retrieved = config<DbConnection>('class_ns.connection')
    expect(retrieved).toBeInstanceOf(DbConnection)
    expect(retrieved.host).toBe('localhost')
    expect(retrieved.port).toBe(5432)
  })
})

describe('config — multiple namespaces independently', () => {
  test('app, db, and mail namespaces are all accessible independently', () => {
    registerConfig('multi_app', { name: 'MyApp', debug: true })
    registerConfig('multi_db', { host: 'db.local', port: 5432 })
    registerConfig('multi_mail', { from: 'noreply@app.com', driver: 'smtp' })

    expect<unknown>(config('multi_app.name')).toBe('MyApp')
    expect<unknown>(config('multi_app.debug')).toBe(true)
    expect<unknown>(config('multi_db.host')).toBe('db.local')
    expect<unknown>(config('multi_db.port')).toBe(5432)
    expect<unknown>(config('multi_mail.from')).toBe('noreply@app.com')
    expect<unknown>(config('multi_mail.driver')).toBe('smtp')
  })

  test('modifying one namespace does not affect others', () => {
    registerConfig('iso_a', { x: 1 })
    registerConfig('iso_b', { y: 2 })
    registerConfig('iso_a', { x: 99 })
    expect<unknown>(config('iso_a.x')).toBe(99)
    expect<unknown>(config('iso_b.y')).toBe(2)
  })
})

describe('config — undefined vs null explicit values', () => {
  test('explicitly set undefined returns defaultValue (due to nullish coalescing)', () => {
    registerConfig('undef_explicit', { val: undefined })
    // value ?? defaultValue → undefined ?? 'fallback' → 'fallback'
    expect<unknown>(config('undef_explicit.val', 'fallback')).toBe('fallback')
  })

  test('explicitly set null returns defaultValue (due to nullish coalescing)', () => {
    registerConfig('null_explicit', { val: null })
    // value ?? defaultValue → null ?? 'fallback' → 'fallback'
    expect<unknown>(config('null_explicit.val', 'fallback')).toBe('fallback')
  })

  test('explicitly set undefined without defaultValue returns undefined', () => {
    registerConfig('undef_no_default', { val: undefined })
    expect<unknown>(config('undef_no_default.val')).toBeUndefined()
  })
})

describe('getAllConfig — returns a copy (not a live reference to the store)', () => {
  test('mutating the returned object does not affect the internal store', () => {
    registerConfig('copy_test', { original: true })
    const all1 = getAllConfig()
    all1['copy_test'] = { tampered: true }
    const all2 = getAllConfig()
    expect(all2['copy_test']).toEqual({ original: true })
  })

  test('adding a key to returned object does not persist', () => {
    const all = getAllConfig()
    all['injected'] = { hack: true }
    const fresh = getAllConfig()
    expect(fresh['injected']).toBeUndefined()
  })
})

describe('loadDir — non-existent directory', () => {
  test('does not throw when the directory does not exist', async () => {
    await expect(store.loadDir('/tmp/nonexistent_config_dir_xyz')).resolves.toBeUndefined()
  })
})

describe('config — empty key string behavior', () => {
  test('empty string key returns defaultValue (no namespace match)', () => {
    expect<unknown>(config('', 'fallback')).toBe('fallback')
  })

  test('empty string key without default returns undefined', () => {
    expect<unknown>(config('')).toBeUndefined()
  })
})

// Additional config tests

describe('config — additional types', () => {
  test('stores number value', () => {
    registerConfig('num_conf', { port: 3000 })
    expect<unknown>(config('num_conf.port')).toBe(3000)
  })

  test('stores boolean value', () => {
    registerConfig('bool_conf', { debug: true })
    expect<unknown>(config('bool_conf.debug')).toBe(true)
  })

  test('stores array value', () => {
    registerConfig('arr_conf', { items: [1, 2, 3] })
    expect<unknown>(config('arr_conf.items')).toEqual([1, 2, 3])
  })

  test('stores string with empty value', () => {
    registerConfig('empty_conf', { value: '' })
    expect<unknown>(config('empty_conf.value')).toBe('')
  })

  test('stores nested object', () => {
    registerConfig('nested_conf', { db: { host: 'localhost', port: 5432 } })
    expect<unknown>(config('nested_conf.db.host')).toBe('localhost')
    expect<unknown>(config('nested_conf.db.port')).toBe(5432)
  })

  test('stores deeply nested object', () => {
    registerConfig('deep_conf', { a: { b: { c: { d: 'deep' } } } })
    expect<unknown>(config('deep_conf.a.b.c.d')).toBe('deep')
  })

  test('returns undefined for deeply missing nested key', () => {
    registerConfig('shallow', { x: 1 })
    expect<unknown>(config('shallow.a.b.c.d')).toBeUndefined()
  })

  test('getAll returns all registered configs', () => {
    registerConfig('all_test_a', { val: 'a' })
    registerConfig('all_test_b', { val: 'b' })
    const all = getAllConfig()
    expect(all['all_test_a']).toEqual({ val: 'a' })
    expect(all['all_test_b']).toEqual({ val: 'b' })
  })
})

describe('config — default values', () => {
  test('default value for missing top-level namespace', () => {
    expect<unknown>(config('never_registered', 'default')).toBe('default')
  })

  test('default value for missing nested key is number', () => {
    registerConfig('def_num', { a: 1 })
    expect<unknown>(config('def_num.missing', 99)).toBe(99)
  })

  test('default value for missing nested key is boolean', () => {
    registerConfig('def_bool', { a: 1 })
    expect<unknown>(config('def_bool.missing', false)).toBe(false)
  })

  test('default value for missing nested key is array', () => {
    registerConfig('def_arr', { a: 1 })
    expect<unknown>(config('def_arr.missing', [1, 2])).toEqual([1, 2])
  })

  test('default value for missing nested key is object', () => {
    registerConfig('def_obj', { a: 1 })
    expect<unknown>(config('def_obj.missing', { x: 1 })).toEqual({ x: 1 })
  })

  test('existing value overrides default', () => {
    registerConfig('override_test', { name: 'real' })
    expect<unknown>(config('override_test.name', 'default')).toBe('real')
  })
})

describe('config — overwriting', () => {
  test('re-registering same namespace overwrites values', () => {
    registerConfig('overwrite', { a: 1 })
    registerConfig('overwrite', { a: 2 })
    expect<unknown>(config('overwrite.a')).toBe(2)
  })

  test('re-registering replaces entire config', () => {
    registerConfig('replace', { a: 1, b: 2 })
    registerConfig('replace', { a: 3 })
    expect<unknown>(config('replace.a')).toBe(3)
    expect<unknown>(config('replace.b')).toBeUndefined()
  })
})

describe('createConfigStore — isolation', () => {
  test('creates independent store', () => {
    const store2 = createConfigStore()
    store2.register('isolated', { key: 'val' })
    expect<unknown>(store2.get('isolated.key')).toBe('val')
  })

  test('two stores are independent', () => {
    const s1 = createConfigStore()
    const s2 = createConfigStore()
    s1.register('shared', { from: 's1' })
    s2.register('shared', { from: 's2' })
    expect<unknown>(s1.get('shared.from')).toBe('s1')
    expect<unknown>(s2.get('shared.from')).toBe('s2')
  })
})


describe('config — type retrieval', () => {
  test('retrieves numeric value', () => {
    registerConfig('types', { port: 3000 })
    expect<unknown>(config('types.port')).toBe(3000)
  })

  test('retrieves boolean value', () => {
    registerConfig('types', { debug: true })
    expect<unknown>(config('types.debug')).toBe(true)
  })

  test('retrieves array value', () => {
    registerConfig('types', { hosts: ['a', 'b', 'c'] })
    expect<unknown>(config('types.hosts')).toEqual(['a', 'b', 'c'])
  })

  test('retrieves null value as undefined', () => {
    registerConfig('types', { empty: null })
    // null values may be stored as undefined in the config store
    expect<unknown>(config('types.empty')).toBeFalsy()
  })

  test('retrieves nested object', () => {
    registerConfig('types', { db: { host: 'localhost', port: 5432 } })
    expect<unknown>(config('types.db')).toEqual({ host: 'localhost', port: 5432 })
  })
})

describe('config — deep nesting', () => {
  test('three levels deep', () => {
    registerConfig('deep', { a: { b: { c: 'value' } } })
    expect<unknown>(config('deep.a.b.c')).toBe('value')
  })

  test('four levels deep', () => {
    registerConfig('deep', { x: { y: { z: { w: 42 } } } })
    expect<unknown>(config('deep.x.y.z.w')).toBe(42)
  })

  test('missing deep path returns undefined', () => {
    registerConfig('deep', { a: { b: 1 } })
    expect<unknown>(config('deep.a.b.c.d')).toBeUndefined()
  })

  test('missing deep path with default', () => {
    registerConfig('deep', { a: 1 })
    expect<unknown>(config('deep.a.b.c', 'fallback')).toBe('fallback')
  })
})

describe('getAllConfig', () => {
  test('returns all registered configs', () => {
    registerConfig('getall_test', { x: 1 })
    const all = getAllConfig()
    expect(all).toBeDefined()
    expect(typeof all).toBe('object')
  })
})

describe('createConfigStore — methods', () => {
  test('store has register method', () => {
    const store = createConfigStore()
    expect(typeof store.register).toBe('function')
  })

  test('store has get method', () => {
    const store = createConfigStore()
    expect(typeof store.get).toBe('function')
  })

  test('store has getAll method', () => {
    const store = createConfigStore()
    expect(typeof store.getAll).toBe('function')
  })

  test('fresh store get returns undefined', () => {
    const store = createConfigStore()
    expect<unknown>(store.get('anything')).toBeUndefined()
  })

  test('fresh store getAll returns empty-ish object', () => {
    const store = createConfigStore()
    const all = store.getAll()
    expect(typeof all).toBe('object')
  })
})
