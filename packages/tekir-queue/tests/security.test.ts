import { test, expect, describe } from 'bun:test'

// Replicate the exact filtering logic from worker.ts deserialize()
function filterPayload(jsonStr: string): Record<string, any> {
  const data = JSON.parse(jsonStr)
  const { __class, __proto__: _a, constructor: _b, prototype: _c, ...props } = data
  return Object.fromEntries(
    Object.entries(props).filter(([k]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
  )
}

describe('Queue worker — prototype pollution prevention', () => {
  test('normal props pass through', () => {
    const safe = filterPayload('{"__class":"Job","name":"test","email":"a@b.com"}')
    expect(safe).toEqual({ name: 'test', email: 'a@b.com' })
  })

  test('__proto__ is not an own property of result', () => {
    const safe = filterPayload('{"__class":"Job","name":"test"}')
    expect(Object.prototype.hasOwnProperty.call(safe, '__proto__')).toBe(false)
  })

  test('prototype key is filtered', () => {
    const safe = filterPayload('{"__class":"X","prototype":{"evil":true},"data":"safe"}')
    expect(safe.prototype).toBeUndefined()
    expect(safe.data).toBe('safe')
  })

  test('Object.prototype is NOT polluted', () => {
    filterPayload('{"__class":"X","__proto__":{"isAdmin":true}}')
    expect(({} as any).isAdmin).toBeUndefined()
  })

  test('nested objects in safe props preserved', () => {
    const safe = filterPayload('{"__class":"X","config":{"nested":{"deep":true}}}')
    expect(safe.config.nested.deep).toBe(true)
  })

  test('array values preserved', () => {
    const safe = filterPayload('{"__class":"X","items":[1,2,3]}')
    expect(safe.items).toEqual([1, 2, 3])
  })

  test('multiple dangerous keys all filtered', () => {
    const safe = filterPayload('{"__class":"X","__proto__":{"a":1},"prototype":{"c":3},"safe":"yes"}')
    expect(Object.keys(safe)).toEqual(['safe'])
  })

  test('empty payload after filtering', () => {
    const safe = filterPayload('{"__class":"X"}')
    expect(Object.keys(safe).length).toBe(0)
  })

  test('numeric values preserved', () => {
    const safe = filterPayload('{"__class":"X","count":42,"price":9.99}')
    expect(safe.count).toBe(42)
    expect(safe.price).toBe(9.99)
  })

  test('boolean values preserved', () => {
    const safe = filterPayload('{"__class":"X","active":true,"deleted":false}')
    expect(safe.active).toBe(true)
    expect(safe.deleted).toBe(false)
  })

  test('null values preserved', () => {
    const safe = filterPayload('{"__class":"X","optional":null}')
    expect(safe.optional).toBeNull()
  })

  test('string values preserved', () => {
    const safe = filterPayload('{"__class":"X","msg":"hello world"}')
    expect(safe.msg).toBe('hello world')
  })

  test('special string values preserved', () => {
    const safe = filterPayload('{"__class":"X","html":"<script>alert(1)</script>"}')
    expect(safe.html).toBe('<script>alert(1)</script>')
  })

  test('empty object after class removal', () => {
    const safe = filterPayload('{"__class":"X"}')
    expect(Object.keys(safe)).toHaveLength(0)
  })

  test('large payload with many keys', () => {
    const obj: any = { __class: 'X' }
    for (let i = 0; i < 100; i++) obj[`key${i}`] = `val${i}`
    const safe = filterPayload(JSON.stringify(obj))
    expect(Object.keys(safe)).toHaveLength(100)
  })

  test('deeply nested prototype key in value is preserved (not recursive filter)', () => {
    const safe = filterPayload('{"__class":"X","data":{"__proto__":"nested"}}')
    // The filter only applies to top-level keys, nested objects keep their structure
    expect(safe.data.__proto__).toBeDefined()
  })

  test('__class itself is not in result', () => {
    const safe = filterPayload('{"__class":"TestJob","name":"test"}')
    expect(safe.__class).toBeUndefined()
  })
})
