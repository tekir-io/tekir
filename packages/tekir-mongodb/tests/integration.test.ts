import { test, expect, describe, beforeAll, afterAll, afterEach } from 'bun:test'

const TEST_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tekir_mongodb_test'

let canConnect = false
try {
  const mongoose = require('mongoose')
  const conn = mongoose.createConnection(TEST_URI)
  await conn.asPromise()
  await conn.close()
  canConnect = true
} catch {}

if (!canConnect) {
  test.skip('MongoDB integration tests — skipped (MongoDB not reachable)', () => {})
} else {
  const { mongo, BaseModel } = require('../src/index')

  // ─── Models ───────────────────────────────────────────────────────────────

  class User extends (BaseModel as any) {
    static modelName = 'IntegUser'
    static schema = {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true },
      password: String,
      age: Number,
      role: { type: String, enum: ['user', 'admin'], default: 'user' },
    }
    static fillable = ['name', 'email', 'password', 'age', 'role']
    static hidden = ['password']
    static config = { timestamps: true }
  }

  class Post extends (BaseModel as any) {
    static modelName = 'IntegPost'
    static schema = {
      title: { type: String, required: true },
      body: String,
      author: String,
    }
    static fillable = ['title', 'body', 'author']
    static config = { timestamps: true, softDeletes: true }
  }

  class OpenModel extends (BaseModel as any) {
    static modelName = 'IntegOpen'
    static schema = {
      name: String,
      secret: String,
    }
    static fillable: string[] = []
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await mongo.connect({ uri: TEST_URI })
  })

  afterEach(async () => {
    try {
      await (User as any).getModel().deleteMany({})
      await (Post as any).getModel().deleteMany({})
      await (OpenModel as any).getModel().deleteMany({})
    } catch {}
  })

  afterAll(async () => {
    try { await mongo.connection.dropDatabase() } catch {}
    await mongo.disconnect()
  })

  // ─── Fillable ─────────────────────────────────────────────────────────────

  describe('fillable', () => {
    test('create only accepts fillable fields', async () => {
      const user = await (User as any).create({
        name: 'Ali', email: 'ali@test.com', password: 'secret123', age: 25, role: 'admin',
      })
      expect(user.name).toBe('Ali')
      expect(user.email).toBe('ali@test.com')
      expect(user.age).toBe(25)
      expect(user.role).toBe('admin')
    })

    test('create strips non-fillable fields', async () => {
      const user = await (User as any).create({
        name: 'Veli', email: 'veli@test.com', hackerField: 'injected',
      })
      expect(user.name).toBe('Veli')
      expect(user.hackerField).toBeUndefined()
    })

    test('update only accepts fillable fields', async () => {
      const user = await (User as any).create({ name: 'Test', email: 'upd@test.com' })
      const updated = await (User as any).update(user._id, { name: 'Updated', hackerField: 'injected' })
      expect(updated.name).toBe('Updated')
      expect(updated.hackerField).toBeUndefined()
    })

    test('empty fillable allows all fields', async () => {
      const doc = await (OpenModel as any).create({ name: 'open', secret: 'yes' })
      expect(doc.name).toBe('open')
      expect(doc.secret).toBe('yes')
    })
  })

  // ─── Hidden ───────────────────────────────────────────────────────────────

  describe('hidden', () => {
    test('hidden fields excluded from toJSON', async () => {
      const created = await (User as any).create({
        name: 'Ali', email: 'hidden@test.com', password: 'secret123',
      })
      expect(created.name).toBe('Ali')
      expect(created.password).toBeUndefined()
    })

    test('__v excluded from toJSON', async () => {
      const created = await (User as any).create({ name: 'NoV', email: 'nov@test.com' })
      expect(created.__v).toBeUndefined()
    })
  })

  // ─── Timestamps ───────────────────────────────────────────────────────────

  describe('timestamps', () => {
    test('createdAt and updatedAt are set on create', async () => {
      const user = await (User as any).create({ name: 'Timestamps', email: 'ts@test.com' })
      expect(user.createdAt).toBeDefined()
      expect(user.updatedAt).toBeDefined()
    })

    test('updatedAt changes on update', async () => {
      const user = await (User as any).create({ name: 'TsUpdate', email: 'tsup@test.com' })
      await new Promise(r => setTimeout(r, 50))
      const updated = await (User as any).update(user._id, { name: 'TsUpdated' })
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(user.createdAt).getTime()
      )
    })
  })

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  describe('CRUD', () => {
    test('create and findById', async () => {
      const user = await (User as any).create({ name: 'FindMe', email: 'findme@test.com' })
      const found = await (User as any).findById(user._id.toString())
      expect(found).not.toBeNull()
      expect(found.name).toBe('FindMe')
    })

    test('find all', async () => {
      await (User as any).create({ name: 'A', email: 'a@crud.com' })
      await (User as any).create({ name: 'B', email: 'b@crud.com' })
      const all = await (User as any).find()
      expect(all.length).toBe(2)
    })

    test('find with filter', async () => {
      await (User as any).create({ name: 'Admin1', email: 'adm1@crud.com', role: 'admin' })
      await (User as any).create({ name: 'User1', email: 'usr1@crud.com', role: 'user' })
      const admins = await (User as any).find({ role: 'admin' })
      expect(admins.length).toBe(1)
      expect(admins[0].name).toBe('Admin1')
    })

    test('findOne', async () => {
      await (User as any).create({ name: 'One', email: 'one@crud.com' })
      const found = await (User as any).findOne({ email: 'one@crud.com' })
      expect(found).not.toBeNull()
      expect(found.name).toBe('One')
    })

    test('findOrFail throws on missing', async () => {
      await expect((User as any).findOrFail('000000000000000000000000')).rejects.toThrow('not found')
    })

    test('findOrFail returns on existing', async () => {
      const user = await (User as any).create({ name: 'Exists', email: 'exists@crud.com' })
      const found = await (User as any).findOrFail(user._id.toString())
      expect(found.name).toBe('Exists')
    })

    test('createMany', async () => {
      const users = await (User as any).createMany([
        { name: 'M1', email: 'm1@crud.com' },
        { name: 'M2', email: 'm2@crud.com' },
      ])
      expect(users.length).toBe(2)
      expect(users[0].name).toBe('M1')
    })

    test('update', async () => {
      const user = await (User as any).create({ name: 'Old', email: 'old@crud.com' })
      const updated = await (User as any).update(user._id, { name: 'New' })
      expect(updated.name).toBe('New')
    })

    test('updateMany', async () => {
      await (User as any).create({ name: 'UM1', email: 'um1@crud.com', role: 'user' })
      await (User as any).create({ name: 'UM2', email: 'um2@crud.com', role: 'user' })
      const count = await (User as any).updateMany({ role: 'user' }, { $set: { age: 30 } })
      expect(count).toBe(2)
    })

    test('delete', async () => {
      const user = await (User as any).create({ name: 'Del', email: 'del@crud.com' })
      const result = await (User as any).delete(user._id.toString())
      expect(result).toBe(true)
      const found = await (User as any).findById(user._id.toString())
      expect(found).toBeNull()
    })

    test('deleteMany', async () => {
      await (User as any).create({ name: 'DM1', email: 'dm1@crud.com', role: 'user' })
      await (User as any).create({ name: 'DM2', email: 'dm2@crud.com', role: 'user' })
      const count = await (User as any).deleteMany({ role: 'user' })
      expect(count).toBe(2)
      expect((await (User as any).find()).length).toBe(0)
    })

    test('exists', async () => {
      await (User as any).create({ name: 'Ex', email: 'ex@crud.com' })
      expect(await (User as any).exists({ email: 'ex@crud.com' })).toBe(true)
      expect(await (User as any).exists({ email: 'nope@crud.com' })).toBe(false)
    })

    test('count', async () => {
      await (User as any).create({ name: 'C1', email: 'c1@crud.com', role: 'admin' })
      await (User as any).create({ name: 'C2', email: 'c2@crud.com', role: 'user' })
      await (User as any).create({ name: 'C3', email: 'c3@crud.com', role: 'admin' })
      expect(await (User as any).count()).toBe(3)
      expect(await (User as any).count({ role: 'admin' })).toBe(2)
    })

    test('distinct', async () => {
      await (User as any).create({ name: 'D1', email: 'd1@crud.com', role: 'admin' })
      await (User as any).create({ name: 'D2', email: 'd2@crud.com', role: 'user' })
      await (User as any).create({ name: 'D3', email: 'd3@crud.com', role: 'admin' })
      const roles = await (User as any).distinct('role')
      expect(roles.sort()).toEqual(['admin', 'user'])
    })
  })

  // ─── Soft Deletes ─────────────────────────────────────────────────────────

  describe('soft deletes', () => {
    test('delete sets deletedAt instead of removing', async () => {
      const post = await (Post as any).create({ title: 'Soft', body: 'test', author: 'Ali' })
      await (Post as any).delete(post._id.toString())
      expect((await (Post as any).find()).length).toBe(0)
      const raw = await (Post as any).getModel().findById(post._id).lean()
      expect(raw).not.toBeNull()
      expect(raw.deletedAt).not.toBeNull()
    })

    test('withTrashed includes soft-deleted', async () => {
      const post = await (Post as any).create({ title: 'Trashed', body: 'x', author: 'B' })
      await (Post as any).delete(post._id.toString())
      const all = await (Post as any).withTrashed()
      expect(all.length).toBe(1)
    })

    test('onlyTrashed returns only deleted', async () => {
      await (Post as any).create({ title: 'Active', body: 'a', author: 'C' })
      const post2 = await (Post as any).create({ title: 'Deleted', body: 'b', author: 'D' })
      await (Post as any).delete(post2._id.toString())
      const trashed = await (Post as any).onlyTrashed()
      expect(trashed.length).toBe(1)
      expect(trashed[0].title).toBe('Deleted')
    })

    test('restore brings back soft-deleted', async () => {
      const post = await (Post as any).create({ title: 'Restore', body: 'r', author: 'E' })
      await (Post as any).delete(post._id.toString())
      await (Post as any).restore(post._id.toString())
      expect((await (Post as any).find()).length).toBe(1)
    })

    test('forceDelete permanently removes', async () => {
      const post = await (Post as any).create({ title: 'Force', body: 'f', author: 'F' })
      await (Post as any).forceDelete(post._id.toString())
      expect((await (Post as any).withTrashed()).length).toBe(0)
    })

    test('deleteMany with soft deletes', async () => {
      await (Post as any).create({ title: 'SD1', body: 'x', author: 'G' })
      await (Post as any).create({ title: 'SD2', body: 'y', author: 'G' })
      const count = await (Post as any).deleteMany({ author: 'G' })
      expect(count).toBe(2)
      expect((await (Post as any).find()).length).toBe(0)
      expect((await (Post as any).withTrashed()).length).toBe(2)
    })

    test('count excludes soft-deleted', async () => {
      await (Post as any).create({ title: 'SC1', body: 'x', author: 'H' })
      const p2 = await (Post as any).create({ title: 'SC2', body: 'y', author: 'H' })
      await (Post as any).delete(p2._id.toString())
      expect(await (Post as any).count()).toBe(1)
    })

    test('findById returns null for soft-deleted', async () => {
      const post = await (Post as any).create({ title: 'SFB', body: 'x', author: 'I' })
      await (Post as any).delete(post._id.toString())
      expect(await (Post as any).findById(post._id.toString())).toBeNull()
    })
  })

  // ─── Pagination ───────────────────────────────────────────────────────────

  describe('pagination', () => {
    test('paginate returns correct structure', async () => {
      for (let i = 0; i < 25; i++) {
        await (User as any).create({ name: `P${i}`, email: `p${i}@pag.com` })
      }
      const page1 = await (User as any).paginate({}, 1, 10)
      expect(page1.data.length).toBe(10)
      expect(page1.total).toBe(25)
      expect(page1.page).toBe(1)
      expect(page1.perPage).toBe(10)
      expect(page1.lastPage).toBe(3)
    })

    test('paginate with filter', async () => {
      for (let i = 0; i < 15; i++) {
        await (User as any).create({ name: `PF${i}`, email: `pf${i}@pag.com`, role: i < 5 ? 'admin' : 'user' })
      }
      const result = await (User as any).paginate({ role: 'admin' }, 1, 10)
      expect(result.total).toBe(5)
    })
  })

  // ─── Aggregation ──────────────────────────────────────────────────────────

  describe('aggregation', () => {
    test('aggregate pipeline works', async () => {
      await (User as any).create({ name: 'AG1', email: 'ag1@agg.com', role: 'admin', age: 30 })
      await (User as any).create({ name: 'AG2', email: 'ag2@agg.com', role: 'admin', age: 40 })
      await (User as any).create({ name: 'AG3', email: 'ag3@agg.com', role: 'user', age: 20 })
      const stats = await (User as any).aggregate([
        { $group: { _id: '$role', count: { $sum: 1 }, avgAge: { $avg: '$age' } } },
        { $sort: { count: -1 } },
      ])
      const admin = stats.find((s: any) => s._id === 'admin')
      expect(admin.count).toBe(2)
      expect(admin.avgAge).toBe(35)
    })

    test('query() returns mongoose model', async () => {
      await (User as any).create({ name: 'Q1', email: 'q1@q.com', age: 18 })
      await (User as any).create({ name: 'Q2', email: 'q2@q.com', age: 30 })
      await (User as any).create({ name: 'Q3', email: 'q3@q.com', age: 15 })
      const results = await (User as any).query().find({ age: { $gte: 18 } }).sort({ age: 1 }).lean()
      expect(results.length).toBe(2)
      expect(results[0].name).toBe('Q1')
    })
  })

  // ─── Hooks ────────────────────────────────────────────────────────────────

  describe('hooks', () => {
    class HookedItem extends (BaseModel as any) {
      static modelName = 'HookedItem'
      static schema = { name: String, slug: String }
      static fillable = ['name', 'slug']
      static config = { timestamps: true }
      static _log: string[] = []

      static hooks = {
        beforeCreate: [async (data: any) => {
          if (data.name && !data.slug) data.slug = data.name.toLowerCase().replace(/\s+/g, '-')
          HookedItem._log.push('beforeCreate')
        }],
        afterCreate: [async () => { HookedItem._log.push('afterCreate') }],
        beforeSave: [async () => { HookedItem._log.push('beforeSave') }],
        afterSave: [async () => { HookedItem._log.push('afterSave') }],
        beforeUpdate: [async () => { HookedItem._log.push('beforeUpdate') }],
        afterUpdate: [async () => { HookedItem._log.push('afterUpdate') }],
        beforeDelete: [async () => { HookedItem._log.push('beforeDelete') }],
        afterDelete: [async () => { HookedItem._log.push('afterDelete') }],
        beforeFind: [async () => { HookedItem._log.push('beforeFind') }],
        afterFind: [async () => { HookedItem._log.push('afterFind') }],
        beforeFetch: [async () => { HookedItem._log.push('beforeFetch') }],
        afterFetch: [async () => { HookedItem._log.push('afterFetch') }],
      }
    }

    afterEach(async () => {
      HookedItem._log = []
      try { await (HookedItem as any).getModel().deleteMany({}) } catch {}
    })

    test('beforeCreate can mutate data', async () => {
      const item = await (HookedItem as any).create({ name: 'Hello World' })
      expect(item.slug).toBe('hello-world')
    })

    test('create fires beforeSave → beforeCreate → afterCreate → afterSave', async () => {
      await (HookedItem as any).create({ name: 'Test' })
      expect(HookedItem._log).toEqual(['beforeSave', 'beforeCreate', 'afterCreate', 'afterSave'])
    })

    test('update fires beforeSave → beforeUpdate → afterUpdate → afterSave', async () => {
      const item = await (HookedItem as any).create({ name: 'Upd' })
      HookedItem._log = []
      await (HookedItem as any).update(item._id, { name: 'Updated' })
      expect(HookedItem._log).toEqual(['beforeSave', 'beforeUpdate', 'afterUpdate', 'afterSave'])
    })

    test('delete fires beforeDelete → afterDelete', async () => {
      const item = await (HookedItem as any).create({ name: 'Del' })
      HookedItem._log = []
      await (HookedItem as any).delete(item._id.toString())
      expect(HookedItem._log).toEqual(['beforeDelete', 'afterDelete'])
    })

    test('findById fires beforeFind → afterFind', async () => {
      const item = await (HookedItem as any).create({ name: 'Find' })
      HookedItem._log = []
      await (HookedItem as any).findById(item._id.toString())
      expect(HookedItem._log).toEqual(['beforeFind', 'afterFind'])
    })

    test('find fires beforeFetch → afterFetch', async () => {
      await (HookedItem as any).create({ name: 'F1' })
      HookedItem._log = []
      await (HookedItem as any).find()
      expect(HookedItem._log).toEqual(['beforeFetch', 'afterFetch'])
    })

    test('multiple hooks for same event', async () => {
      const log: string[] = []
      class Multi extends (BaseModel as any) {
        static modelName = 'MultiHook'
        static schema = { name: String }
        static fillable = ['name']
        static hooks = {
          beforeCreate: [
            async () => { log.push('h1') },
            async () => { log.push('h2') },
            async () => { log.push('h3') },
          ],
        }
      }
      await (Multi as any).create({ name: 'M' })
      expect(log).toEqual(['h1', 'h2', 'h3'])
      try { await (Multi as any).getModel().deleteMany({}) } catch {}
    })
  })
}
