import { test, expect, describe } from 'bun:test'
import { BaseModel, sanitizeFilter } from '../src/index'

// NoSQL operator injection — sanitizeFilter
//
// These tests prove that untrusted operator keys ($ne, $gt, $where, $regex,
// $function, dotted paths) are neutralized before reaching Mongoose, while
// legitimate equality filters survive.

describe('sanitizeFilter — operator stripping', () => {
  test('strips $ne (auth-bypass payload)', () => {
    expect(sanitizeFilter({ email: { $ne: null } })).toEqual({ email: {} })
  })

  test('strips $gt / $lt', () => {
    expect(sanitizeFilter({ age: { $gt: 0, $lt: 100 } })).toEqual({ age: {} })
  })

  test('strips $where server-side JS', () => {
    expect(sanitizeFilter({ $where: 'this.password.length > 0' })).toEqual({})
  })

  test('strips $function', () => {
    expect(sanitizeFilter({ $function: { body: 'return true', args: [], lang: 'js' } })).toEqual({})
  })

  test('strips $regex enumeration', () => {
    expect(sanitizeFilter({ name: { $regex: '^a' } })).toEqual({ name: {} })
  })

  test('strips dotted-path keys', () => {
    expect(sanitizeFilter({ 'user.role': 'admin' })).toEqual({})
  })

  test('strips top-level $or / $and operators', () => {
    expect(sanitizeFilter({ $or: [{ a: 1 }, { b: 2 }] })).toEqual({})
  })

  test('keeps legitimate primitive equality filters', () => {
    const f = { email: 'a@b.com', role: 'admin', active: true, count: 3 }
    expect(sanitizeFilter(f)).toEqual(f)
  })

  test('keeps null and Date values', () => {
    const d = new Date()
    expect(sanitizeFilter({ deletedAt: null, createdAt: d })).toEqual({ deletedAt: null, createdAt: d })
  })

  test('sanitizes nested objects recursively', () => {
    expect(sanitizeFilter({ profile: { name: 'x', $where: 'bad' } })).toEqual({ profile: { name: 'x' } })
  })

  test('sanitizes arrays of objects', () => {
    expect(sanitizeFilter({ tags: [{ k: 1, $ne: 2 }] })).toEqual({ tags: [{ k: 1 }] })
  })

  test('passes through primitives unchanged', () => {
    expect(sanitizeFilter('hello')).toBe('hello')
    expect(sanitizeFilter(42)).toBe(42)
    expect(sanitizeFilter(null)).toBeNull()
  })
})

// Query methods apply the sanitizer before hitting the model

describe('BaseModel query methods neutralize injection', () => {
  function stubModel() {
    const calls: { method: string; args: any[] }[] = []
    const chainable = (rows: any[] = []) => ({
      lean: async () => rows,
      skip() { return this },
      limit() { return this },
    })
    const model: any = {
      find(...args: any[]) { calls.push({ method: 'find', args }); return chainable([]) },
      findOne(...args: any[]) { calls.push({ method: 'findOne', args }); return { lean: async () => null } },
      countDocuments(...args: any[]) { calls.push({ method: 'countDocuments', args }); return 0 },
      exists(...args: any[]) { calls.push({ method: 'exists', args }); return null },
      updateMany(...args: any[]) { calls.push({ method: 'updateMany', args }); return { modifiedCount: 0 } },
      deleteMany(...args: any[]) { calls.push({ method: 'deleteMany', args }); return { deletedCount: 0 } },
    }
    return { calls, model }
  }

  function makeModel() {
    const { calls, model } = stubModel()
    class M extends BaseModel {
      static modelName = 'StubUser'
      static schema = { email: String, password: String }
      static getModel() { return model }
    }
    return { calls, M }
  }

  test('find strips $ne from filter', async () => {
    const { calls, M } = makeModel()
    await M.find({ email: { $ne: null } })
    expect(calls[0].args[0]).toEqual({ email: {} })
  })

  test('findOne strips $ne (login bypass)', async () => {
    const { calls, M } = makeModel()
    await M.findOne({ email: { $ne: null }, password: { $ne: null } })
    expect(calls[0].args[0]).toEqual({ email: {}, password: {} })
  })

  test('count strips $where', async () => {
    const { calls, M } = makeModel()
    await M.count({ $where: 'true' })
    expect(calls[0].args[0]).toEqual({})
  })

  test('exists strips operators', async () => {
    const { calls, M } = makeModel()
    await M.exists({ token: { $gt: '' } })
    expect(calls[0].args[0]).toEqual({ token: {} })
  })

  test('deleteMany cannot be widened with operators', async () => {
    const { calls, M } = makeModel()
    await M.deleteMany({ id: { $ne: 'keep-me' } })
    expect(calls[0].args[0]).toEqual({ id: {} })
  })

  test('updateMany wraps plain payload in $set and strips operators', async () => {
    const { calls, M } = makeModel()
    await M.updateMany({ role: 'user' }, { $rename: { password: 'pw' }, $set: { role: 'admin' } })
    // filter sanitized, $rename dropped, $set kept
    expect(calls[0].args[0]).toEqual({ role: 'user' })
    expect(calls[0].args[1].$rename).toBeUndefined()
    expect(calls[0].args[1].$set).toEqual({ role: 'admin' })
  })

  test('updateMany wraps a plain field map in $set', async () => {
    const { calls, M } = makeModel()
    await M.updateMany({ id: '1' }, { name: 'new' })
    expect(calls[0].args[1]).toEqual({ $set: { name: 'new' } })
  })
})

// findById rejects malformed / injected ids without throwing

describe('BaseModel.findById id validation', () => {
  class M extends BaseModel {
    static modelName = 'IdUser'
    static schema = { name: String }
    static getModel() {
      return { findById: () => ({ lean: async () => ({ _id: 'x' }) }) }
    }
  }

  test('returns null for operator-object id', async () => {
    expect(await M.findById({ $gt: '' } as any)).toBeNull()
  })

  test('returns null for non-ObjectId string', async () => {
    expect(await M.findById('not-an-object-id')).toBeNull()
  })

  test('accepts a valid ObjectId string', async () => {
    expect(await M.findById('507f1f77bcf86cd799439011')).not.toBeNull()
  })
})

describe('BaseModel write id validation', () => {
  let calls = 0
  class M extends BaseModel {
    static modelName = 'WriteIdUser'
    static schema = { name: String }
    static config = { softDeletes: true }
    static getModel() {
      return {
        findByIdAndUpdate: () => { calls++; return { lean: async () => ({}) } },
        findByIdAndDelete: () => { calls++; return {} },
      }
    }
  }

  test('operator objects never reach update/delete/restore/forceDelete', async () => {
    calls = 0
    const injected = { $gt: '' } as any
    expect(await M.update(injected, { name: 'x' })).toBeNull()
    expect(await M.delete(injected)).toBe(false)
    expect(await M.restore(injected)).toBe(false)
    expect(await M.forceDelete(injected)).toBe(false)
    expect(calls).toBe(0)
  })
})

describe('BaseModel fillable prototype safety', () => {
  test('does not mass-assign inherited properties', async () => {
    let created: any
    class M extends BaseModel {
      static fillable = ['name', 'role']
      static getModel() {
        return {
          create: async (data: any) => {
            created = data
            return { toJSON: () => data }
          },
        }
      }
    }
    const data = Object.create({ role: 'admin' })
    data.name = 'user'
    await M.create(data)
    expect(created).toEqual({ name: 'user' })
  })
})
