import { test, expect, describe } from 'bun:test'

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype'])

function safeParseQuery(pairs: [string, string][]): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [rawKey, rawVal] of pairs) {
    const keys = rawKey.includes('[') ? rawKey.replace(/]/g, '').split('[').slice(0, 6) : [rawKey]
    let obj = result
    let poisoned = false
    for (let i = 0; i < keys.length - 1; i++) {
      if (BLOCKED.has(keys[i])) { poisoned = true; break }
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {}
      obj = obj[keys[i]]
    }
    if (poisoned) continue
    const lastKey = keys[keys.length - 1]
    if (BLOCKED.has(lastKey)) continue
    obj[lastKey] = rawVal
  }
  return result
}

describe('Prototype pollution — __proto__ attacks', () => {
  test('__proto__[polluted] is blocked', () => {
    const r = safeParseQuery([['__proto__[polluted]', 'yes']])
    expect(({} as any).polluted).toBeUndefined()
  })

  test('a[__proto__][polluted] is blocked', () => {
    const r = safeParseQuery([['a[__proto__][polluted]', 'yes']])
    expect(({} as any).polluted).toBeUndefined()
  })

  test('a[b][__proto__][isAdmin] is blocked', () => {
    const r = safeParseQuery([['a[b][__proto__][isAdmin]', 'true']])
    expect(({} as any).isAdmin).toBeUndefined()
  })

  test('__proto__ as last key is blocked', () => {
    const r = safeParseQuery([['__proto__', 'evil']])
    expect(Object.keys(r)).not.toContain('__proto__')
  })
})

describe('Prototype pollution — constructor attacks', () => {
  test('constructor[prototype][polluted] is blocked', () => {
    const r = safeParseQuery([['constructor[prototype][polluted]', 'yes']])
    expect(({} as any).polluted).toBeUndefined()
  })

  test('a[constructor][prototype][x] is blocked', () => {
    const r = safeParseQuery([['a[constructor][prototype][x]', '1']])
    expect(({} as any).x).toBeUndefined()
  })

  test('constructor as last key is blocked', () => {
    const r = safeParseQuery([['constructor', 'evil']])
    expect(Object.keys(r)).not.toContain('constructor')
  })
})

describe('Prototype pollution — prototype key', () => {
  test('prototype[polluted] is blocked', () => {
    const r = safeParseQuery([['prototype[polluted]', 'yes']])
    expect(({} as any).polluted).toBeUndefined()
  })

  test('a[prototype][x] is blocked', () => {
    const r = safeParseQuery([['a[prototype][x]', '1']])
    expect(({} as any).x).toBeUndefined()
  })
})

describe('Prototype pollution — normal keys pass through', () => {
  test('simple key=value', () => {
    const r = safeParseQuery([['name', 'Ali']])
    expect(r.name).toBe('Ali')
  })

  test('nested a[b]=value', () => {
    const r = safeParseQuery([['a[b]', 'val']])
    expect(r.a.b).toBe('val')
  })

  test('deeply nested a[b][c][d]=value', () => {
    const r = safeParseQuery([['a[b][c][d]', 'deep']])
    expect(r.a.b.c.d).toBe('deep')
  })

  test('multiple keys', () => {
    const r = safeParseQuery([['name', 'Ali'], ['email', 'ali@test.com'], ['age', '30']])
    expect(r.name).toBe('Ali')
    expect(r.email).toBe('ali@test.com')
    expect(r.age).toBe('30')
  })

  test('proto without underscores is allowed', () => {
    const r = safeParseQuery([['proto', 'value']])
    expect(r.proto).toBe('value')
  })

  test('construct is allowed', () => {
    const r = safeParseQuery([['construct', 'value']])
    expect(r.construct).toBe('value')
  })

  test('prototyped is allowed', () => {
    const r = safeParseQuery([['prototyped', 'value']])
    expect(r.prototyped).toBe('value')
  })

  test('__proto is allowed (single underscore)', () => {
    const r = safeParseQuery([['__proto', 'value']])
    expect(r.__proto).toBe('value')
  })
})

describe('Prototype pollution — Object.prototype verification', () => {
  test('Object.prototype.toString is intact', () => {
    expect(({}).toString()).toBe('[object Object]')
  })

  test('Object.prototype has no polluted keys', () => {
    const proto = Object.getOwnPropertyNames(Object.prototype)
    expect(proto).not.toContain('polluted')
    expect(proto).not.toContain('isAdmin')
    expect(proto).not.toContain('x')
  })

  test('new empty objects have no extra properties', () => {
    const obj: any = {}
    expect(obj.polluted).toBeUndefined()
    expect(obj.isAdmin).toBeUndefined()
    expect(obj.x).toBeUndefined()
  })

  test('Array.prototype is not polluted', () => {
    const arr: any = []
    expect(arr.polluted).toBeUndefined()
    expect(arr.isAdmin).toBeUndefined()
  })
})
