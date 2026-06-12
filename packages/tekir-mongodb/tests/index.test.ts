import { test, expect, describe } from 'bun:test'
import { BaseModel, Mongo, mongo, MongoProvider } from '../src/index'
import type { MongoConfig, MongoModelConfig } from '../src/types'


describe('MongoConfig type', () => {
  test('accepts uri string', () => {
    const config: MongoConfig = { uri: 'mongodb://localhost:27017/test' }
    expect(config.uri).toBe('mongodb://localhost:27017/test')
  })

  test('accepts uri with options', () => {
    const config: MongoConfig = {
      uri: 'mongodb://localhost:27017/test',
      options: { maxPoolSize: 10 },
      debug: true,
    }
    expect(config.debug).toBe(true)
  })

  test('accepts minimal config', () => {
    const config: MongoConfig = { uri: 'mongodb://localhost/db' }
    expect(config.options).toBeUndefined()
    expect(config.debug).toBeUndefined()
  })
})

describe('MongoModelConfig type', () => {
  test('accepts empty config', () => {
    const config: MongoModelConfig = {}
    expect(config.collection).toBeUndefined()
  })

  test('accepts all options', () => {
    const config: MongoModelConfig = {
      collection: 'users',
      timestamps: true,
      softDeletes: true,
    }
    expect(config.collection).toBe('users')
    expect(config.timestamps).toBe(true)
    expect(config.softDeletes).toBe(true)
  })
})


describe('Mongo', () => {
  test('is a class', () => {
    expect(typeof Mongo).toBe('function')
  })

  test('mongo singleton is an instance of Mongo', () => {
    expect(mongo).toBeInstanceOf(Mongo)
  })

  test('has connect method', () => {
    expect(typeof mongo.connect).toBe('function')
  })

  test('has disconnect method', () => {
    expect(typeof mongo.disconnect).toBe('function')
  })

  test('has connection getter', () => {
    const instance = new Mongo()
    expect(() => instance.connection).toThrow('not connected')
  })

  test('has mongoose getter', () => {
    const m = mongo.mongoose
    expect(m).toBeDefined()
    expect(typeof m.connect).toBe('function')
    expect(typeof m.model).toBe('function')
  }, 15000)

  test('each instance is independent', () => {
    const a = new Mongo()
    const b = new Mongo()
    expect(a).not.toBe(b)
    expect(() => a.connection).toThrow()
    expect(() => b.connection).toThrow()
  })
})


describe('BaseModel', () => {
  test('is a class', () => {
    expect(typeof BaseModel).toBe('function')
  })

  test('has static schema property', () => {
    expect(BaseModel.schema).toBeDefined()
    expect(typeof BaseModel.schema).toBe('object')
  })

  test('has static config property', () => {
    expect(BaseModel.config).toBeDefined()
  })

  test('has static hidden array', () => {
    expect(Array.isArray(BaseModel.hidden)).toBe(true)
  })

  test('has static fillable array', () => {
    expect(Array.isArray(BaseModel.fillable)).toBe(true)
  })

  test('has static query methods', () => {
    expect(typeof BaseModel.find).toBe('function')
    expect(typeof BaseModel.findById).toBe('function')
    expect(typeof BaseModel.findOne).toBe('function')
    expect(typeof BaseModel.findOrFail).toBe('function')
    expect(typeof BaseModel.create).toBe('function')
    expect(typeof BaseModel.createMany).toBe('function')
    expect(typeof BaseModel.update).toBe('function')
    expect(typeof BaseModel.updateMany).toBe('function')
    expect(typeof BaseModel.delete).toBe('function')
    expect(typeof BaseModel.deleteMany).toBe('function')
  })

  test('has static aggregation methods', () => {
    expect(typeof BaseModel.count).toBe('function')
    expect(typeof BaseModel.exists).toBe('function')
    expect(typeof BaseModel.distinct).toBe('function')
    expect(typeof BaseModel.paginate).toBe('function')
  })

  test('has static soft delete methods', () => {
    expect(typeof BaseModel.restore).toBe('function')
    expect(typeof BaseModel.forceDelete).toBe('function')
    expect(typeof BaseModel.withTrashed).toBe('function')
    expect(typeof BaseModel.onlyTrashed).toBe('function')
  })

  test('has static raw access methods', () => {
    expect(typeof BaseModel.aggregate).toBe('function')
    expect(typeof BaseModel.query).toBe('function')
  })

  test('subclass inherits all methods', () => {
    class User extends BaseModel {
      static modelName = 'User'
      static schema = { name: String, email: String }
      static fillable = ['name', 'email']
    }
    expect(typeof User.find).toBe('function')
    expect(typeof User.create).toBe('function')
    expect(User.fillable).toEqual(['name', 'email'])
  })

  test('subclass can define hidden fields', () => {
    class User extends BaseModel {
      static modelName = 'User'
      static schema = { name: String, password: String }
      static hidden = ['password']
    }
    expect(User.hidden).toEqual(['password'])
  })

  test('subclass can enable soft deletes', () => {
    class Post extends BaseModel {
      static modelName = 'Post'
      static schema = { title: String }
      static config = { softDeletes: true }
    }
    expect(Post.config.softDeletes).toBe(true)
  })

  test('subclass can set custom collection', () => {
    class Log extends BaseModel {
      static modelName = 'Log'
      static schema = { message: String }
      static config = { collection: 'audit_logs' }
    }
    expect(Log.config.collection).toBe('audit_logs')
  })

  test('fillable filtering works', () => {
    class User extends BaseModel {
      static modelName = 'TestUser'
      static schema = { name: String, email: String, role: String }
      static fillable = ['name', 'email']
    }
    const filtered = (User as any).filterFillable({ name: 'Ali', email: 'a@b.com', role: 'admin' })
    expect(filtered).toEqual({ name: 'Ali', email: 'a@b.com' })
    expect(filtered.role).toBeUndefined()
  })

  test('empty fillable passes all data', () => {
    class Open extends BaseModel {
      static modelName = 'Open'
      static schema = { a: String, b: String }
      static fillable: string[] = []
    }
    const filtered = (Open as any).filterFillable({ a: '1', b: '2', c: '3' })
    expect(filtered).toEqual({ a: '1', b: '2', c: '3' })
  })

  test('restore throws without soft deletes', async () => {
    class Item extends BaseModel {
      static modelName = 'Item'
      static schema = { name: String }
    }
    await expect(Item.restore('abc')).rejects.toThrow('Soft deletes not enabled')
  })
})


describe('MongoProvider', () => {
  test('is a class', () => {
    expect(typeof MongoProvider).toBe('function')
  })

  test('has register method', () => {
    const provider = new MongoProvider()
    expect(typeof provider.register).toBe('function')
  })

  test('has shutdown method', () => {
    const provider = new MongoProvider()
    expect(typeof provider.shutdown).toBe('function')
  })

  test('register skips when no config', async () => {
    const provider = new MongoProvider()
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') return () => null
        return null
      },
    }
    await provider.register(mockApp as any)
  })

  test('register skips when uri is empty', async () => {
    const provider = new MongoProvider()
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') return (k: string) => k === 'mongodb' ? {} : null
        return null
      },
    }
    await provider.register(mockApp as any)
  })
})
