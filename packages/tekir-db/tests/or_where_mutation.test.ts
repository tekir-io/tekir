import { describe, expect, test } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import { QueryBuilder } from '../src/query_builder'

function fixture() {
  const raw = new BunSQLite(':memory:', { create: true })
  raw.run('CREATE TABLE items (id INTEGER PRIMARY KEY, state TEXT, score INTEGER)')
  raw.run("INSERT INTO items VALUES (1, 'old', 0), (2, 'old', 0), (3, 'old', 0)")
  const db = {
    async run(sql: string, params: any[] = []) { raw.run(sql, ...params) },
    async query<T>(sql: string, params: any[] = []) { return raw.query(sql).all(...params) as T[] },
    async queryOne<T>(sql: string, params: any[] = []) { return (raw.query(sql).get(...params) as T) ?? null },
  }
  return { raw, db }
}

describe('QueryBuilder mutation predicates', () => {
  test('orWhere-only update does not become a table-wide update', async () => {
    const { raw, db } = fixture()
    await new QueryBuilder(db, 'items').orWhere('id', 1).update({ state: 'changed' })
    expect(raw.query('SELECT id FROM items WHERE state = ?').all('changed')).toEqual([{ id: 1 }])
    raw.close()
  })

  test('update and increment honor combined where/orWhere predicates', async () => {
    const { raw, db } = fixture()
    await new QueryBuilder(db, 'items').where('id', 1).orWhere('id', 2).update({ state: 'changed' })
    await new QueryBuilder(db, 'items').where('id', 1).orWhere('id', 2).increment('score', 5)
    expect(raw.query('SELECT id, score FROM items WHERE state = ? ORDER BY id').all('changed')).toEqual([
      { id: 1, score: 5 }, { id: 2, score: 5 },
    ])
    raw.close()
  })

  test('delete honors orWhere instead of deleting every row', async () => {
    const { raw, db } = fixture()
    await new QueryBuilder(db, 'items').orWhere('id', 2).delete()
    expect(raw.query('SELECT id FROM items ORDER BY id').all()).toEqual([{ id: 1 }, { id: 3 }])
    raw.close()
  })
})
