import { test, expect, describe } from 'bun:test'
import { createDatabase, SqlCompiler, QueryBuilder, resolveSsl, maskCredentials } from '../src/index'

// ── transaction() — real rollback (sqlite) ────────────────────

describe('Database.transaction — atomicity', () => {
  function freshDb() {
    const db = createDatabase({
      default: 'main',
      connections: { main: { driver: 'sqlite', connection: { path: ':memory:' } } },
    })
    return db
  }

  test('commits when the callback succeeds', async () => {
    const db = freshDb()
    await db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)')
    await db.run('INSERT INTO accounts (id, balance) VALUES (1, 100)')

    await db.transaction(async () => {
      await db.run('UPDATE accounts SET balance = balance - 30 WHERE id = 1')
    })

    const row = await db.queryOne<{ balance: number }>('SELECT balance FROM accounts WHERE id = 1')
    expect(row!.balance).toBe(70)
    db.close()
  })

  test('rolls back all writes when the callback throws', async () => {
    const db = freshDb()
    await db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)')
    await db.run('INSERT INTO accounts (id, balance) VALUES (1, 100)')

    await expect(db.transaction(async () => {
      await db.run('UPDATE accounts SET balance = 0 WHERE id = 1')
      throw new Error('boom')
    })).rejects.toThrow('boom')

    // The write inside the failed transaction must be rolled back.
    const row = await db.queryOne<{ balance: number }>('SELECT balance FROM accounts WHERE id = 1')
    expect(row!.balance).toBe(100)
    db.close()
  })
})

// ── SSL secure-by-default ─────────────────────────────────────
//
// resolveSsl is the single source of truth for how the pg/mysql drivers decide
// their TLS verification posture. An implicit ssl:true must verify the cert;
// disabling verification must require an explicit object.

describe('SSL configuration — secure by default (resolveSsl)', () => {
  test('implicit ssl:true verifies the certificate', () => {
    expect(resolveSsl(true, true)).toEqual({ rejectUnauthorized: true })
  })

  test('sslmode=require in URL (needsSsl true, ssl undefined) still verifies', () => {
    expect(resolveSsl(undefined, true)).toEqual({ rejectUnauthorized: true })
  })

  test('explicit opt-out is honored', () => {
    expect(resolveSsl({ rejectUnauthorized: false }, true)).toEqual({ rejectUnauthorized: false })
  })

  test('explicit CA object is passed through', () => {
    expect(resolveSsl({ rejectUnauthorized: true, ca: 'PEM' }, true)).toEqual({ rejectUnauthorized: true, ca: 'PEM' })
  })

  test('no ssl requested leaves ssl undefined', () => {
    expect(resolveSsl(undefined, false)).toBeUndefined()
    expect(resolveSsl(false, false)).toBeUndefined()
  })
})

// ── Credential masking in errors ──────────────────────────────

describe('maskCredentials', () => {
  test('redacts the password in a postgres URL', () => {
    expect(maskCredentials('connect postgres://admin:s3cret@db:5432/app failed'))
      .toBe('connect postgres://admin:****@db:5432/app failed')
  })

  test('redacts the password in a mysql URL', () => {
    expect(maskCredentials('mysql://root:hunter2@localhost:3306/x'))
      .toBe('mysql://root:****@localhost:3306/x')
  })

  test('leaves credential-free text untouched', () => {
    expect(maskCredentials('connection refused at localhost:5432')).toBe('connection refused at localhost:5432')
  })
})

// ── Migration identifier validation ───────────────────────────

describe('SqlCompiler.quote — identifier injection', () => {
  test('rejects an injection payload as a table name', () => {
    const c = new SqlCompiler('sqlite')
    expect(() => c.compile([{ type: 'dropTable', tableName: 'users"; DROP TABLE secrets;--' }]))
      .toThrow('Invalid SQL identifier')
  })

  test('rejects backtick escape on mysql', () => {
    const c = new SqlCompiler('mysql')
    expect(() => c.compile([{ type: 'dropTable', tableName: 'users` ; DROP' }]))
      .toThrow('Invalid SQL identifier')
  })

  test('accepts a normal table name', () => {
    const c = new SqlCompiler('sqlite')
    expect(c.compile([{ type: 'dropTable', tableName: 'users' }])[0]).toBe('DROP TABLE "users"')
  })
})

// ── Pagination bounds ─────────────────────────────────────────

describe('QueryBuilder.paginate — bounds clamping', () => {
  function memDb() {
    const db = createDatabase({
      default: 'main',
      connections: { main: { driver: 'sqlite', connection: { path: ':memory:' } } },
    })
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)')
    for (let i = 1; i <= 5; i++) db.run('INSERT INTO items (id) VALUES (?)', [i])
    return db
  }

  test('page 0 clamps to first page (no negative offset)', async () => {
    const db = memDb()
    const res = await new QueryBuilder(db, 'items').orderBy('id').paginate(0, 2)
    expect(res.meta.page).toBe(1)
    expect(res.data).toHaveLength(2)
    db.close()
  })

  test('perPage 0 / NaN clamps to default 20', async () => {
    const db = memDb()
    const res = await new QueryBuilder(db, 'items').orderBy('id').paginate(1, 0)
    expect(res.meta.perPage).toBe(20)
    expect(res.data).toHaveLength(5)
    db.close()
  })

  test('empty table reports lastPage 0 and hasMore false', async () => {
    const db = createDatabase({
      default: 'main',
      connections: { main: { driver: 'sqlite', connection: { path: ':memory:' } } },
    })
    db.exec('CREATE TABLE empty (id INTEGER PRIMARY KEY)')
    const res = await new QueryBuilder(db, 'empty').paginate(1, 10)
    expect(res.meta.lastPage).toBe(0)
    expect(res.meta.hasMore).toBe(false)
    db.close()
  })
})

// ── whereIn / whereNotIn with empty arrays ────────────────────

describe('QueryBuilder.whereIn — empty array safety', () => {
  function memDb() {
    const db = createDatabase({
      default: 'main',
      connections: { main: { driver: 'sqlite', connection: { path: ':memory:' } } },
    })
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)')
    for (let i = 1; i <= 3; i++) db.run('INSERT INTO items (id) VALUES (?)', [i])
    return db
  }

  test('whereIn([]) matches nothing instead of emitting invalid SQL', async () => {
    const db = memDb()
    const rows = await new QueryBuilder(db, 'items').whereIn('id', []).all()
    expect(rows).toHaveLength(0)
    db.close()
  })

  test('whereNotIn([]) matches everything', async () => {
    const db = memDb()
    const rows = await new QueryBuilder(db, 'items').whereNotIn('id', []).all()
    expect(rows).toHaveLength(3)
    db.close()
  })
})
