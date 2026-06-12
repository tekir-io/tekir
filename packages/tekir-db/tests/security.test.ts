import { test, expect, describe } from 'bun:test'
import { QueryBuilder, InsertBuilder, validateIdentifier, quoteIdentifier, validateOperator } from '../src/query_builder'

// Mock DB that captures SQL for inspection
function createCapturingDb() {
  const captured: { sql: string; params: any[] }[] = []
  return {
    query: async (sql: string, params: any[] = []) => { captured.push({ sql, params }); return [] },
    queryOne: async (sql: string, params: any[] = []) => { captured.push({ sql, params }); return null },
    run: async (sql: string, params: any[] = []) => { captured.push({ sql, params }) },
    captured,
  }
}

const mockDb = createCapturingDb()

// ═══════════════════════════════════════════════════════════
// validateIdentifier
// ═══════════════════════════════════════════════════════════

describe('validateIdentifier — SQL injection prevention', () => {
  test('accepts valid simple identifiers', () => {
    expect(() => validateIdentifier('users')).not.toThrow()
    expect(() => validateIdentifier('user_name')).not.toThrow()
    expect(() => validateIdentifier('_private')).not.toThrow()
    expect(() => validateIdentifier('Column1')).not.toThrow()
    expect(() => validateIdentifier('a')).not.toThrow()
    expect(() => validateIdentifier('__double')).not.toThrow()
  })

  test('accepts dot-separated identifiers (table.column)', () => {
    expect(() => validateIdentifier('users.id')).not.toThrow()
    expect(() => validateIdentifier('t1.column_name')).not.toThrow()
    expect(() => validateIdentifier('schema.table.column')).not.toThrow()
  })

  test('rejects classic SQL injection payloads', () => {
    expect(() => validateIdentifier('users; DROP TABLE users--')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier("1' OR '1'='1")).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('1; DELETE FROM users')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier("' UNION SELECT * FROM users--")).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('admin\' --')).toThrow('Invalid SQL identifier')
  })

  test('rejects double-quote escape attempts', () => {
    expect(() => validateIdentifier('users" OR 1=1--')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('" OR ""="')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('col"')).toThrow('Invalid SQL identifier')
  })

  test('rejects UNION-based injection', () => {
    expect(() => validateIdentifier('id UNION SELECT password FROM users')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('col UNION ALL SELECT 1,2,3')).toThrow('Invalid SQL identifier')
  })

  test('rejects subquery injection', () => {
    expect(() => validateIdentifier('(SELECT password FROM users)')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('col FROM users WHERE 1=1; --')).toThrow('Invalid SQL identifier')
  })

  test('rejects comment injection', () => {
    expect(() => validateIdentifier('id--')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('id/**/OR/**/1=1')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('id #comment')).toThrow('Invalid SQL identifier')
  })

  test('rejects hex/char encoded injection', () => {
    expect(() => validateIdentifier('0x61646D696E')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier("CHAR(65)"  )).toThrow('Invalid SQL identifier')
  })

  test('rejects empty string', () => {
    expect(() => validateIdentifier('')).toThrow('Invalid SQL identifier')
  })

  test('rejects identifiers starting with numbers', () => {
    expect(() => validateIdentifier('1users')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('0_table')).toThrow('Invalid SQL identifier')
  })

  test('rejects whitespace', () => {
    expect(() => validateIdentifier('user name')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier(' users')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('users ')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('users\t')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('users\n')).toThrow('Invalid SQL identifier')
  })

  test('rejects special characters', () => {
    const chars = ['$', '@', '!', '#', '%', '^', '&', '*', '(', ')', '-', '+', '=', '{', '}', '[', ']', '|', '\\', '/', '?', '<', '>', ',', ':', ';', "'", '"', '`', '~']
    for (const ch of chars) {
      expect(() => validateIdentifier(`col${ch}name`)).toThrow('Invalid SQL identifier')
    }
  })

  test('rejects null bytes', () => {
    expect(() => validateIdentifier('users\0')).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// quoteIdentifier
// ═══════════════════════════════════════════════════════════

describe('quoteIdentifier — safe quoting', () => {
  test('quotes simple identifier', () => {
    expect(quoteIdentifier('users')).toBe('"users"')
    expect(quoteIdentifier('_meta')).toBe('"_meta"')
  })

  test('quotes dot-separated table.column', () => {
    expect(quoteIdentifier('users.id')).toBe('"users"."id"')
    expect(quoteIdentifier('public.users.email')).toBe('"public"."users"."email"')
  })

  test('throws on injection attempts', () => {
    expect(() => quoteIdentifier('users; DROP TABLE x')).toThrow()
    expect(() => quoteIdentifier('a" OR 1=1')).toThrow()
    expect(() => quoteIdentifier("' OR 1=1--")).toThrow()
  })

  test('each part of dotted name is individually validated', () => {
    expect(() => quoteIdentifier('valid.1invalid')).toThrow()
    expect(() => quoteIdentifier('valid.')).toThrow()
    expect(() => quoteIdentifier('.column')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// validateOperator
// ═══════════════════════════════════════════════════════════

describe('validateOperator — operator whitelist', () => {
  test('accepts valid comparison operators', () => {
    for (const op of ['=', '!=', '<', '>', '<=', '>=', '<>']) {
      expect(() => validateOperator(op)).not.toThrow()
    }
  })

  test('accepts LIKE operators', () => {
    expect(() => validateOperator('LIKE')).not.toThrow()
    expect(() => validateOperator('NOT LIKE')).not.toThrow()
    expect(() => validateOperator('like')).not.toThrow()
  })

  test('accepts IS / IS NOT', () => {
    expect(() => validateOperator('IS')).not.toThrow()
    expect(() => validateOperator('IS NOT')).not.toThrow()
  })

  test('rejects SQL injection in operator', () => {
    expect(() => validateOperator('OR 1=1')).toThrow('Invalid SQL operator')
    expect(() => validateOperator('= 1; DROP TABLE users--')).toThrow('Invalid SQL operator')
    expect(() => validateOperator('; DELETE FROM')).toThrow('Invalid SQL operator')
    expect(() => validateOperator('UNION')).toThrow('Invalid SQL operator')
    expect(() => validateOperator('AND')).toThrow('Invalid SQL operator')
  })

  test('rejects empty operator', () => {
    expect(() => validateOperator('')).toThrow('Invalid SQL operator')
  })
})

// ═══════════════════════════════════════════════════════════
// WHERE — column & operator injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder WHERE — SQL injection prevention', () => {
  test('where uses parameterized values (not interpolated)', () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('name', 'admin')
    qb.toSQL()
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('= ?')
    expect(sql).not.toContain("'admin'")
    expect(params).toEqual(['admin'])
  })

  test('where rejects SQL injection in column name', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.where('name; DROP TABLE users', 'admin')).toThrow('Invalid SQL identifier')
  })

  test('where rejects injection in column with quotes', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.where('" OR 1=1--', 'x')).toThrow('Invalid SQL identifier')
  })

  test('where 3-arg form validates operator', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.where('age', '>', 18)).not.toThrow()
    expect(() => qb.where('age', 'OR 1=1;--', 18)).toThrow('Invalid SQL operator')
  })

  test('where 3-arg with valid operators works', () => {
    for (const op of ['=', '!=', '<', '>', '<=', '>=', '<>']) {
      const qb = new QueryBuilder(mockDb, 'users')
      expect(() => qb.where('col', op, 'val')).not.toThrow()
    }
  })

  test('orWhere rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.orWhere("col' OR '1'='1", 'x')).toThrow('Invalid SQL identifier')
  })

  test('orWhere 3-arg validates operator', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.orWhere('age', '; DROP TABLE', 5)).toThrow('Invalid SQL operator')
  })

  test('whereNot rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereNot('role; DROP TABLE users', 'admin')).toThrow('Invalid SQL identifier')
  })

  test('whereNull rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereNull('col UNION SELECT 1')).toThrow('Invalid SQL identifier')
  })

  test('whereNotNull rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereNotNull('col" OR 1=1')).toThrow('Invalid SQL identifier')
  })

  test('whereIn rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereIn("id; DELETE FROM users", [1, 2])).toThrow('Invalid SQL identifier')
  })

  test('whereIn values are parameterized', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereIn('id', [1, 2, 3])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('IN (?, ?, ?)')
    expect(params).toEqual([1, 2, 3])
  })

  test('whereNotIn rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereNotIn("id' OR 1=1", [1])).toThrow('Invalid SQL identifier')
  })

  test('whereBetween rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereBetween('age; DROP TABLE x', [10, 20])).toThrow('Invalid SQL identifier')
  })

  test('whereBetween values are parameterized', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereBetween('age', [18, 65])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('BETWEEN ? AND ?')
    expect(params).toEqual([18, 65])
  })

  test('whereLike rejects injection in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.whereLike("name' UNION SELECT", '%admin%')).toThrow('Invalid SQL identifier')
  })

  test('whereLike value is parameterized', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereLike('name', '%admin%')
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%admin%'])
  })

  test('whereRaw allows raw SQL (escape hatch)', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereRaw('LENGTH(name) > ?', [5])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('LENGTH(name) > ?')
    expect(params).toEqual([5])
  })

  test('chained wheres all get validated', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('name', 'admin').where('active', true).whereNotNull('email')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"name" = ?')
    expect(sql).toContain('"active" = ?')
    expect(sql).toContain('"email" IS NOT NULL')
  })
})

// ═══════════════════════════════════════════════════════════
// JOIN — comprehensive injection tests
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder JOIN — comprehensive SQL injection tests', () => {
  test('join with valid table.column works', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.join('users', 'orders.user_id', '=', 'users.id')
    const { sql } = qb.toSQL()
    expect(sql).toContain('INNER JOIN "users" ON "orders"."user_id" = "users"."id"')
  })

  test('leftJoin produces correct SQL', () => {
    const qb = new QueryBuilder(mockDb, 'posts')
    qb.leftJoin('comments', 'posts.id', '=', 'comments.post_id')
    const { sql } = qb.toSQL()
    expect(sql).toContain('LEFT JOIN "comments" ON "posts"."id" = "comments"."post_id"')
  })

  test('rightJoin produces correct SQL', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.rightJoin('products', 'orders.product_id', '=', 'products.id')
    const { sql } = qb.toSQL()
    expect(sql).toContain('RIGHT JOIN "products" ON "orders"."product_id" = "products"."id"')
  })

  test('join rejects injection in table name', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.join('users; DROP TABLE users--', 'a', '=', 'b')).toThrow('Invalid SQL identifier')
    expect(() => qb.join("users' OR '1", 'a', '=', 'b')).toThrow('Invalid SQL identifier')
    expect(() => qb.join('users UNION SELECT', 'a', '=', 'b')).toThrow('Invalid SQL identifier')
  })

  test('join rejects injection in col1', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.join('users', '1=1 OR col', '=', 'b')).toThrow('Invalid SQL identifier')
    expect(() => qb.join('users', 'a; DELETE FROM users', '=', 'b')).toThrow('Invalid SQL identifier')
  })

  test('join rejects injection in col2', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.join('users', 'a.id', '=', "b.id' OR '1'='1")).toThrow('Invalid SQL identifier')
    expect(() => qb.join('users', 'a.id', '=', '(SELECT 1)')).toThrow('Invalid SQL identifier')
  })

  test('join rejects all invalid operators', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    const badOps = ['OR 1=1', 'AND', '; DROP TABLE', 'LIKE', 'UNION', '= 1 OR 1', '==', '===', 'OR']
    for (const op of badOps) {
      expect(() => qb.join('users', 'a.id', op, 'b.id')).toThrow()
    }
  })

  test('join accepts all valid operators', () => {
    for (const op of ['=', '!=', '<', '>', '<=', '>=', '<>']) {
      const qb = new QueryBuilder(mockDb, 'a')
      expect(() => qb.join('b', 'a.id', op, 'b.id')).not.toThrow()
    }
  })

  test('multiple joins are all validated', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.join('users', 'orders.user_id', '=', 'users.id')
    qb.leftJoin('products', 'orders.product_id', '=', 'products.id')
    const { sql } = qb.toSQL()
    expect(sql).toContain('INNER JOIN "users"')
    expect(sql).toContain('LEFT JOIN "products"')
  })
})

// ═══════════════════════════════════════════════════════════
// HAVING
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder HAVING — injection prevention', () => {
  test('having validates column name', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.having('count; DROP TABLE', '>', 5)).toThrow('Invalid SQL identifier')
  })

  test('having validates operator', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.having('count', 'OR 1=1', 5)).toThrow('Invalid SQL operator')
  })

  test('having with valid args works', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.groupBy('user_id').having('total', '>', 100)
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('HAVING "total" > ?')
    expect(params).toEqual([100])
  })

  test('havingRaw allows raw SQL (escape hatch)', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.groupBy('user_id').havingRaw('COUNT(*) > ?', [5])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('HAVING COUNT(*) > ?')
    expect(params).toEqual([5])
  })
})

// ═══════════════════════════════════════════════════════════
// SELECT — column injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder SELECT — comprehensive column injection', () => {
  test('wildcard * is allowed', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    const { sql } = qb.toSQL()
    expect(sql).toContain('SELECT * FROM')
  })

  test('valid column names are quoted', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.select('name', 'email', 'created_at')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"name", "email", "created_at"')
  })

  test('table.column notation is properly quoted', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.select('users.name', 'users.email')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"users"."name"')
    expect(sql).toContain('"users"."email"')
  })

  test('select() rejects parenthesized expressions (use selectRaw)', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.select('COUNT(*)')).toThrow(/selectRaw/)
  })

  test('rejects UNION injection in column (whitespace blocked)', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.select('id UNION SELECT password FROM users')).toThrow(/selectRaw|Invalid/)
  })

  test('rejects semicolon in column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.select('name; DROP TABLE users')).toThrow(/selectRaw|Invalid/)
  })

  test('selectRaw passes aggregate expressions through verbatim', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.selectRaw('COUNT(*) AS total')
    const { sql } = qb.toSQL()
    expect(sql).toContain('COUNT(*) AS total')
  })

  test('DISTINCT with valid columns works', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.distinct('name', 'email')
    const { sql } = qb.toSQL()
    expect(sql).toContain('DISTINCT')
    expect(sql).toContain('"name"')
  })

  test('DISTINCT rejects injection', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.distinct('name; DROP TABLE users')
    expect(() => qb.toSQL()).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// ORDER BY / GROUP BY
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder ORDER BY — comprehensive injection', () => {
  test('valid order by with ASC', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.orderBy('name', 'asc')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"name" ASC')
  })

  test('valid order by with DESC', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.orderBy('created_at', 'desc')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"created_at" DESC')
  })

  test('order by with table.column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.orderBy('users.name', 'asc')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"users"."name" ASC')
  })

  test('rejects injection in order by column', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.orderBy('name; DROP TABLE users')).toThrow('Invalid SQL identifier')
    expect(() => qb.orderBy('name UNION SELECT 1')).toThrow('Invalid SQL identifier')
    expect(() => qb.orderBy('1,2,3')).toThrow('Invalid SQL identifier')
  })

  test('direction is always ASC or DESC regardless of input', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.orderBy('name', 'desc')
    const { sql } = qb.toSQL()
    expect(sql).toContain('DESC')
    expect(sql).not.toContain('; DROP')
  })

  test('multiple order by columns', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.orderBy('name', 'asc').orderBy('created_at', 'desc')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"name" ASC, "created_at" DESC')
  })
})

describe('QueryBuilder GROUP BY — comprehensive injection', () => {
  test('valid group by', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.groupBy('user_id', 'status')
    const { sql } = qb.toSQL()
    expect(sql).toContain('"user_id", "status"')
  })

  test('rejects injection in group by', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    expect(() => qb.groupBy('user_id; DROP TABLE orders')).toThrow('Invalid SQL identifier')
    expect(() => qb.groupBy("col' OR 1=1")).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// LIMIT / OFFSET
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder LIMIT/OFFSET — comprehensive validation', () => {
  test('accepts valid values', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.limit(10).offset(20)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 20')
  })

  test('accepts zero', () => {
    expect(() => new QueryBuilder(mockDb, 'users').limit(0)).not.toThrow()
    expect(() => new QueryBuilder(mockDb, 'users').offset(0)).not.toThrow()
  })

  test('accepts large values', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.limit(1000000)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 1000000')
  })

  test('floors decimal values', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.limit(10.7).offset(5.3)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 5')
  })

  test('rejects negative values', () => {
    expect(() => new QueryBuilder(mockDb, 'users').limit(-1)).toThrow('Invalid LIMIT value')
    expect(() => new QueryBuilder(mockDb, 'users').offset(-5)).toThrow('Invalid OFFSET value')
    expect(() => new QueryBuilder(mockDb, 'users').limit(-Infinity)).toThrow('Invalid LIMIT value')
  })

  test('rejects NaN', () => {
    expect(() => new QueryBuilder(mockDb, 'users').limit(NaN)).toThrow('Invalid LIMIT value')
    expect(() => new QueryBuilder(mockDb, 'users').offset(NaN)).toThrow('Invalid OFFSET value')
  })

  test('rejects Infinity', () => {
    expect(() => new QueryBuilder(mockDb, 'users').limit(Infinity)).toThrow('Invalid LIMIT value')
    expect(() => new QueryBuilder(mockDb, 'users').offset(Infinity)).toThrow('Invalid OFFSET value')
  })

  test('forPage calculates correct limit/offset', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.forPage(3, 20)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 20')
    expect(sql).toContain('OFFSET 40')
  })
})

// ═══════════════════════════════════════════════════════════
// INSERT — column key injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder INSERT — column key injection', () => {
  test('valid insert with safe column names', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.insert({ name: 'test', email: 'test@test.com' })
    expect(db.captured[0].sql).toContain('"name"')
    expect(db.captured[0].sql).toContain('"email"')
    expect(db.captured[0].params).toEqual(['test', 'test@test.com'])
  })

  test('insert rejects injection in column key', async () => {
    const qb = new QueryBuilder(mockDb, 'users')
    await expect(qb.insert({ 'name; DROP TABLE users': 'x' })).rejects.toThrow('Invalid SQL identifier')
  })

  test('insert rejects quote escape in column key', async () => {
    const qb = new QueryBuilder(mockDb, 'users')
    await expect(qb.insert({ 'col" OR 1=1': 'x' })).rejects.toThrow('Invalid SQL identifier')
  })

  test('values are always parameterized (not interpolated)', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.insert({ name: "'; DROP TABLE users--" })
    expect(db.captured[0].sql).toContain('VALUES (?)')
    expect(db.captured[0].params).toEqual(["'; DROP TABLE users--"])
    expect(db.captured[0].sql).not.toContain('DROP TABLE')
  })

  test('multiInsert rejects injection in column keys', async () => {
    const qb = new QueryBuilder(mockDb, 'users')
    await expect(qb.multiInsert([{ 'name; DELETE FROM users': 'x' }])).rejects.toThrow('Invalid SQL identifier')
  })

  test('multiInsert values are parameterized', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.multiInsert([
      { name: 'a', email: 'a@x.com' },
      { name: 'b', email: 'b@x.com' },
    ])
    expect(db.captured[0].sql).toContain('(?, ?), (?, ?)')
    expect(db.captured[0].params).toEqual(['a', 'a@x.com', 'b', 'b@x.com'])
  })
})

// ═══════════════════════════════════════════════════════════
// UPDATE — column key injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder UPDATE — column key injection', () => {
  test('valid update with safe column names', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('id', 1)
    await qb.update({ name: 'new_name' })
    expect(db.captured[0].sql).toContain('"name" = ?')
    expect(db.captured[0].sql).toContain('WHERE "id" = ?')
  })

  test('update rejects injection in column key', async () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('id', 1)
    await expect(qb.update({ 'name; DROP TABLE users': 'x' })).rejects.toThrow('Invalid SQL identifier')
  })

  test('update values are parameterized', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('id', 1)
    await qb.update({ name: "'; DROP TABLE users--" })
    expect(db.captured[0].params[0]).toBe("'; DROP TABLE users--")
    expect(db.captured[0].sql).not.toContain('DROP TABLE')
  })
})

// ═══════════════════════════════════════════════════════════
// INCREMENT / DECREMENT — column injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder INCREMENT — column injection', () => {
  test('valid increment', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'products')
    qb.where('id', 1)
    await qb.increment('stock', 5)
    expect(db.captured[0].sql).toContain('"stock" = "stock" + ?')
    expect(db.captured[0].params[0]).toBe(5)
  })

  test('increment rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'products')
    await expect(qb.increment('stock; DROP TABLE products')).rejects.toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// AGGREGATES — column injection
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder AGGREGATES — column injection', () => {
  test('count(*) works', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.count()
    expect(db.captured[0].sql).toContain('COUNT(*)')
  })

  test('count with specific column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.count('email')
    expect(db.captured[0].sql).toContain('COUNT("email")')
  })

  test('count rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'users')
    await expect(qb.count('*) FROM users; DROP TABLE users; SELECT COUNT(*')).rejects.toThrow('Invalid SQL identifier')
  })

  test('sum rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    await expect(qb.sum('amount) FROM orders; DROP TABLE orders; SELECT SUM(id')).rejects.toThrow('Invalid SQL identifier')
  })

  test('avg rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    await expect(qb.avg('price; DROP TABLE orders')).rejects.toThrow('Invalid SQL identifier')
  })

  test('min rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    await expect(qb.min("price' OR '1'='1")).rejects.toThrow('Invalid SQL identifier')
  })

  test('max rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    await expect(qb.max('price" UNION SELECT password FROM users--')).rejects.toThrow('Invalid SQL identifier')
  })

  test('sum with valid column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.sum('total_amount')
    expect(db.captured[0].sql).toContain('SUM("total_amount")')
  })
})

// ═══════════════════════════════════════════════════════════
// InsertBuilder — column injection
// ═══════════════════════════════════════════════════════════

describe('InsertBuilder — column injection', () => {
  test('valid insert builder', async () => {
    const db = createCapturingDb()
    const ib = new InsertBuilder(db, 'users')
    ib.values({ name: 'test', email: 'test@x.com' })
    await ib.exec()
    expect(db.captured[0].sql).toContain('"name", "email"')
  })

  test('insert builder rejects injection in column keys', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ 'name; DROP TABLE users': 'x' })
    await expect(ib.exec()).rejects.toThrow('Invalid SQL identifier')
  })

  test('onConflict column is validated', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ name: 'test' }).onConflict('id; DROP TABLE users').ignore()
    await expect(ib.exec()).rejects.toThrow('Invalid SQL identifier')
  })

  test('merge column keys are validated', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ name: 'test' }).onConflict('id').merge({ 'name; DROP TABLE': 'x' })
    await expect(ib.exec()).rejects.toThrow('Invalid SQL identifier')
  })

  test('multiInsert column keys are validated', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.multiInsert([{ 'col" OR 1=1': 'x' }])
    await expect(ib.exec()).rejects.toThrow('Invalid SQL identifier')
  })

  test('toSQL validates column keys', () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ 'bad; key': 'x' })
    expect(() => ib.toSQL()).toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// Full query building — end-to-end SQL output verification
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder — end-to-end SQL correctness', () => {
  test('complex SELECT with joins, where, order, limit produces safe SQL', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.select('orders.id', 'users.name', 'orders.total')
      .join('users', 'orders.user_id', '=', 'users.id')
      .where('orders.status', 'completed')
      .where('orders.total', '>', 100)
      .orderBy('orders.total', 'desc')
      .limit(10)
      .offset(0)

    const { sql, params } = qb.toSQL()
    expect(sql).toBe(
      'SELECT "orders"."id", "users"."name", "orders"."total" FROM "orders" ' +
      'INNER JOIN "users" ON "orders"."user_id" = "users"."id" ' +
      'WHERE "orders"."status" = ? AND "orders"."total" > ? ' +
      'ORDER BY "orders"."total" DESC ' +
      'LIMIT 10 OFFSET 0'
    )
    expect(params).toEqual(['completed', 100])
  })

  test('no user input ever appears unparameterized in SQL', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    const malicious = "'; DROP TABLE users; --"
    qb.where('name', malicious)
    const { sql, params } = qb.toSQL()

    // The malicious string should ONLY be in params, never in sql
    expect(sql).not.toContain(malicious)
    expect(sql).not.toContain('DROP')
    expect(params).toContain(malicious)
  })

  test('toQuery debug method does basic interpolation', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('id', 1).limit(10)
    const query = qb.toQuery()
    expect(query).toContain('"id" = 1')
    expect(query).toContain('LIMIT 10')
  })
})

// ═══════════════════════════════════════════════════════════
// toQuery — quote escaping
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder toQuery — SQL quote escaping', () => {
  test('single quotes in values are escaped', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('name', "O'Brien")
    const query = qb.toQuery()
    expect(query).toContain("'O''Brien'")
    expect(query).not.toContain("O'Brien'")
  })

  test('SQL injection in value is escaped in toQuery', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('name', "admin'; DROP TABLE users--")
    const query = qb.toQuery()
    expect(query).toContain("'admin''; DROP TABLE users--'")
  })

  test('multiple quoted values are all escaped', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('first', "O'Malley").where('last', "D'Arcy")
    const query = qb.toQuery()
    expect(query).toContain("O''Malley")
    expect(query).toContain("D''Arcy")
  })

  test('numeric values are not quoted', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('age', 25)
    const query = qb.toQuery()
    expect(query).toContain('= 25')
    expect(query).not.toContain("'25'")
  })

  test('boolean values are not quoted', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('active', true)
    const query = qb.toQuery()
    expect(query).toContain('= true')
  })
})

// ═══════════════════════════════════════════════════════════
// whereRaw / havingRaw — deliberate escape hatch
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder whereRaw/havingRaw — parameterized escape hatch', () => {
  test('whereRaw with params is parameterized', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereRaw('LENGTH(name) > ?', [5])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('LENGTH(name) > ?')
    expect(params).toEqual([5])
  })

  test('whereRaw with multiple params', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereRaw('age BETWEEN ? AND ?', [18, 65])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('age BETWEEN ? AND ?')
    expect(params).toEqual([18, 65])
  })

  test('whereRaw with no params', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereRaw('active = 1')
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('active = 1')
    expect(params).toEqual([])
  })

  test('havingRaw with params', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.groupBy('user_id').havingRaw('COUNT(*) > ?', [5])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('COUNT(*) > ?')
    expect(params).toEqual([5])
  })

  test('whereRaw chained with safe where', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('active', true).whereRaw('LENGTH(name) > ?', [3])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('"active" = ?')
    expect(sql).toContain('LENGTH(name) > ?')
    expect(params).toEqual([true, 3])
  })
})

// ═══════════════════════════════════════════════════════════
// forPage — validation
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder forPage — validation', () => {
  test('page 1 produces offset 0', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.forPage(1, 20)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 20')
    expect(sql).toContain('OFFSET 0')
  })

  test('page 3 with perPage 10 produces offset 20', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.forPage(3, 10)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 20')
  })

  test('default perPage is 20', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.forPage(1)
    const { sql } = qb.toSQL()
    expect(sql).toContain('LIMIT 20')
  })
})

// ═══════════════════════════════════════════════════════════
// DELETE — injection prevention
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder DELETE — injection prevention', () => {
  test('delete with safe where', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('id', 1)
    await qb.delete()
    expect(db.captured[0].sql).toBe('DELETE FROM "users" WHERE "id" = ?')
    expect(db.captured[0].params).toEqual([1])
  })

  test('delete without where deletes all', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await qb.delete()
    expect(db.captured[0].sql).toBe('DELETE FROM "users"')
  })

  test('delete with injection in where column throws', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    expect(() => qb.where('id; DROP TABLE users', 1)).toThrow('Invalid SQL identifier')
  })

  test('delete value is parameterized', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('name', "'; DROP TABLE users--")
    await qb.delete()
    expect(db.captured[0].sql).not.toContain('DROP')
    expect(db.captured[0].params).toEqual(["'; DROP TABLE users--"])
  })

  test('delete with multiple wheres', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('role', 'banned').where('active', false)
    await qb.delete()
    expect(db.captured[0].sql).toContain('"role" = ? AND "active" = ?')
  })
})

// ═══════════════════════════════════════════════════════════
// DECREMENT — uses increment internally
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder DECREMENT — column injection', () => {
  test('valid decrement', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'products')
    qb.where('id', 1)
    await qb.decrement('stock', 3)
    expect(db.captured[0].sql).toContain('"stock" = "stock" + ?')
    expect(db.captured[0].params[0]).toBe(-3) // negative for decrement
  })

  test('decrement rejects injection in column', async () => {
    const qb = new QueryBuilder(mockDb, 'products')
    await expect(qb.decrement('stock; DROP TABLE products')).rejects.toThrow('Invalid SQL identifier')
  })
})

// ═══════════════════════════════════════════════════════════
// AGGREGATES — additional tests
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder AGGREGATES — additional', () => {
  test('avg with valid column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.avg('price')
    expect(db.captured[0].sql).toContain('AVG("price")')
  })

  test('min with valid column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.min('price')
    expect(db.captured[0].sql).toContain('MIN("price")')
  })

  test('max with valid column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.max('price')
    expect(db.captured[0].sql).toContain('MAX("price")')
  })

  test('count with table.column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.count('orders.id')
    expect(db.captured[0].sql).toContain('COUNT("orders"."id")')
  })

  test('sum with table.column is quoted', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    await qb.sum('orders.total')
    expect(db.captured[0].sql).toContain('SUM("orders"."total")')
  })

  test('aggregate with where clause', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'orders')
    qb.where('status', 'completed')
    await qb.sum('total')
    expect(db.captured[0].sql).toContain('SUM("total")')
    expect(db.captured[0].sql).toContain('"status" = ?')
  })
})

// ═══════════════════════════════════════════════════════════
// InsertBuilder — additional onConflict/merge tests
// ═══════════════════════════════════════════════════════════

describe('InsertBuilder — onConflict/merge edge cases', () => {
  test('onConflict with array of columns validates each', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ name: 'test', email: 'test@x.com' })
      .onConflict(['id', 'email'])
      .ignore()
    // Valid columns should not throw
    const db = createCapturingDb()
    const ib2 = new InsertBuilder(db, 'users')
    ib2.values({ name: 'test', email: 'test@x.com' })
      .onConflict(['id', 'email'])
      .ignore()
    await ib2.exec()
    expect(db.captured[0].sql).toContain('ON CONFLICT')
    expect(db.captured[0].sql).toContain('DO NOTHING')
  })

  test('onConflict with injection in column rejects', async () => {
    const ib = new InsertBuilder(mockDb, 'users')
    ib.values({ name: 'test' })
      .onConflict('email; DROP TABLE users')
      .ignore()
    await expect(ib.exec()).rejects.toThrow('Invalid SQL identifier')
  })

  test('merge with specific columns validates', async () => {
    const db = createCapturingDb()
    const ib = new InsertBuilder(db, 'users')
    ib.values({ name: 'test', email: 'test@x.com' })
      .onConflict('email')
      .merge(['name'])
    await ib.exec()
    expect(db.captured[0].sql).toContain('DO UPDATE SET')
    expect(db.captured[0].sql).toContain('"name"')
  })

  test('merge without columns uses all value keys', async () => {
    const db = createCapturingDb()
    const ib = new InsertBuilder(db, 'users')
    ib.values({ name: 'test', email: 'test@x.com' })
      .onConflict('email')
      .merge()
    await ib.exec()
    expect(db.captured[0].sql).toContain('DO UPDATE SET')
  })

  test('multiInsert values are parameterized', async () => {
    const db = createCapturingDb()
    const ib = new InsertBuilder(db, 'users')
    ib.multiInsert([
      { name: "O'Malley", email: 'a@b.com' },
      { name: "D'Arcy", email: 'c@d.com' },
    ])
    await ib.exec()
    expect(db.captured[0].params).toContain("O'Malley")
    expect(db.captured[0].params).toContain("D'Arcy")
    expect(db.captured[0].sql).not.toContain("O'Malley")
  })
})

// ═══════════════════════════════════════════════════════════
// Unicode and edge case identifiers
// ═══════════════════════════════════════════════════════════

describe('validateIdentifier — unicode and edge cases', () => {
  test('rejects unicode characters', () => {
    expect(() => validateIdentifier('tablo_adı')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('表名')).toThrow('Invalid SQL identifier')
    expect(() => validateIdentifier('таблица')).toThrow('Invalid SQL identifier')
  })

  test('rejects emoji', () => {
    expect(() => validateIdentifier('🔥table')).toThrow('Invalid SQL identifier')
  })

  test('accepts long valid identifiers', () => {
    expect(() => validateIdentifier('a'.repeat(100))).not.toThrow()
  })

  test('rejects tab characters', () => {
    expect(() => validateIdentifier('col\tname')).toThrow('Invalid SQL identifier')
  })

  test('rejects newline in identifier', () => {
    expect(() => validateIdentifier('col\nname')).toThrow('Invalid SQL identifier')
  })

  test('rejects carriage return', () => {
    expect(() => validateIdentifier('col\rname')).toThrow('Invalid SQL identifier')
  })

  test('rejects vertical tab', () => {
    expect(() => validateIdentifier('col\x0Bname')).toThrow('Invalid SQL identifier')
  })

  test('accepts single underscore', () => {
    expect(() => validateIdentifier('_')).not.toThrow()
  })

  test('accepts underscore prefix with numbers', () => {
    expect(() => validateIdentifier('_123')).not.toThrow()
  })

  test('rejects only dots', () => {
    expect(() => validateIdentifier('.')).toThrow()
    expect(() => validateIdentifier('..')).toThrow()
  })

  test('rejects trailing dot (quoteIdentifier splits on dot)', () => {
    expect(() => quoteIdentifier('table.')).toThrow()
  })

  test('rejects leading dot (quoteIdentifier splits on dot)', () => {
    expect(() => quoteIdentifier('.column')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// validateOperator — comprehensive
// ═══════════════════════════════════════════════════════════

describe('validateOperator — comprehensive edge cases', () => {
  test('accepts IN and NOT IN', () => {
    expect(() => validateOperator('IN')).not.toThrow()
    expect(() => validateOperator('NOT IN')).not.toThrow()
    expect(() => validateOperator('in')).not.toThrow()
    expect(() => validateOperator('not in')).not.toThrow()
  })

  test('rejects BETWEEN (use whereBetween instead)', () => {
    expect(() => validateOperator('BETWEEN')).toThrow()
  })

  test('rejects EXISTS', () => {
    expect(() => validateOperator('EXISTS')).toThrow()
  })

  test('rejects ALL', () => {
    expect(() => validateOperator('ALL')).toThrow()
  })

  test('rejects ANY', () => {
    expect(() => validateOperator('ANY')).toThrow()
  })

  test('rejects HAVING', () => {
    expect(() => validateOperator('HAVING')).toThrow()
  })

  test('rejects WHERE', () => {
    expect(() => validateOperator('WHERE')).toThrow()
  })

  test('rejects semicolons', () => {
    expect(() => validateOperator(';')).toThrow()
    expect(() => validateOperator('=;')).toThrow()
  })

  test('rejects dashes (comment)', () => {
    expect(() => validateOperator('--')).toThrow()
  })

  test('trims whitespace before checking', () => {
    expect(() => validateOperator('  =  ')).not.toThrow()
    expect(() => validateOperator(' LIKE ')).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// Complex chained operations
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder — complex chained operations', () => {
  test('select + multiple joins + where + group + having + order + limit', () => {
    const qb = new QueryBuilder(mockDb, 'orders')
    qb.select('users.name', 'orders.status')
      .join('users', 'orders.user_id', '=', 'users.id')
      .leftJoin('payments', 'orders.id', '=', 'payments.order_id')
      .where('orders.created_at', '>', '2024-01-01')
      .whereNotNull('payments.id')
      .groupBy('users.name', 'orders.status')
      .having('total', '>', 100)
      .orderBy('users.name', 'asc')
      .limit(50)
      .offset(10)

    const { sql, params } = qb.toSQL()
    expect(sql).toContain('SELECT "users"."name", "orders"."status"')
    expect(sql).toContain('INNER JOIN "users"')
    expect(sql).toContain('LEFT JOIN "payments"')
    expect(sql).toContain('"orders"."created_at" > ?')
    expect(sql).toContain('"payments"."id" IS NOT NULL')
    expect(sql).toContain('GROUP BY "users"."name", "orders"."status"')
    expect(sql).toContain('HAVING "total" > ?')
    expect(sql).toContain('ORDER BY "users"."name" ASC')
    expect(sql).toContain('LIMIT 50 OFFSET 10')
    expect(params).toEqual(['2024-01-01', 100])
  })

  test('where + orWhere produces correct SQL', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.where('role', 'admin')
      .orWhere('role', 'moderator')
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('"role" = ?')
    expect(sql).toContain('OR "role" = ?')
    expect(params).toEqual(['admin', 'moderator'])
  })

  test('whereIn with parameterized values', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereIn('status', ['active', 'pending', 'trial'])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('"status" IN (?, ?, ?)')
    expect(params).toEqual(['active', 'pending', 'trial'])
  })

  test('whereNotIn with parameterized values', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereNotIn('id', [1, 2, 3])
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('"id" NOT IN (?, ?, ?)')
    expect(params).toEqual([1, 2, 3])
  })

  test('distinct with valid columns', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.distinct('email', 'role')
    const { sql } = qb.toSQL()
    expect(sql).toContain('SELECT DISTINCT')
    expect(sql).toContain('"email"')
    expect(sql).toContain('"role"')
  })

  test('whereLike with parameterized pattern', () => {
    const qb = new QueryBuilder(mockDb, 'users')
    qb.whereLike('email', '%@gmail.com')
    const { sql, params } = qb.toSQL()
    expect(sql).toContain('"email" LIKE ?')
    expect(params).toEqual(['%@gmail.com'])
  })

  test('first() sets limit to 1', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    qb.where('id', 1)
    await qb.first()
    expect(db.captured[0].sql).toContain('LIMIT 1')
  })

  test('firstOrFail throws on no result', async () => {
    const db = createCapturingDb()
    const qb = new QueryBuilder(db, 'users')
    await expect(qb.firstOrFail()).rejects.toThrow('No rows found')
  })
})

// ═══════════════════════════════════════════════════════════
// Real SQLite integration — prove SQL is actually safe
// ═══════════════════════════════════════════════════════════

describe('QueryBuilder — SQLite integration (proves safety)', () => {
  const { Database: BunSQLite } = require('bun:sqlite')
  const raw = new BunSQLite(':memory:', { create: true })
  const db = {
    async exec(sql: string) { raw.run(sql) },
    async run(sql: string, params: any[] = []) { raw.run(sql, ...params) },
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> { return raw.query(sql).all(...params) as T[] },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> { return (raw.query(sql).get(...params) as T) ?? null },
  }

  test('setup real SQLite database', async () => {
    await db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, age INTEGER)')
    await db.run('INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)', ['Ali', 'ali@test.com', 'admin', 30])
    await db.run('INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)', ['Veli', 'veli@test.com', 'user', 25])
    await db.run('INSERT INTO users (name, email, role, age) VALUES (?, ?, ?, ?)', ["O'Brien", 'ob@test.com', 'user', 40])
  })

  test('select with where returns correct data', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.where('role', 'admin').all()
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Ali')
  })

  test('select with whereLike works', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereLike('email', '%@test.com').all()
    expect(result.length).toBe(3)
  })

  test('malicious value in where does NOT cause injection', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.where('name', "' OR '1'='1").all()
    expect(result.length).toBe(0) // No match — injection failed
  })

  test('malicious value in whereLike does NOT cause injection', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereLike('name', "' OR '1'='1' --").all()
    expect(result.length).toBe(0) // pattern doesn't match anything
  })

  test('count works correctly', async () => {
    const qb = new QueryBuilder(db, 'users')
    const count = await qb.count()
    expect(count).toBe(3)
  })

  test('sum works correctly', async () => {
    const qb = new QueryBuilder(db, 'users')
    const total = await qb.sum('age')
    expect(total).toBe(95) // 30 + 25 + 40
  })

  test('orderBy works', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.orderBy('age', 'desc').all()
    expect(result[0].name).toBe("O'Brien")
    expect(result[2].name).toBe('Veli')
  })

  test('limit and offset work', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.orderBy('id', 'asc').limit(1).offset(1).all()
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Veli')
  })

  test('insert with quotes in value works safely', async () => {
    const qb = new QueryBuilder(db, 'users')
    await qb.insert({ name: "D'Arcy", email: 'darcy@test.com', role: 'user', age: 28 })
    const count = await new QueryBuilder(db, 'users').count()
    expect(count).toBe(4)
  })

  test('update with quotes in value works safely', async () => {
    const qb = new QueryBuilder(db, 'users')
    qb.where('name', "D'Arcy")
    await qb.update({ name: "D'Arcy-Smith" })
    const result = await new QueryBuilder(db, 'users').where('email', 'darcy@test.com').first()
    expect(result?.name).toBe("D'Arcy-Smith")
  })

  test('delete with parameterized value', async () => {
    const qb = new QueryBuilder(db, 'users')
    qb.where('email', 'darcy@test.com')
    await qb.delete()
    const count = await new QueryBuilder(db, 'users').count()
    expect(count).toBe(3)
  })

  test('whereBetween returns correct results', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereBetween('age', [26, 35]).all()
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Ali')
  })

  test('whereIn returns correct results', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereIn('role', ['admin', 'moderator']).all()
    expect(result.length).toBe(1)
  })

  test('whereNotIn returns correct results', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereNotIn('role', ['admin']).all()
    expect(result.length).toBe(2)
  })

  test('whereNull returns correct results', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereNull('email').all()
    expect(result.length).toBe(0) // all have emails
  })

  test('whereNotNull returns correct results', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.whereNotNull('email').all()
    expect(result.length).toBe(3)
  })

  test('increment works', async () => {
    const before = await new QueryBuilder(db, 'users').where('name', 'Ali').first()
    await new QueryBuilder(db, 'users').where('name', 'Ali').increment('age', 1)
    const after = await new QueryBuilder(db, 'users').where('name', 'Ali').first()
    expect(after.age).toBe(before.age + 1)
    // Reset
    await new QueryBuilder(db, 'users').where('name', 'Ali').increment('age', -1)
  })

  test('paginate returns correct structure', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.paginate(1, 2)
    expect(result.data.length).toBe(2)
    expect(result.meta.total).toBe(3)
    expect(result.meta.lastPage).toBe(2)
    expect(result.meta.hasMore).toBe(true)
  })

  test('paginate page 2', async () => {
    const qb = new QueryBuilder(db, 'users')
    const result = await qb.paginate(2, 2)
    expect(result.data.length).toBe(1)
    expect(result.meta.hasMore).toBe(false)
  })
})
