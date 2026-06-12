import { test, expect, describe, beforeAll } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import { QueryBuilder, InsertBuilder, validateIdentifier } from '../src/query_builder'

/**
 * SQL INJECTION PROOF TESTS
 * These tests run against a REAL SQLite database and prove that
 * no SQL injection payload can escape parameterization.
 */

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
  await db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, password TEXT, role TEXT DEFAULT 'user')`)
  await db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['Admin', 'admin@test.com', 'secret123', 'admin'])
  await db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['User', 'user@test.com', 'pass456', 'user'])
  await db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['Guest', 'guest@test.com', 'guest789', 'guest'])
})

// ═══════════════════════════════════════════════════════════
// Classic SQL injection payloads in WHERE values
// ═══════════════════════════════════════════════════════════

describe('SQLi — WHERE value injection (all should fail)', () => {
  const payloads = [
    "' OR '1'='1",
    "' OR '1'='1' --",
    "' OR '1'='1' /*",
    "'; DROP TABLE users; --",
    "' UNION SELECT * FROM users --",
    "' UNION SELECT 1,2,3,4,5 --",
    "1' OR '1'='1",
    "admin'--",
    "1; DROP TABLE users",
    "' AND 1=1 --",
    "' AND '1'='1",
    "') OR ('1'='1",
    "admin' #",
    "' OR 1=1 LIMIT 1 --",
    "' UNION ALL SELECT NULL,NULL,NULL,NULL,NULL --",
  ]

  for (const payload of payloads) {
    test(`WHERE value: ${payload.slice(0, 40)}...`, async () => {
      const result = await new QueryBuilder(db, 'users').where('name', payload).all()
      expect(result.length).toBe(0) // injection should match nothing
    })
  }

  for (const payload of payloads) {
    test(`whereLike value: ${payload.slice(0, 40)}...`, async () => {
      const result = await new QueryBuilder(db, 'users').whereLike('name', payload).all()
      expect(result.length).toBe(0)
    })
  }
})

// ═══════════════════════════════════════════════════════════
// SQL injection in WHERE column names (should throw)
// ═══════════════════════════════════════════════════════════

describe('SQLi — WHERE column injection (all should throw)', () => {
  const badColumns = [
    "name; DROP TABLE users --",
    "name' OR '1'='1",
    'name" OR 1=1',
    "(SELECT password FROM users LIMIT 1)",
    "name UNION SELECT password",
    "1=1; --",
    "name/**/OR/**/1=1",
  ]

  for (const col of badColumns) {
    test(`column: ${col.slice(0, 40)}...`, () => {
      expect(() => new QueryBuilder(db, 'users').where(col, 'x')).toThrow('Invalid SQL identifier')
    })
  }
})

// ═══════════════════════════════════════════════════════════
// SQL injection in WHERE operator (should throw)
// ═══════════════════════════════════════════════════════════

describe('SQLi — WHERE operator injection (all should throw)', () => {
  const badOps = [
    "OR 1=1 --",
    "= 1 OR 1",
    "; DROP TABLE",
    "UNION",
    "AND 1=1",
    "--",
    "/**/OR/**/",
  ]

  for (const op of badOps) {
    test(`operator: ${op}`, () => {
      expect(() => new QueryBuilder(db, 'users').where('name', op, 'x')).toThrow('Invalid SQL operator')
    })
  }
})

// ═══════════════════════════════════════════════════════════
// SQL injection in INSERT values (should be parameterized)
// ═══════════════════════════════════════════════════════════

describe('SQLi — INSERT value injection', () => {
  test('SQL in name field is stored as literal string', async () => {
    const malicious = "'; DROP TABLE users; --"
    await new QueryBuilder(db, 'users').insert({ name: malicious, email: 'evil@test.com', password: 'x', role: 'user' })
    const r = await new QueryBuilder(db, 'users').where('email', 'evil@test.com').first()
    expect(r.name).toBe(malicious) // stored as literal, no injection
    // Table still exists
    expect(await new QueryBuilder(db, 'users').count()).toBeGreaterThan(3)
    // Cleanup
    await new QueryBuilder(db, 'users').where('email', 'evil@test.com').delete()
  })

  test('UNION in email is stored literally', async () => {
    const payload = "' UNION SELECT * FROM users --"
    await new QueryBuilder(db, 'users').insert({ name: 'evil', email: payload, password: 'x', role: 'user' })
    const r = await new QueryBuilder(db, 'users').where('name', 'evil').first()
    expect(r.email).toBe(payload)
    await new QueryBuilder(db, 'users').where('name', 'evil').delete()
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in INSERT column keys (should throw)
// ═══════════════════════════════════════════════════════════

describe('SQLi — INSERT column key injection (all should throw)', () => {
  const badKeys = [
    'name; DROP TABLE users',
    'name" OR 1=1',
    "name' --",
    '(SELECT 1)',
    'name UNION SELECT 1',
  ]

  for (const key of badKeys) {
    test(`insert key: ${key.slice(0, 30)}...`, async () => {
      await expect(new QueryBuilder(db, 'users').insert({ [key]: 'x' })).rejects.toThrow('Invalid SQL identifier')
    })
  }
})

// ═══════════════════════════════════════════════════════════
// SQL injection in UPDATE values
// ═══════════════════════════════════════════════════════════

describe('SQLi — UPDATE value injection', () => {
  test('SQL in update value is stored literally', async () => {
    await new QueryBuilder(db, 'users').insert({ name: 'updatetest', email: 'ut@test.com', password: 'x', role: 'user' })
    await new QueryBuilder(db, 'users').where('name', 'updatetest').update({ name: "admin'; DROP TABLE users;--" })
    const r = await new QueryBuilder(db, 'users').where('email', 'ut@test.com').first()
    expect(r.name).toBe("admin'; DROP TABLE users;--")
    expect(await new QueryBuilder(db, 'users').count()).toBeGreaterThan(3) // table intact
    await new QueryBuilder(db, 'users').where('email', 'ut@test.com').delete()
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in UPDATE column keys (should throw)
// ═══════════════════════════════════════════════════════════

describe('SQLi — UPDATE column key injection (all should throw)', () => {
  test('injection in update key', async () => {
    await expect(
      new QueryBuilder(db, 'users').where('id', 1).update({ 'name; DROP TABLE users': 'x' })
    ).rejects.toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in DELETE WHERE
// ═══════════════════════════════════════════════════════════

describe('SQLi — DELETE injection', () => {
  test('injection in delete value does not delete all', async () => {
    const before = await new QueryBuilder(db, 'users').count()
    await new QueryBuilder(db, 'users').where('name', "' OR 1=1 --").delete()
    const after = await new QueryBuilder(db, 'users').count()
    expect(after).toBe(before) // nothing deleted
  })

  test('injection in delete column throws', () => {
    expect(() => new QueryBuilder(db, 'users').where("1=1; --", 'x')).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in table name (should throw)
// ═══════════════════════════════════════════════════════════

describe('SQLi — table name injection', () => {
  const badTables = [
    'users; DROP TABLE users',
    'users" OR 1=1',
    "users' --",
    'users UNION SELECT 1',
    '(SELECT 1)',
  ]

  for (const t of badTables) {
    test(`table: ${t.slice(0, 30)}...`, () => {
      expect(() => new QueryBuilder(db, t)).toThrow('Invalid SQL identifier')
    })
  }

  test('InsertBuilder rejects bad table name', () => {
    expect(() => new InsertBuilder(db, 'users; DROP TABLE x')).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in JOIN
// ═══════════════════════════════════════════════════════════

describe('SQLi — JOIN injection', () => {
  test('injection in join table throws', () => {
    const qb = new QueryBuilder(db, 'users')
    expect(() => qb.join('users; DROP TABLE x', 'a', '=', 'b')).toThrow()
  })

  test('injection in join column throws', () => {
    const qb = new QueryBuilder(db, 'users')
    expect(() => qb.join('users', "1=1 OR col", '=', 'b')).toThrow()
  })

  test('injection in join operator throws', () => {
    const qb = new QueryBuilder(db, 'users')
    expect(() => qb.join('users', 'a.id', 'OR 1=1', 'b.id')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in ORDER BY
// ═══════════════════════════════════════════════════════════

describe('SQLi — ORDER BY injection', () => {
  test('injection in orderBy column throws', () => {
    expect(() => new QueryBuilder(db, 'users').orderBy('name; DROP TABLE users')).toThrow()
  })

  test('valid orderBy works', async () => {
    const r = await new QueryBuilder(db, 'users').orderBy('name', 'asc').all()
    expect(r.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in GROUP BY
// ═══════════════════════════════════════════════════════════

describe('SQLi — GROUP BY injection', () => {
  test('injection in groupBy column throws', () => {
    expect(() => new QueryBuilder(db, 'users').groupBy('role; DROP TABLE users')).toThrow()
  })

  test('valid groupBy works', async () => {
    const r = await new QueryBuilder(db, 'users').select('role').groupBy('role').all()
    expect(r.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════
// SQL injection in aggregates
// ═══════════════════════════════════════════════════════════

describe('SQLi — aggregate column injection', () => {
  test('count with injection throws', async () => {
    await expect(new QueryBuilder(db, 'users').count('*); DROP TABLE users; --')).rejects.toThrow()
  })

  test('sum with injection throws', async () => {
    await expect(new QueryBuilder(db, 'users').sum('id); DROP TABLE users')).rejects.toThrow()
  })

  test('avg with injection throws', async () => {
    await expect(new QueryBuilder(db, 'users').avg('id; DROP TABLE')).rejects.toThrow()
  })

  test('min with injection throws', async () => {
    await expect(new QueryBuilder(db, 'users').min("id' OR 1=1")).rejects.toThrow()
  })

  test('max with injection throws', async () => {
    await expect(new QueryBuilder(db, 'users').max('id" UNION SELECT')).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// Prove the table survives ALL attacks
// ═══════════════════════════════════════════════════════════

describe('SQLi — table survival proof', () => {
  test('users table still exists after all tests', async () => {
    const count = await new QueryBuilder(db, 'users').count()
    expect(count).toBeGreaterThanOrEqual(3) // original 3 users
  })

  test('admin user data is intact', async () => {
    const admin = await new QueryBuilder(db, 'users').where('role', 'admin').first()
    expect(admin).not.toBeNull()
    expect(admin.name).toBe('Admin')
    expect(admin.email).toBe('admin@test.com')
  })

  test('password column was never leaked via injection', async () => {
    // Try to extract passwords via various injection techniques in WHERE
    const attempts = [
      new QueryBuilder(db, 'users').where('name', "' UNION SELECT password FROM users --").all(),
      new QueryBuilder(db, 'users').whereLike('name', "% UNION SELECT password%").all(),
      new QueryBuilder(db, 'users').where('name', "admin' AND 1=1 --").all(),
    ]
    const results = await Promise.all(attempts)
    for (const r of results) expect(r.length).toBe(0)
  })
})
