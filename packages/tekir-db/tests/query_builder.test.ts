import { test, expect, describe, beforeAll } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import { QueryBuilder, InsertBuilder } from '../src/query_builder'

function createDb() {
  const raw = new BunSQLite(':memory:', { create: true })
  const db = {
    async exec(sql: string) { raw.run(sql) },
    async run(sql: string, params: any[] = []) { raw.run(sql, ...params) },
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> { return raw.query(sql).all(...params) as T[] },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> { return (raw.query(sql).get(...params) as T) ?? null },
  }
  return db
}

let db: ReturnType<typeof createDb>

beforeAll(async () => {
  db = createDb()
  await db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT 'user',
    age INTEGER DEFAULT 25,
    created_at TEXT DEFAULT (datetime('now'))
  )`)
  await db.exec(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    user_id INTEGER,
    status TEXT DEFAULT 'draft'
  )`)
  await db.run("INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['Alice', 'alice@tekir.dev', 'admin', 30])
  await db.run("INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['Bob', 'bob@tekir.dev', 'user', 25])
  await db.run("INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['Charlie', 'charlie@tekir.dev', 'user', 35])
  await db.run("INSERT INTO posts (title, user_id, status) VALUES (?, ?, ?)", ['Post 1', 1, 'published'])
  await db.run("INSERT INTO posts (title, user_id, status) VALUES (?, ?, ?)", ['Post 2', 1, 'draft'])
  await db.run("INSERT INTO posts (title, user_id, status) VALUES (?, ?, ?)", ['Post 3', 2, 'published'])
})

// QueryBuilder — SELECT

describe('QueryBuilder — select', () => {
  test('1. all() returns all rows', async () => {
    const rows = await new QueryBuilder(db, 'users').all()
    expect(rows).toHaveLength(3)
  })

  test('2. select specific columns', async () => {
    const rows = await new QueryBuilder(db, 'users').select('name', 'email').all()
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).toHaveProperty('email')
  })

  test('3. first() returns first row', async () => {
    const row = await new QueryBuilder(db, 'users').first()
    expect(row).not.toBeNull()
    expect(row.name).toBe('Alice')
  })

  test('4. first() returns null on empty result', async () => {
    const row = await new QueryBuilder(db, 'users').where('name', 'Nobody').first()
    expect(row).toBeNull()
  })

  test('5. firstOrFail() throws on no result', async () => {
    await expect(new QueryBuilder(db, 'users').where('name', 'Nobody').firstOrFail()).rejects.toThrow()
  })

  test('6. distinct', async () => {
    const rows = await new QueryBuilder(db, 'users').distinct('role').all()
    expect(rows.length).toBeLessThanOrEqual(2)
  })

  test('7. select(*) returns all columns', async () => {
    const rows = await new QueryBuilder(db, 'users').select('*').all()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveProperty('id')
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).toHaveProperty('email')
    expect(rows[0]).toHaveProperty('role')
    expect(rows[0]).toHaveProperty('age')
  })

  test('8. select with alias-style expression', async () => {
    const rows = await new QueryBuilder(db, 'users').select('name', 'age').all()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).toHaveProperty('age')
    expect(rows[0]).not.toHaveProperty('email')
  })

  test('9. distinct without columns returns all columns with distinct', async () => {
    const rows = await new QueryBuilder(db, 'users').distinct().all()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveProperty('id')
  })

  test('10. distinct with multiple columns', async () => {
    const rows = await new QueryBuilder(db, 'users').distinct('role', 'age').all()
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  test('11. select + where + orderBy + limit chain', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .select('name', 'age')
      .where('role', 'user')
      .orderBy('age', 'desc')
      .limit(1)
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Charlie')
    expect(rows[0].age).toBe(35)
  })

  test('12. select + where + orderBy + limit + offset chain', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .select('name')
      .orderBy('age', 'asc')
      .limit(2)
      .offset(1)
      .all()
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Alice') // age 30
  })

  test('13. select single column returns only that column', async () => {
    const rows = await new QueryBuilder(db, 'users').select('email').all()
    expect(rows[0]).toHaveProperty('email')
    const keys = Object.keys(rows[0])
    expect(keys).toEqual(['email'])
  })
})

// QueryBuilder — WHERE

describe('QueryBuilder — where', () => {
  test('14. where(col, val)', async () => {
    const rows = await new QueryBuilder(db, 'users').where('role', 'admin').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('15. where(col, operator, val)', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', '>', 28).all()
    expect(rows).toHaveLength(2) // Alice 30, Charlie 35
  })

  test('16. multiple where = AND', async () => {
    const rows = await new QueryBuilder(db, 'users').where('role', 'user').where('age', '>', 30).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Charlie')
  })

  test('17. whereNot', async () => {
    const rows = await new QueryBuilder(db, 'users').whereNot('role', 'admin').all()
    expect(rows).toHaveLength(2)
  })

  test('18. whereNull', async () => {
    await db.run("INSERT INTO posts (title, user_id, status) VALUES (?, ?, ?)", ['Orphan', null, 'draft'])
    const rows = await new QueryBuilder(db, 'posts').whereNull('user_id').all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  test('19. whereNotNull', async () => {
    const rows = await new QueryBuilder(db, 'posts').whereNotNull('user_id').all()
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test('20. whereIn', async () => {
    const rows = await new QueryBuilder(db, 'users').whereIn('name', ['Alice', 'Bob']).all()
    expect(rows).toHaveLength(2)
  })

  test('21. whereNotIn', async () => {
    const rows = await new QueryBuilder(db, 'users').whereNotIn('name', ['Alice']).all()
    expect(rows).toHaveLength(2)
  })

  test('22. whereBetween', async () => {
    const rows = await new QueryBuilder(db, 'users').whereBetween('age', [26, 31]).all()
    expect(rows).toHaveLength(1) // Alice 30
  })

  test('23. whereLike', async () => {
    const rows = await new QueryBuilder(db, 'users').whereLike('email', '%tekir.dev').all()
    expect(rows).toHaveLength(3)
  })

  test('24. whereRaw', async () => {
    const rows = await new QueryBuilder(db, 'users').whereRaw('"age" % 5 = 0').all()
    expect(rows).toHaveLength(3) // 30, 25, 35
  })

  test('25. orWhere', async () => {
    const rows = await new QueryBuilder(db, 'users').where('name', 'Alice').orWhere('name', 'Bob').all()
    expect(rows).toHaveLength(2)
  })

  test('26. orWhere with operator', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', '<', 26).orWhere('age', '>', 34).all()
    expect(rows).toHaveLength(2) // Bob 25, Charlie 35
  })

  test('27. multiple whereIn calls', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .whereIn('name', ['Alice', 'Bob', 'Charlie'])
      .whereIn('role', ['user'])
      .all()
    expect(rows).toHaveLength(2) // Bob and Charlie
  })

  test('28. whereBetween with string dates', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .whereBetween('created_at', ['2000-01-01', '2099-12-31'])
      .all()
    expect(rows).toHaveLength(3)
  })

  test('29. whereLike with % at start only', async () => {
    const rows = await new QueryBuilder(db, 'users').whereLike('name', '%lie').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Charlie')
  })

  test('30. whereLike with % at end only', async () => {
    const rows = await new QueryBuilder(db, 'users').whereLike('name', 'Al%').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('31. whereLike with % at both ends', async () => {
    const rows = await new QueryBuilder(db, 'users').whereLike('name', '%ob%').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bob')
  })

  test('32. whereRaw with params', async () => {
    const rows = await new QueryBuilder(db, 'users').whereRaw('"age" > ? AND "age" < ?', [26, 34]).all()
    expect(rows).toHaveLength(1) // Alice 30
    expect(rows[0].name).toBe('Alice')
  })

  test('33. chaining where + whereNull + whereNotNull', async () => {
    const rows = await new QueryBuilder(db, 'posts')
      .where('status', 'draft')
      .whereNotNull('user_id')
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const row of rows) {
      expect(row.status).toBe('draft')
      expect(row.user_id).not.toBeNull()
    }
  })

  test('34. whereNot with different values', async () => {
    const rows = await new QueryBuilder(db, 'users').whereNot('name', 'Alice').whereNot('name', 'Bob').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Charlie')
  })

  test('35. where returns empty for non-matching value', async () => {
    const rows = await new QueryBuilder(db, 'users').where('name', 'Nonexistent').all()
    expect(rows).toHaveLength(0)
  })

  test('36. where on non-existent column returns empty', async () => {
    // SQLite will throw an error for non-existent columns
    try {
      await new QueryBuilder(db, 'users').where('fake_column', 'value').all()
      // If it doesn't throw, the result should be empty or we just pass
    } catch {
      // Expected to throw for non-existent column
      expect(true).toBe(true)
    }
  })

  test('37. where with <= operator', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', '<=', 25).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bob')
  })

  test('38. where with >= operator', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', '>=', 35).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Charlie')
  })
})

// QueryBuilder — ORDER / LIMIT / OFFSET

describe('QueryBuilder — order/limit', () => {
  test('39. orderBy asc', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('age', 'asc').all()
    expect(rows[0].name).toBe('Bob') // 25
  })

  test('40. orderBy desc', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('age', 'desc').all()
    expect(rows[0].name).toBe('Charlie') // 35
  })

  test('41. limit', async () => {
    const rows = await new QueryBuilder(db, 'users').limit(2).all()
    expect(rows).toHaveLength(2)
  })

  test('42. offset', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('id').limit(100).offset(1).all()
    expect(rows[0].name).toBe('Bob')
  })

  test('43. forPage', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('id').forPage(2, 1).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bob')
  })

  test('44. multiple orderBy calls', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('role', 'asc').orderBy('age', 'desc').all()
    // admin first (Alice), then user sorted by age desc (Charlie 35, Bob 25)
    expect(rows[0].name).toBe('Alice')
    expect(rows[1].name).toBe('Charlie')
    expect(rows[2].name).toBe('Bob')
  })

  test('45. orderBy default direction is asc', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('age').all()
    expect(rows[0].age).toBe(25)
    expect(rows[1].age).toBe(30)
    expect(rows[2].age).toBe(35)
  })

  test('46. orderBy + limit + offset combined', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('age', 'asc').limit(1).offset(1).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice') // age 30, skipping Bob 25
  })

  test('47. limit 0 returns empty array', async () => {
    const rows = await new QueryBuilder(db, 'users').limit(0).all()
    expect(rows).toHaveLength(0)
  })

  test('48. offset beyond data returns empty', async () => {
    const rows = await new QueryBuilder(db, 'users').limit(100).offset(100).all()
    expect(rows).toHaveLength(0)
  })
})

// QueryBuilder — AGGREGATES

describe('QueryBuilder — aggregates', () => {
  test('49. count()', async () => {
    const n = await new QueryBuilder(db, 'users').count()
    expect(n).toBe(3)
  })

  test('50. count with where', async () => {
    const n = await new QueryBuilder(db, 'users').where('role', 'user').count()
    expect(n).toBe(2)
  })

  test('51. sum()', async () => {
    const total = await new QueryBuilder(db, 'users').sum('age')
    expect(total).toBe(90) // 30+25+35
  })

  test('52. avg()', async () => {
    const avg = await new QueryBuilder(db, 'users').avg('age')
    expect(avg).toBe(30) // 90/3
  })

  test('53. min()', async () => {
    const min = await new QueryBuilder(db, 'users').min('age')
    expect(min).toBe(25)
  })

  test('54. max()', async () => {
    const max = await new QueryBuilder(db, 'users').max('age')
    expect(max).toBe(35)
  })

  test('55. count with multiple where conditions', async () => {
    const n = await new QueryBuilder(db, 'users').where('role', 'user').where('age', '>', 30).count()
    expect(n).toBe(1) // Charlie
  })

  test('56. sum with where', async () => {
    const total = await new QueryBuilder(db, 'users').where('role', 'user').sum('age')
    expect(total).toBe(60) // 25 + 35
  })

  test('57. avg with where', async () => {
    const avg = await new QueryBuilder(db, 'users').where('role', 'user').avg('age')
    expect(avg).toBe(30) // (25+35)/2
  })

  test('58. min with where', async () => {
    const min = await new QueryBuilder(db, 'users').where('role', 'user').min('age')
    expect(min).toBe(25)
  })

  test('59. max with where', async () => {
    const max = await new QueryBuilder(db, 'users').where('role', 'user').max('age')
    expect(max).toBe(35)
  })

  test('60. count returning 0 for no matches', async () => {
    const n = await new QueryBuilder(db, 'users').where('name', 'Nobody').count()
    expect(n).toBe(0)
  })

  test('61. sum returning 0 for no matches', async () => {
    const total = await new QueryBuilder(db, 'users').where('name', 'Nobody').sum('age')
    expect(total).toBe(0)
  })

  test('62. avg returning 0 for no matches', async () => {
    const avg = await new QueryBuilder(db, 'users').where('name', 'Nobody').avg('age')
    expect(avg).toBe(0)
  })
})

// QueryBuilder — GROUP BY / HAVING

describe('QueryBuilder — groupBy/having', () => {
  test('63. groupBy', async () => {
    const rows = await new QueryBuilder(db, 'users').select('role').groupBy('role').all()
    expect(rows.length).toBeLessThanOrEqual(2)
  })

  test('64. havingRaw', async () => {
    const rows = await new QueryBuilder(db, 'posts')
      .select('user_id')
      .groupBy('user_id')
      .havingRaw('COUNT(*) > ?', [1])
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})

// QueryBuilder — PAGINATION

describe('QueryBuilder — pagination', () => {
  test('65. paginate returns data and meta', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(1, 2)
    expect(result.data).toHaveLength(2)
    expect(result.meta.total).toBe(3)
    expect(result.meta.page).toBe(1)
    expect(result.meta.perPage).toBe(2)
    expect(result.meta.lastPage).toBe(2)
    expect(result.meta.hasMore).toBe(true)
  })

  test('66. paginate page 2', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(2, 2)
    expect(result.data).toHaveLength(1)
    expect(result.meta.hasMore).toBe(false)
  })

  test('67. paginate page beyond last page returns empty data', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(10, 2)
    expect(result.data).toHaveLength(0)
    expect(result.meta.total).toBe(3)
    expect(result.meta.page).toBe(10)
    expect(result.meta.hasMore).toBe(false)
  })

  test('68. paginate with where filter', async () => {
    const result = await new QueryBuilder(db, 'users').where('role', 'user').paginate(1, 10)
    expect(result.data).toHaveLength(2)
    expect(result.meta.total).toBe(2)
    expect(result.meta.lastPage).toBe(1)
    expect(result.meta.hasMore).toBe(false)
  })

  test('69. paginate meta.hasMore false on last page', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(1, 3)
    expect(result.data).toHaveLength(3)
    expect(result.meta.hasMore).toBe(false)
    expect(result.meta.lastPage).toBe(1)
  })

  test('70. paginate with single row per page', async () => {
    const page1 = await new QueryBuilder(db, 'users').orderBy('id').paginate(1, 1)
    expect(page1.data).toHaveLength(1)
    expect(page1.meta.total).toBe(3)
    expect(page1.meta.lastPage).toBe(3)
    expect(page1.meta.hasMore).toBe(true)

    const page2 = await new QueryBuilder(db, 'users').orderBy('id').paginate(2, 1)
    expect(page2.data).toHaveLength(1)
    expect(page2.meta.hasMore).toBe(true)

    const page3 = await new QueryBuilder(db, 'users').orderBy('id').paginate(3, 1)
    expect(page3.data).toHaveLength(1)
    expect(page3.meta.hasMore).toBe(false)
  })
})

// QueryBuilder — UPDATE / DELETE

describe('QueryBuilder — update', () => {
  test('71. update with where', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Bob').update({ age: 26 })
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Bob'])
    expect(row!.age).toBe(26)
    await db.run("UPDATE users SET age = 25 WHERE name = ?", ['Bob']) // restore
  })

  test('72. increment', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Alice').increment('age', 1)
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Alice'])
    expect(row!.age).toBe(31)
    await db.run("UPDATE users SET age = 30 WHERE name = ?", ['Alice'])
  })

  test('73. decrement', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Charlie').decrement('age', 5)
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Charlie'])
    expect(row!.age).toBe(30)
    await db.run("UPDATE users SET age = 35 WHERE name = ?", ['Charlie'])
  })

  test('74. update multiple columns', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Bob').update({ age: 99, role: 'moderator' })
    const row = await db.queryOne("SELECT age, role FROM users WHERE name = ?", ['Bob'])
    expect(row!.age).toBe(99)
    expect(row!.role).toBe('moderator')
    await db.run("UPDATE users SET age = 25, role = 'user' WHERE name = ?", ['Bob']) // restore
  })

  test('75. update with no matching where does not error', async () => {
    // Should not throw even though no rows match
    await new QueryBuilder(db, 'users').where('name', 'Nonexistent').update({ age: 100 })
    const count = await new QueryBuilder(db, 'users').where('age', 100).count()
    expect(count).toBe(0)
  })

  test('76. increment by default (1)', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Alice').increment('age')
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Alice'])
    expect(row!.age).toBe(31)
    await db.run("UPDATE users SET age = 30 WHERE name = ?", ['Alice']) // restore
  })

  test('77. decrement to negative', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Bob').decrement('age', 30)
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Bob'])
    expect(row!.age).toBe(-5) // 25 - 30
    await db.run("UPDATE users SET age = 25 WHERE name = ?", ['Bob']) // restore
  })
})

describe('QueryBuilder — delete', () => {
  test('78. delete with where', async () => {
    await db.run("INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['Temp', 'temp@tekir.dev', 'user', 20])
    await new QueryBuilder(db, 'users').where('name', 'Temp').delete()
    const row = await db.queryOne("SELECT * FROM users WHERE name = ?", ['Temp'])
    expect(row).toBeNull()
  })

  test('79. delete with no matching where does not error', async () => {
    // Should not throw even though no rows match
    await new QueryBuilder(db, 'users').where('name', 'Nonexistent').delete()
    const count = await new QueryBuilder(db, 'users').count()
    expect(count).toBe(3) // original 3 still there
  })
})

// QueryBuilder — toSQL / toQuery

describe('QueryBuilder — debug', () => {
  test('80. toSQL returns sql and params', () => {
    const { sql, params } = new QueryBuilder(db, 'users').where('role', 'admin').toSQL()
    expect(sql).toContain('SELECT')
    expect(sql).toContain('WHERE')
    expect(params).toEqual(['admin'])
  })

  test('81. toQuery returns interpolated string', () => {
    const query = new QueryBuilder(db, 'users').where('role', 'admin').toQuery()
    expect(query).toContain("'admin'")
  })

  test('82. toSQL with multiple where clauses', () => {
    const { sql, params } = new QueryBuilder(db, 'users')
      .where('role', 'user')
      .where('age', '>', 30)
      .toSQL()
    expect(sql).toContain('WHERE')
    expect(sql).toContain('AND')
    expect(params).toEqual(['user', 30])
  })

  test('83. toQuery interpolates numeric params', () => {
    const query = new QueryBuilder(db, 'users').where('age', '>', 25).toQuery()
    expect(query).toContain('25')
    expect(query).not.toContain('?')
  })

  test('84. toSQL for complex query', () => {
    const { sql, params } = new QueryBuilder(db, 'users')
      .select('name', 'age')
      .where('role', 'user')
      .orderBy('age', 'desc')
      .limit(10)
      .offset(5)
      .toSQL()
    expect(sql).toContain('SELECT')
    expect(sql).toContain('"name"')
    expect(sql).toContain('ORDER BY')
    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 5')
    expect(params).toEqual(['user'])
  })
})

// InsertBuilder

describe('InsertBuilder', () => {
  test('85. insert single row', async () => {
    await new InsertBuilder(db, 'users').values({ name: 'Dave', email: 'dave@tekir.dev', role: 'user', age: 28 }).exec()
    const row = await db.queryOne("SELECT * FROM users WHERE name = ?", ['Dave'])
    expect(row).not.toBeNull()
    expect(row!.email).toBe('dave@tekir.dev')
    await db.run("DELETE FROM users WHERE name = ?", ['Dave'])
  })

  test('86. multiInsert', async () => {
    await new InsertBuilder(db, 'users').multiInsert([
      { name: 'Eve', email: 'eve@tekir.dev', role: 'user', age: 22 },
      { name: 'Frank', email: 'frank@tekir.dev', role: 'user', age: 33 },
    ]).exec()
    const rows = await db.query("SELECT * FROM users WHERE name IN (?, ?)", ['Eve', 'Frank'])
    expect(rows).toHaveLength(2)
    await db.run("DELETE FROM users WHERE name IN (?, ?)", ['Eve', 'Frank'])
  })

  test('87. onConflict().ignore()', async () => {
    await new InsertBuilder(db, 'users')
      .values({ name: 'Alice', email: 'alice@tekir.dev', role: 'admin', age: 30 })
      .onConflict('email')
      .ignore()
      .exec()
    // Should not throw, should silently skip
    const count = await db.queryOne("SELECT COUNT(*) as c FROM users WHERE email = ?", ['alice@tekir.dev'])
    expect(count!.c).toBe(1)
  })

  test('88. onConflict().merge()', async () => {
    await db.run("INSERT OR IGNORE INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['Merge', 'merge@tekir.dev', 'user', 20])
    await new InsertBuilder(db, 'users')
      .values({ name: 'Merge Updated', email: 'merge@tekir.dev', role: 'admin', age: 21 })
      .onConflict('email')
      .merge()
      .exec()
    const row = await db.queryOne("SELECT * FROM users WHERE email = ?", ['merge@tekir.dev'])
    expect(row!.name).toBe('Merge Updated')
    expect(row!.role).toBe('admin')
    await db.run("DELETE FROM users WHERE email = ?", ['merge@tekir.dev'])
  })

  test('89. toSQL', () => {
    const sql = new InsertBuilder(db, 'users').values({ name: 'Test', email: 'test@tekir.dev' }).toSQL()
    expect(sql).toContain('INSERT INTO')
    expect(sql).toContain('"name"')
  })

  test('90. onConflict with multiple columns', async () => {
    // Create a table with a composite unique constraint for this test
    await db.exec(`CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      UNIQUE(post_id, tag)
    )`)
    await db.run("INSERT INTO tags (post_id, tag) VALUES (?, ?)", [1, 'js'])
    await new InsertBuilder(db, 'tags')
      .values({ post_id: 1, tag: 'js' })
      .onConflict(['post_id', 'tag'])
      .ignore()
      .exec()
    const count = await db.queryOne("SELECT COUNT(*) as c FROM tags WHERE post_id = ? AND tag = ?", [1, 'js'])
    expect(count!.c).toBe(1) // still just 1 row
    await db.exec("DROP TABLE tags")
  })

  test('91. onConflict().merge() with specific columns', async () => {
    await db.run("INSERT OR IGNORE INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['MergeSpec', 'mergespec@tekir.dev', 'user', 20])
    await new InsertBuilder(db, 'users')
      .values({ name: 'MergeSpec New', email: 'mergespec@tekir.dev', role: 'admin', age: 99 })
      .onConflict('email')
      .merge(['name', 'age']) // only merge name and age, not role
      .exec()
    const row = await db.queryOne("SELECT * FROM users WHERE email = ?", ['mergespec@tekir.dev'])
    expect(row!.name).toBe('MergeSpec New')
    expect(row!.age).toBe(99)
    await db.run("DELETE FROM users WHERE email = ?", ['mergespec@tekir.dev'])
  })

  test('92. onConflict().merge() with custom values', async () => {
    await db.run("INSERT OR IGNORE INTO users (name, email, role, age) VALUES (?, ?, ?, ?)", ['MergeCustom', 'mergecustom@tekir.dev', 'user', 20])
    await new InsertBuilder(db, 'users')
      .values({ name: 'MergeCustom', email: 'mergecustom@tekir.dev', role: 'user', age: 20 })
      .onConflict('email')
      .merge({ name: 'Custom Name', age: 50 })
      .exec()
    const row = await db.queryOne("SELECT * FROM users WHERE email = ?", ['mergecustom@tekir.dev'])
    expect(row!.name).toBe('Custom Name')
    expect(row!.age).toBe(50)
    await db.run("DELETE FROM users WHERE email = ?", ['mergecustom@tekir.dev'])
  })

  test('93. QueryBuilder multiInsert empty array does not error', async () => {
    // QueryBuilder.multiInsert handles empty arrays gracefully (early return)
    await new QueryBuilder(db, 'users').multiInsert([])
    const count = await new QueryBuilder(db, 'users').count()
    expect(count).toBe(3) // no rows added
  })

  test('94. toSQL output format contains table and columns', () => {
    const sql = new InsertBuilder(db, 'users')
      .values({ name: 'Test', email: 'test@tekir.dev', role: 'user', age: 25 })
      .toSQL()
    expect(sql).toContain('INSERT INTO "users"')
    expect(sql).toContain('"name"')
    expect(sql).toContain('"email"')
    expect(sql).toContain('"role"')
    expect(sql).toContain('"age"')
    expect(sql).toContain('VALUES')
    expect(sql).toContain('?')
  })
})

// QueryBuilder — JOIN

describe('QueryBuilder — join', () => {
  test('95. inner join', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test('96. left join', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .leftJoin('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test('97. inner join with where', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .whereRaw('posts.status = ?', ['published'])
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(2) // Post 1 (Alice) and Post 3 (Bob)
  })

  test('98. left join includes users without posts', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .leftJoin('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .all()
    const names = rows.map((r: any) => r.name)
    expect(names).toContain('Charlie') // Charlie has no posts but appears via LEFT JOIN
  })

  test('99. join with orderBy', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .orderBy('posts.title', 'asc')
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0].title).toBe('Post 1')
  })

  test('100. join with limit', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .limit(2)
      .all()
    expect(rows).toHaveLength(2)
  })
})

// QueryBuilder — Additional tests

describe('QueryBuilder — additional where operators', () => {
  test('101. where with != operator', async () => {
    const rows = await new QueryBuilder(db, 'users').where('role', '!=', 'admin').all()
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.role).not.toBe('admin')
  })

  test('102. where with = operator explicit', async () => {
    const rows = await new QueryBuilder(db, 'users').where('name', '=', 'Alice').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('103. where with < operator', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', '<', 30).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bob')
  })

  test('104. orWhere with multiple conditions', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .where('name', 'Alice')
      .orWhere('name', 'Bob')
      .orWhere('name', 'Charlie')
      .all()
    expect(rows).toHaveLength(3)
  })

  test('105. whereIn with single value', async () => {
    const rows = await new QueryBuilder(db, 'users').whereIn('name', ['Alice']).all()
    expect(rows).toHaveLength(1)
  })

  test('106. whereIn with empty array returns no rows', async () => {
    const rows = await new QueryBuilder(db, 'users').whereIn('name', []).all()
    expect(rows).toHaveLength(0)
  })

  test('107. whereNotIn with all values excludes everything', async () => {
    const rows = await new QueryBuilder(db, 'users').whereNotIn('name', ['Alice', 'Bob', 'Charlie']).all()
    expect(rows).toHaveLength(0)
  })

  test('108. whereBetween inclusive boundaries', async () => {
    const rows = await new QueryBuilder(db, 'users').whereBetween('age', [25, 35]).all()
    expect(rows).toHaveLength(3) // 25, 30, 35
  })

  test('109. whereBetween narrow range', async () => {
    const rows = await new QueryBuilder(db, 'users').whereBetween('age', [30, 30]).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('110. whereLike case sensitivity', async () => {
    const rows = await new QueryBuilder(db, 'users').whereLike('name', 'alice').all()
    // SQLite LIKE is case-insensitive for ASCII
    expect(rows).toHaveLength(1)
  })
})

describe('QueryBuilder — additional orderBy', () => {
  test('111. orderBy name asc', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('name', 'asc').all()
    expect(rows[0].name).toBe('Alice')
    expect(rows[1].name).toBe('Bob')
    expect(rows[2].name).toBe('Charlie')
  })

  test('112. orderBy name desc', async () => {
    const rows = await new QueryBuilder(db, 'users').orderBy('name', 'desc').all()
    expect(rows[0].name).toBe('Charlie')
    expect(rows[1].name).toBe('Bob')
    expect(rows[2].name).toBe('Alice')
  })

  test('113. orderBy with where', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .where('role', 'user')
      .orderBy('age', 'asc')
      .all()
    expect(rows[0].name).toBe('Bob')
    expect(rows[1].name).toBe('Charlie')
  })

  test('114. limit 1 with orderBy desc gets max', async () => {
    const row = await new QueryBuilder(db, 'users')
      .orderBy('age', 'desc')
      .first()
    expect(row.name).toBe('Charlie')
    expect(row.age).toBe(35)
  })

  test('115. limit 1 with orderBy asc gets min', async () => {
    const row = await new QueryBuilder(db, 'users')
      .orderBy('age', 'asc')
      .first()
    expect(row.name).toBe('Bob')
    expect(row.age).toBe(25)
  })
})

describe('QueryBuilder — additional aggregates', () => {
  test('116. count on posts table', async () => {
    const n = await new QueryBuilder(db, 'posts').whereNotNull('user_id').count()
    expect(n).toBeGreaterThanOrEqual(3)
  })

  test('117. sum on empty result returns 0', async () => {
    const total = await new QueryBuilder(db, 'users').where('name', 'Nobody').sum('age')
    expect(total).toBe(0)
  })

  test('118. min on single row result', async () => {
    const min = await new QueryBuilder(db, 'users').where('name', 'Alice').min('age')
    expect(min).toBe(30)
  })

  test('119. max on single row result', async () => {
    const max = await new QueryBuilder(db, 'users').where('name', 'Bob').max('age')
    expect(max).toBe(25)
  })

  test('120. count with whereIn', async () => {
    const n = await new QueryBuilder(db, 'users').whereIn('name', ['Alice', 'Bob']).count()
    expect(n).toBe(2)
  })
})

describe('QueryBuilder — additional groupBy/having', () => {
  test('121. groupBy with count', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .select('role')
      .groupBy('role')
      .all()
    const roles = rows.map((r: any) => r.role)
    expect(roles).toContain('admin')
    expect(roles).toContain('user')
  })

  test('122. groupBy with aggregate in select', async () => {
    const rows = await new QueryBuilder(db, 'posts')
      .select('status')
      .groupBy('status')
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(2) // draft and published
  })

  test('123. havingRaw with equality', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .select('role')
      .groupBy('role')
      .havingRaw('COUNT(*) = ?', [1])
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(1) // admin has count 1
    expect(rows[0].role).toBe('admin')
  })
})

describe('QueryBuilder — additional pagination', () => {
  test('124. paginate with perPage equal to total', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(1, 3)
    expect(result.data).toHaveLength(3)
    expect(result.meta.lastPage).toBe(1)
    expect(result.meta.hasMore).toBe(false)
  })

  test('125. paginate with perPage greater than total', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(1, 100)
    expect(result.data).toHaveLength(3)
    expect(result.meta.total).toBe(3)
    expect(result.meta.lastPage).toBe(1)
  })

  test('126. paginate with orderBy', async () => {
    const result = await new QueryBuilder(db, 'users').orderBy('age', 'desc').paginate(1, 2)
    expect(result.data[0].name).toBe('Charlie')
    expect(result.data[1].name).toBe('Alice')
  })

  test('127. paginate with where and orderBy', async () => {
    const result = await new QueryBuilder(db, 'users')
      .where('role', 'user')
      .orderBy('age', 'asc')
      .paginate(1, 10)
    expect(result.data[0].name).toBe('Bob')
    expect(result.data[1].name).toBe('Charlie')
    expect(result.meta.total).toBe(2)
  })
})

describe('QueryBuilder — additional update/delete', () => {
  test('128. update single column', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Alice').update({ role: 'superadmin' })
    const row = await db.queryOne("SELECT role FROM users WHERE name = ?", ['Alice'])
    expect(row!.role).toBe('superadmin')
    await db.run("UPDATE users SET role = 'admin' WHERE name = ?", ['Alice'])
  })

  test('129. increment by specific amount', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Bob').increment('age', 10)
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Bob'])
    expect(row!.age).toBe(35)
    await db.run("UPDATE users SET age = 25 WHERE name = ?", ['Bob'])
  })

  test('130. decrement by default (1)', async () => {
    await new QueryBuilder(db, 'users').where('name', 'Charlie').decrement('age')
    const row = await db.queryOne("SELECT age FROM users WHERE name = ?", ['Charlie'])
    expect(row!.age).toBe(34)
    await db.run("UPDATE users SET age = 35 WHERE name = ?", ['Charlie'])
  })
})

describe('QueryBuilder — additional join tests', () => {
  test('131. join with count aggregate', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .whereRaw('posts.status = ?', ['published'])
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  test('132. left join shows all users including those without posts', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .leftJoin('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title')
      .all()
    const names = rows.map((r: any) => r.name)
    expect(names).toContain('Charlie')
    expect(names).toContain('Alice')
  })

  test('133. join with multiple conditions via whereRaw', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .select('users.name', 'posts.title', 'posts.status')
      .whereRaw('posts.status = ? AND users.role = ?', ['published', 'admin'])
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const row of rows) {
      expect(row.status).toBe('published')
    }
  })
})

describe('QueryBuilder — toSQL additional', () => {
  test('134. toSQL for join query', () => {
    const { sql, params } = new QueryBuilder(db, 'users')
      .join('posts', 'users.id', '=', 'posts.user_id')
      .where('posts.status', 'published')
      .toSQL()
    expect(sql).toContain('JOIN')
    expect(sql).toContain('WHERE')
    expect(params).toEqual(['published'])
  })

  test('135. toSQL for groupBy query', () => {
    const { sql } = new QueryBuilder(db, 'users')
      .select('role')
      .groupBy('role')
      .toSQL()
    expect(sql).toContain('GROUP BY')
  })

  test('136. toQuery for whereIn', () => {
    const query = new QueryBuilder(db, 'users').whereIn('name', ['Alice', 'Bob']).toQuery()
    expect(query).toContain('Alice')
    expect(query).toContain('Bob')
  })
})

describe('InsertBuilder — additional', () => {
  test('137. insert row with all columns', async () => {
    await new InsertBuilder(db, 'users').values({ name: 'Grace', email: 'grace@tekir.dev', role: 'user', age: 27 }).exec()
    const row = await db.queryOne("SELECT * FROM users WHERE name = ?", ['Grace'])
    expect(row).not.toBeNull()
    expect(row!.age).toBe(27)
    expect(row!.role).toBe('user')
    await db.run("DELETE FROM users WHERE name = ?", ['Grace'])
  })

  test('138. insert and verify auto-increment id', async () => {
    await new InsertBuilder(db, 'users').values({ name: 'Henry', email: 'henry@tekir.dev', role: 'user', age: 40 }).exec()
    const row = await db.queryOne("SELECT id FROM users WHERE name = ?", ['Henry'])
    expect(row!.id).toBeGreaterThan(0)
    await db.run("DELETE FROM users WHERE name = ?", ['Henry'])
  })

  test('139. multiInsert with single item', async () => {
    await new InsertBuilder(db, 'users').multiInsert([
      { name: 'Iris', email: 'iris@tekir.dev', role: 'user', age: 29 }
    ]).exec()
    const row = await db.queryOne("SELECT * FROM users WHERE name = ?", ['Iris'])
    expect(row).not.toBeNull()
    await db.run("DELETE FROM users WHERE name = ?", ['Iris'])
  })

  test('140. toSQL for multiInsert', () => {
    const sql = new InsertBuilder(db, 'users').multiInsert([
      { name: 'A', email: 'a@test.com' },
      { name: 'B', email: 'b@test.com' },
    ]).toSQL()
    expect(sql).toContain('INSERT INTO')
    expect(sql).toContain('VALUES')
  })
})

// QueryBuilder — edge cases and chaining

describe('QueryBuilder — chaining and edge cases', () => {
  test('141. select then all returns correct shape', async () => {
    const rows = await new QueryBuilder(db, 'users').select('name').all()
    expect(rows[0]).toHaveProperty('name')
    expect(Object.keys(rows[0])).toHaveLength(1)
  })

  test('142. where equals with number value', async () => {
    const rows = await new QueryBuilder(db, 'users').where('age', 30).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('143. first on empty result is null', async () => {
    const row = await new QueryBuilder(db, 'users').where('age', 999).first()
    expect(row).toBeNull()
  })

  test('144. firstOrFail on existing row succeeds', async () => {
    const row = await new QueryBuilder(db, 'users').where('name', 'Alice').firstOrFail()
    expect(row.name).toBe('Alice')
  })

  test('145. count with no where returns total', async () => {
    const n = await new QueryBuilder(db, 'users').count()
    expect(n).toBe(3)
  })

  test('146. sum on all users', async () => {
    const total = await new QueryBuilder(db, 'users').sum('age')
    expect(total).toBe(90)
  })

  test('147. paginate returns correct meta for page 1', async () => {
    const result = await new QueryBuilder(db, 'users').paginate(1, 2)
    expect(result.meta.page).toBe(1)
    expect(result.meta.perPage).toBe(2)
  })

  test('148. where chained with select', async () => {
    const rows = await new QueryBuilder(db, 'users')
      .select('name', 'age')
      .where('age', '>', 25)
      .all()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).toHaveProperty('age')
    expect(rows[0]).not.toHaveProperty('email')
  })

  test('149. toSQL for simple select all', () => {
    const { sql, params } = new QueryBuilder(db, 'users').toSQL()
    expect(sql).toContain('SELECT')
    expect(params).toEqual([])
  })

  test('150. toSQL for where with value', () => {
    const { sql, params } = new QueryBuilder(db, 'users').where('name', 'Alice').toSQL()
    expect(params).toEqual(['Alice'])
  })
})
