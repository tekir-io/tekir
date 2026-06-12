import { test, expect, describe, beforeAll } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import { QueryBuilder, InsertBuilder } from '../src/query_builder'

function createDb() {
  const raw = new BunSQLite(':memory:', { create: true })
  return {
    async exec(sql: string) { raw.run(sql) },
    async run(sql: string, params: any[] = []) { raw.run(sql, ...params) },
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> { return raw.query(sql).all(...params) as T[] },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> { return (raw.query(sql).get(...params) as T) ?? null },
  }
}

let db: ReturnType<typeof createDb>

beforeAll(async () => {
  db = createDb()
  await db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL, stock INTEGER DEFAULT 0, category TEXT)`)
  await db.exec(`CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)`)
  await db.exec(`CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, qty INTEGER, total REAL)`)
})

describe('Integration — INSERT safety', () => {
  test('insert with SQL in values is safe', async () => {
    await new QueryBuilder(db, 'products').insert({ name: "'; DROP TABLE products; --", price: 9.99, stock: 10, category: 'test' })
    const count = await new QueryBuilder(db, 'products').count()
    expect(count).toBe(1)
  })

  test('insert with quotes in name', async () => {
    await new QueryBuilder(db, 'products').insert({ name: "O'Malley's Widget", price: 19.99, stock: 5, category: 'test' })
    const r = await new QueryBuilder(db, 'products').where('price', 19.99).first()
    expect(r.name).toBe("O'Malley's Widget")
  })

  test('insert with unicode', async () => {
    await new QueryBuilder(db, 'products').insert({ name: 'Ürün Türkçe 🎉', price: 29.99, stock: 3, category: 'tr' })
    const r = await new QueryBuilder(db, 'products').where('price', 29.99).first()
    expect(r.name).toBe('Ürün Türkçe 🎉')
  })

  test('multiInsert with special chars', async () => {
    await new QueryBuilder(db, 'products').multiInsert([
      { name: 'Item "A"', price: 1, stock: 1, category: 'multi' },
      { name: "Item 'B'", price: 2, stock: 2, category: 'multi' },
      { name: 'Item & C', price: 3, stock: 3, category: 'multi' },
    ])
    const items = await new QueryBuilder(db, 'products').where('category', 'multi').all()
    expect(items.length).toBe(3)
  })
})

describe('Integration — InsertBuilder with onConflict', () => {
  test('insert ignore on conflict', async () => {
    await new QueryBuilder(db, 'categories').insert({ name: 'Electronics' })
    const ib = new InsertBuilder(db, 'categories')
    ib.values({ name: 'Electronics' }).onConflict('name').ignore()
    await ib.exec()
    const count = await new QueryBuilder(db, 'categories').count()
    expect(count).toBe(1) // no duplicate
  })

  test('insert merge on conflict', async () => {
    const ib = new InsertBuilder(db, 'categories')
    ib.values({ name: 'Electronics' }).onConflict('name').merge(['name'])
    await ib.exec()
    const count = await new QueryBuilder(db, 'categories').count()
    expect(count).toBe(1)
  })
})

describe('Integration — UPDATE safety', () => {
  test('update with SQL in value is safe', async () => {
    await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99)
      .update({ name: "updated'; DROP TABLE products;--" })
    const r = await new QueryBuilder(db, 'products').where('price', 9.99).first()
    expect(r.name).toBe("updated'; DROP TABLE products;--")
    // Table still exists
    const count = await new QueryBuilder(db, 'products').count()
    expect(count).toBeGreaterThan(0)
  })

  test('update multiple fields', async () => {
    await new QueryBuilder(db, 'products').where('price', 19.99)
      .update({ name: 'Updated Widget', stock: 99 })
    const r = await new QueryBuilder(db, 'products').where('price', 19.99).first()
    expect(r.name).toBe('Updated Widget')
    expect(r.stock).toBe(99)
  })
})

describe('Integration — DELETE safety', () => {
  test('delete with SQL in value is safe', async () => {
    const before = await new QueryBuilder(db, 'products').count()
    await new QueryBuilder(db, 'products').where('name', "nonexistent' OR 1=1 --").delete()
    const after = await new QueryBuilder(db, 'products').count()
    expect(after).toBe(before) // no rows deleted (injection failed)
  })

  test('delete with valid condition', async () => {
    await new QueryBuilder(db, 'products').insert({ name: 'to-delete', price: 0, stock: 0, category: 'del' })
    await new QueryBuilder(db, 'products').where('category', 'del').delete()
    const r = await new QueryBuilder(db, 'products').where('category', 'del').all()
    expect(r.length).toBe(0)
  })
})

describe('Integration — SELECT with complex queries', () => {
  test('select specific columns', async () => {
    const r = await new QueryBuilder(db, 'products').select('name', 'price').first()
    expect(r).toHaveProperty('name')
    expect(r).toHaveProperty('price')
  })

  test('distinct values', async () => {
    const r = await new QueryBuilder(db, 'products').distinct('category').all()
    const categories = r.map((x: any) => x.category)
    expect(new Set(categories).size).toBe(categories.length)
  })

  test('orderBy ASC', async () => {
    const r = await new QueryBuilder(db, 'products').orderBy('price', 'asc').all()
    for (let i = 1; i < r.length; i++) {
      expect(r[i].price).toBeGreaterThanOrEqual(r[i - 1].price)
    }
  })

  test('orderBy DESC', async () => {
    const r = await new QueryBuilder(db, 'products').orderBy('price', 'desc').all()
    for (let i = 1; i < r.length; i++) {
      expect(r[i].price).toBeLessThanOrEqual(r[i - 1].price)
    }
  })

  test('limit returns correct count', async () => {
    const r = await new QueryBuilder(db, 'products').limit(2).all()
    expect(r.length).toBe(2)
  })

  test('offset skips rows', async () => {
    const all = await new QueryBuilder(db, 'products').orderBy('id', 'asc').all()
    const offset = await new QueryBuilder(db, 'products').orderBy('id', 'asc').offset(1).limit(1).all()
    expect(offset[0].id).toBe(all[1].id)
  })

  test('where with operators', async () => {
    const r = await new QueryBuilder(db, 'products').where('price', '>', 10).all()
    for (const item of r) expect(item.price).toBeGreaterThan(10)
  })

  test('where with LIKE', async () => {
    const r = await new QueryBuilder(db, 'products').where('name', 'LIKE', '%Widget%').all()
    for (const item of r) expect(item.name).toContain('Widget')
  })

  test('whereIn', async () => {
    const r = await new QueryBuilder(db, 'products').whereIn('category', ['test', 'tr']).all()
    for (const item of r) expect(['test', 'tr']).toContain(item.category)
  })

  test('whereNotIn', async () => {
    const r = await new QueryBuilder(db, 'products').whereNotIn('category', ['multi']).all()
    for (const item of r) expect(item.category).not.toBe('multi')
  })

  test('whereBetween', async () => {
    const r = await new QueryBuilder(db, 'products').whereBetween('price', [5, 25]).all()
    for (const item of r) {
      expect(item.price).toBeGreaterThanOrEqual(5)
      expect(item.price).toBeLessThanOrEqual(25)
    }
  })

  test('whereNull', async () => {
    await new QueryBuilder(db, 'products').insert({ name: 'no-cat', price: 0, stock: 0 })
    const r = await new QueryBuilder(db, 'products').whereNull('category').all()
    for (const item of r) expect(item.category).toBeNull()
    await new QueryBuilder(db, 'products').where('name', 'no-cat').delete()
  })

  test('whereNotNull', async () => {
    const r = await new QueryBuilder(db, 'products').whereNotNull('category').all()
    for (const item of r) expect(item.category).not.toBeNull()
  })

  test('whereNot', async () => {
    const r = await new QueryBuilder(db, 'products').whereNot('category', 'multi').all()
    for (const item of r) expect(item.category).not.toBe('multi')
  })

  test('orWhere', async () => {
    const r = await new QueryBuilder(db, 'products').where('category', 'test').orWhere('category', 'tr').all()
    for (const item of r) expect(['test', 'tr']).toContain(item.category)
  })
})

describe('Integration — AGGREGATES', () => {
  test('count all', async () => {
    const c = await new QueryBuilder(db, 'products').count()
    expect(c).toBeGreaterThan(0)
  })

  test('count with where', async () => {
    const c = await new QueryBuilder(db, 'products').where('category', 'multi').count()
    expect(c).toBe(3)
  })

  test('sum', async () => {
    const s = await new QueryBuilder(db, 'products').where('category', 'multi').sum('price')
    expect(s).toBe(6) // 1+2+3
  })

  test('avg', async () => {
    const a = await new QueryBuilder(db, 'products').where('category', 'multi').avg('price')
    expect(a).toBe(2) // (1+2+3)/3
  })

  test('min', async () => {
    const m = await new QueryBuilder(db, 'products').where('category', 'multi').min('price')
    expect(m).toBe(1)
  })

  test('max', async () => {
    const m = await new QueryBuilder(db, 'products').where('category', 'multi').max('price')
    expect(m).toBe(3)
  })

  test('count specific column', async () => {
    const c = await new QueryBuilder(db, 'products').count('category')
    expect(c).toBeGreaterThan(0)
  })
})

describe('Integration — INCREMENT/DECREMENT', () => {
  test('increment stock', async () => {
    const before = await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).first()
    await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).increment('stock', 5)
    const after = await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).first()
    expect(after.stock).toBe(before.stock + 5)
  })

  test('decrement stock', async () => {
    const before = await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).first()
    await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).decrement('stock', 2)
    const after = await new QueryBuilder(db, 'products').where('category', 'test').where('price', 9.99).first()
    expect(after.stock).toBe(before.stock - 2)
  })
})

describe('Integration — PAGINATION', () => {
  test('paginate page 1', async () => {
    const r = await new QueryBuilder(db, 'products').paginate(1, 2)
    expect(r.data.length).toBe(2)
    expect(r.meta.page).toBe(1)
    expect(r.meta.perPage).toBe(2)
    expect(r.meta.total).toBeGreaterThanOrEqual(2)
  })

  test('paginate last page', async () => {
    const total = await new QueryBuilder(db, 'products').count()
    const lastPage = Math.ceil(total / 2)
    const r = await new QueryBuilder(db, 'products').paginate(lastPage, 2)
    expect(r.meta.hasMore).toBe(false)
  })

  test('paginate beyond last page returns empty', async () => {
    const r = await new QueryBuilder(db, 'products').paginate(9999, 10)
    expect(r.data.length).toBe(0)
  })
})

describe('Integration — GROUP BY + HAVING', () => {
  test('group by category with count', async () => {
    const qb = new QueryBuilder(db, 'products')
    qb.select('category').groupBy('category')
    const r = await qb.all()
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('Integration — first/firstOrFail', () => {
  test('first returns one row', async () => {
    const r = await new QueryBuilder(db, 'products').first()
    expect(r).not.toBeNull()
    expect(r.id).toBeDefined()
  })

  test('first returns null when no match', async () => {
    const r = await new QueryBuilder(db, 'products').where('name', 'NONEXISTENT_XYZ').first()
    expect(r).toBeNull()
  })

  test('firstOrFail returns row', async () => {
    const r = await new QueryBuilder(db, 'products').firstOrFail()
    expect(r.id).toBeDefined()
  })

  test('firstOrFail throws when no match', async () => {
    await expect(new QueryBuilder(db, 'products').where('name', 'NONEXISTENT').firstOrFail()).rejects.toThrow('No rows found')
  })
})

describe('Integration — whereRaw', () => {
  test('whereRaw with parameterized query', async () => {
    const r = await new QueryBuilder(db, 'products').whereRaw('price > ? AND stock > ?', [5, 0]).all()
    for (const item of r) {
      expect(item.price).toBeGreaterThan(5)
      expect(item.stock).toBeGreaterThan(0)
    }
  })

  test('whereRaw with function', async () => {
    const r = await new QueryBuilder(db, 'products').whereRaw('LENGTH(name) > ?', [10]).all()
    for (const item of r) expect(item.name.length).toBeGreaterThan(10)
  })
})

describe('Integration — forPage', () => {
  test('forPage(1, 3) returns first 3', async () => {
    const r = await new QueryBuilder(db, 'products').forPage(1, 3).all()
    expect(r.length).toBeLessThanOrEqual(3)
  })

  test('forPage(2, 2) skips first 2', async () => {
    const all = await new QueryBuilder(db, 'products').orderBy('id', 'asc').all()
    const page2 = await new QueryBuilder(db, 'products').orderBy('id', 'asc').forPage(2, 2).all()
    if (all.length > 2) expect(page2[0].id).toBe(all[2].id)
  })
})

describe('Integration — toSQL and toQuery', () => {
  test('toSQL returns parameterized query', () => {
    const { sql, params } = new QueryBuilder(db, 'products').where('name', 'test').toSQL()
    expect(sql).toContain('?')
    expect(params).toContain('test')
    expect(sql).not.toContain("'test'")
  })

  test('toQuery returns interpolated debug query', () => {
    const q = new QueryBuilder(db, 'products').where('name', "O'Brien").toQuery()
    expect(q).toContain("O''Brien") // escaped
  })

  test('toQuery with numeric param', () => {
    const q = new QueryBuilder(db, 'products').where('price', '>', 10).limit(5).toQuery()
    expect(q).toContain('> 10')
    expect(q).toContain('LIMIT 5')
  })
})
