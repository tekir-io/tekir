import { test, expect, describe, beforeEach } from 'bun:test'
import { Database as BunSQLite } from 'bun:sqlite'
import { ColumnBuilder } from '../src/migration/column_builder'
import { TableBuilder } from '../src/migration/table_builder'
import { SqlCompiler, type Operation } from '../src/migration/sql_compiler'
import { Schema } from '../src/migration/schema'
import { MigrationRunner } from '../src/migration/migration_runner'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'


function createTestDb() {
  const raw = new BunSQLite(':memory:', { create: true })
  return {
    driver: 'sqlite',
    async exec(sql: string) { raw.run(sql) },
    async run(sql: string, params: any[] = []) { raw.run(sql, ...params) },
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> { return raw.query(sql).all(...params) as T[] },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> { return (raw.query(sql).get(...params) as T) ?? null },
  }
}

const tmpDir = join(process.cwd(), '__migration_test_tmp__')

function cleanTmp() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
}

function writeMigration(name: string, content: string) {
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(join(tmpDir, name), content)
}

// ColumnBuilder

describe('ColumnBuilder', () => {
  test('creates basic column definition', () => {
    const col = new ColumnBuilder('name', 'string', 255)
    const def = col.toDefinition()
    expect(def.name).toBe('name')
    expect(def.type).toBe('string')
    expect(def.length).toBe(255)
    expect(def.nullable).toBe(false)
  })

  test('nullable()', () => {
    expect(new ColumnBuilder('x', 'text').nullable().toDefinition().nullable).toBe(true)
  })

  test('notNullable()', () => {
    expect(new ColumnBuilder('x', 'text').nullable().notNullable().toDefinition().nullable).toBe(false)
  })

  test('unique()', () => {
    expect(new ColumnBuilder('x', 'string').unique().toDefinition().unique).toBe(true)
  })

  test('primary()', () => {
    expect(new ColumnBuilder('x', 'integer').primary().toDefinition().primary).toBe(true)
  })

  test('autoIncrement()', () => {
    expect(new ColumnBuilder('x', 'integer').autoIncrement().toDefinition().autoIncrement).toBe(true)
  })

  test('defaultTo()', () => {
    expect(new ColumnBuilder('x', 'string').defaultTo('hello').toDefinition().defaultValue).toBe('hello')
  })

  test('references()', () => {
    const def = new ColumnBuilder('user_id', 'integer').references('users', 'id').toDefinition()
    expect(def.references).toEqual({ table: 'users', column: 'id' })
  })

  test('onDelete()', () => {
    const def = new ColumnBuilder('user_id', 'integer').references('users').onDelete('CASCADE').toDefinition()
    expect(def.references!.onDelete).toBe('CASCADE')
  })

  test('onUpdate()', () => {
    const def = new ColumnBuilder('user_id', 'integer').references('users').onUpdate('SET NULL').toDefinition()
    expect(def.references!.onUpdate).toBe('SET NULL')
  })

  test('index()', () => {
    expect(new ColumnBuilder('x', 'string').index().toDefinition().index).toBe(true)
  })

  test('chaining multiple modifiers', () => {
    const def = new ColumnBuilder('email', 'string', 255)
      .notNullable()
      .unique()
      .index()
      .toDefinition()
    expect(def.nullable).toBe(false)
    expect(def.unique).toBe(true)
    expect(def.index).toBe(true)
  })
})

// TableBuilder

describe('TableBuilder', () => {
  test('id() creates auto-increment primary key', () => {
    const t = new TableBuilder()
    t.id()
    const def = t.columns[0].toDefinition()
    expect(def.type).toBe('id')
    expect(def.primary).toBe(true)
    expect(def.autoIncrement).toBe(true)
  })

  test('string() creates varchar column', () => {
    const t = new TableBuilder()
    t.string('name', 100)
    expect(t.columns[0].toDefinition().type).toBe('string')
    expect(t.columns[0].toDefinition().length).toBe(100)
  })

  test('text() creates text column', () => {
    const t = new TableBuilder()
    t.text('body')
    expect(t.columns[0].toDefinition().type).toBe('text')
  })

  test('integer()', () => {
    const t = new TableBuilder()
    t.integer('age')
    expect(t.columns[0].toDefinition().type).toBe('integer')
  })

  test('real()', () => {
    const t = new TableBuilder()
    t.real('price')
    expect(t.columns[0].toDefinition().type).toBe('real')
  })

  test('boolean()', () => {
    const t = new TableBuilder()
    t.boolean('active')
    expect(t.columns[0].toDefinition().type).toBe('boolean')
  })

  test('timestamp()', () => {
    const t = new TableBuilder()
    t.timestamp('created_at')
    expect(t.columns[0].toDefinition().type).toBe('timestamp')
  })

  test('json()', () => {
    const t = new TableBuilder()
    t.json('metadata')
    expect(t.columns[0].toDefinition().type).toBe('json')
  })

  test('blob()', () => {
    const t = new TableBuilder()
    t.blob('data')
    expect(t.columns[0].toDefinition().type).toBe('blob')
  })

  test('timestamps() adds created_at and updated_at', () => {
    const t = new TableBuilder()
    t.timestamps()
    expect(t.columns).toHaveLength(2)
    expect(t.columns[0].toDefinition().name).toBe('created_at')
    expect(t.columns[1].toDefinition().name).toBe('updated_at')
    expect(t.columns[1].toDefinition().nullable).toBe(true)
  })

  test('softDeletes() adds deleted_at', () => {
    const t = new TableBuilder()
    t.softDeletes()
    expect(t.columns).toHaveLength(1)
    expect(t.columns[0].toDefinition().name).toBe('deleted_at')
    expect(t.columns[0].toDefinition().nullable).toBe(true)
  })

  test('dropColumn()', () => {
    const t = new TableBuilder()
    t.dropColumn('old_field')
    expect(t.dropColumns).toEqual(['old_field'])
  })

  test('renameColumn()', () => {
    const t = new TableBuilder()
    t.renameColumn('old', 'new')
    expect(t.renames).toEqual([{ from: 'old', to: 'new' }])
  })

  test('columns return ColumnBuilder for chaining', () => {
    const t = new TableBuilder()
    const col = t.string('email').unique().notNullable()
    expect(col).toBeInstanceOf(ColumnBuilder)
    expect(col.toDefinition().unique).toBe(true)
  })
})

// SqlCompiler

describe('SqlCompiler — SQLite', () => {
  const compiler = new SqlCompiler('sqlite')

  test('compiles CREATE TABLE', () => {
    const builder = new TableBuilder()
    builder.id()
    builder.string('title').notNullable()
    builder.text('body').nullable()
    builder.timestamps()

    const ops: Operation[] = [{ type: 'createTable', tableName: 'posts', builder }]
    const sql = compiler.compile(ops)
    expect(sql).toHaveLength(1)
    expect(sql[0]).toContain('CREATE TABLE "posts"')
    expect(sql[0]).toContain('INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(sql[0]).toContain('"title" TEXT NOT NULL')
    expect(sql[0]).toContain('"body" TEXT')
  })

  test('compiles CREATE TABLE IF NOT EXISTS', () => {
    const builder = new TableBuilder()
    builder.id()
    const ops: Operation[] = [{ type: 'createTableIfNotExists', tableName: 'test', builder }]
    const sql = compiler.compile(ops)
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS')
  })

  test('compiles DROP TABLE', () => {
    const sql = compiler.compile([{ type: 'dropTable', tableName: 'posts' }])
    expect(sql[0]).toBe('DROP TABLE "posts"')
  })

  test('compiles DROP TABLE IF EXISTS', () => {
    const sql = compiler.compile([{ type: 'dropTableIfExists', tableName: 'posts' }])
    expect(sql[0]).toBe('DROP TABLE IF EXISTS "posts"')
  })

  test('compiles RENAME TABLE', () => {
    const sql = compiler.compile([{ type: 'renameTable', tableName: 'old', newName: 'new' }])
    expect(sql[0]).toBe('ALTER TABLE "old" RENAME TO "new"')
  })

  test('compiles raw SQL', () => {
    const sql = compiler.compile([{ type: 'raw', tableName: '', sql: 'PRAGMA journal_mode = WAL' }])
    expect(sql[0]).toBe('PRAGMA journal_mode = WAL')
  })

  test('compiles ALTER TABLE ADD COLUMN', () => {
    const builder = new TableBuilder()
    builder.string('slug').unique()
    const sql = compiler.compile([{ type: 'alterTable', tableName: 'posts', builder }])
    expect(sql[0]).toContain('ALTER TABLE "posts" ADD COLUMN "slug" TEXT')
    expect(sql[0]).toContain('UNIQUE')
  })

  test('compiles ALTER TABLE DROP COLUMN', () => {
    const builder = new TableBuilder()
    builder.dropColumn('old')
    const sql = compiler.compile([{ type: 'alterTable', tableName: 'posts', builder }])
    expect(sql[0]).toContain('DROP COLUMN "old"')
  })

  test('compiles ALTER TABLE RENAME COLUMN', () => {
    const builder = new TableBuilder()
    builder.renameColumn('old', 'new')
    const sql = compiler.compile([{ type: 'alterTable', tableName: 'posts', builder }])
    expect(sql[0]).toContain('RENAME COLUMN "old" TO "new"')
  })

  test('compiles FOREIGN KEY', () => {
    const builder = new TableBuilder()
    builder.id()
    builder.integer('user_id').references('users', 'id').onDelete('CASCADE')
    const sql = compiler.compile([{ type: 'createTable', tableName: 'posts', builder }])
    expect(sql[0]).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE')
  })

  test('compiles DEFAULT values', () => {
    const builder = new TableBuilder()
    builder.string('status').defaultTo('draft')
    builder.integer('count').defaultTo(0)
    builder.boolean('active').defaultTo(true)
    const sql = compiler.compile([{ type: 'createTable', tableName: 'test', builder }])
    expect(sql[0]).toContain("DEFAULT 'draft'")
    expect(sql[0]).toContain('DEFAULT 0')
    expect(sql[0]).toContain('DEFAULT 1')
  })

  test('compiles timestamp DEFAULT now', () => {
    const builder = new TableBuilder()
    builder.timestamp('created_at').defaultTo('now')
    const sql = compiler.compile([{ type: 'createTable', tableName: 'test', builder }])
    expect(sql[0]).toContain("DEFAULT (datetime('now'))")
  })
})

describe('SqlCompiler — PostgreSQL', () => {
  const compiler = new SqlCompiler('postgres')

  test('uses SERIAL for id', () => {
    const builder = new TableBuilder()
    builder.id()
    const sql = compiler.compile([{ type: 'createTable', tableName: 'posts', builder }])
    expect(sql[0]).toContain('SERIAL PRIMARY KEY')
  })

  test('uses VARCHAR with length', () => {
    const builder = new TableBuilder()
    builder.string('name', 100)
    const sql = compiler.compile([{ type: 'createTable', tableName: 'test', builder }])
    expect(sql[0]).toContain('VARCHAR(100)')
  })

  test('uses NOW() for timestamp default', () => {
    const builder = new TableBuilder()
    builder.timestamp('created_at').defaultTo('now')
    const sql = compiler.compile([{ type: 'createTable', tableName: 'test', builder }])
    expect(sql[0]).toContain('DEFAULT NOW()')
  })

  test('uses JSONB for json type', () => {
    const builder = new TableBuilder()
    builder.json('data')
    const sql = compiler.compile([{ type: 'createTable', tableName: 'test', builder }])
    expect(sql[0]).toContain('JSONB')
  })
})

// Schema

describe('Schema', () => {
  test('createTable + execute creates a real table', async () => {
    const db = createTestDb()
    const schema = new Schema(db, 'sqlite')
    schema.createTable('test_schema', (table) => {
      table.id()
      table.string('name').notNullable()
    })
    await schema.execute()

    const rows = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='test_schema'")
    expect(rows).toHaveLength(1)
  })

  test('dropTable removes table', async () => {
    const db = createTestDb()
    await db.exec('CREATE TABLE to_drop (id INTEGER)')
    const schema = new Schema(db, 'sqlite')
    schema.dropTable('to_drop')
    await schema.execute()

    const rows = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='to_drop'")
    expect(rows).toHaveLength(0)
  })

  test('alterTable adds column', async () => {
    const db = createTestDb()
    await db.exec('CREATE TABLE alter_test (id INTEGER PRIMARY KEY)')
    const schema = new Schema(db, 'sqlite')
    schema.alterTable('alter_test', (table) => {
      table.string('name')
    })
    await schema.execute()

    await db.run('INSERT INTO alter_test (id, name) VALUES (?, ?)', [1, 'test'])
    const row = await db.queryOne('SELECT name FROM alter_test WHERE id = ?', [1])
    expect(row).toHaveProperty('name', 'test')
  })

  test('raw executes arbitrary SQL', async () => {
    const db = createTestDb()
    const schema = new Schema(db, 'sqlite')
    schema.raw('CREATE TABLE raw_test (id INTEGER)')
    await schema.execute()

    const rows = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_test'")
    expect(rows).toHaveLength(1)
  })

  test('multiple operations in sequence', async () => {
    const db = createTestDb()
    const schema = new Schema(db, 'sqlite')
    schema.createTable('multi_a', (t) => { t.id(); t.string('name') })
    schema.createTable('multi_b', (t) => { t.id(); t.integer('a_id').references('multi_a') })
    await schema.execute()

    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'multi_%'")
    expect(tables).toHaveLength(2)
  })
})

// MigrationRunner

describe('MigrationRunner', () => {
  beforeEach(() => cleanTmp())

  test('ensureTrackingTable creates _migrations', async () => {
    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)
    await runner.ensureTrackingTable()

    const rows = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    expect(rows).toHaveLength(1)
  })

  test('discoverMigrations finds .ts files sorted', () => {
    writeMigration('20240102_second.ts', '')
    writeMigration('20240101_first.ts', '')
    writeMigration('_snapshot.json', '{}')

    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)
    const files = runner.discoverMigrations()

    expect(files).toHaveLength(2)
    expect(files[0].name).toBe('20240101_first')
    expect(files[1].name).toBe('20240102_second')
  })

  test('runUp executes pending migrations', async () => {
    writeMigration('20240101_create_users.ts', `
      import { BaseMigration } from '${join(__dirname, '..', 'src', 'migration', 'base_migration').replace(/\\/g, '/')}'

      export default class CreateUsers extends BaseMigration {
        async up(schema) {
          schema.createTable('users', (t) => {
            t.id()
            t.string('name').notNullable()
            t.string('email').unique()
            t.timestamps()
          })
        }
        async down(schema) {
          schema.dropTable('users')
        }
      }
    `)

    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)
    const { migrated } = await runner.runUp()

    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toBe('20240101_create_users')

    // Table should exist
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    expect(tables).toHaveLength(1)

    // Tracking row should exist
    const tracking = await db.query('SELECT * FROM _migrations')
    expect(tracking).toHaveLength(1)
    expect(tracking[0].name).toBe('20240101_create_users')
    expect(tracking[0].batch).toBe(1)
  })

  test('runUp skips already-executed migrations', async () => {
    writeMigration('20240101_create_users.ts', `
      import { BaseMigration } from '${join(__dirname, '..', 'src', 'migration', 'base_migration').replace(/\\/g, '/')}'
      export default class extends BaseMigration {
        async up(schema) { schema.createTable('users', (t) => { t.id() }) }
        async down(schema) { schema.dropTable('users') }
      }
    `)

    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)

    await runner.runUp()
    const second = await runner.runUp()
    expect(second.migrated).toHaveLength(0)
  })

  test('runDown rolls back last batch', async () => {
    writeMigration('20240101_create_users.ts', `
      import { BaseMigration } from '${join(__dirname, '..', 'src', 'migration', 'base_migration').replace(/\\/g, '/')}'
      export default class extends BaseMigration {
        async up(schema) { schema.createTable('users', (t) => { t.id() }) }
        async down(schema) { schema.dropTable('users') }
      }
    `)

    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)
    await runner.runUp()

    const { rolledBack } = await runner.runDown()
    expect(rolledBack).toHaveLength(1)

    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    expect(tables).toHaveLength(0)

    const tracking = await db.query('SELECT * FROM _migrations')
    expect(tracking).toHaveLength(0)
  })

  test('status() returns correct statuses', async () => {
    writeMigration('20240101_a.ts', `
      import { BaseMigration } from '${join(__dirname, '..', 'src', 'migration', 'base_migration').replace(/\\/g, '/')}'
      export default class extends BaseMigration {
        async up(schema) { schema.raw('SELECT 1') }
        async down(schema) { schema.raw('SELECT 1') }
      }
    `)
    writeMigration('20240102_b.ts', `
      import { BaseMigration } from '${join(__dirname, '..', 'src', 'migration', 'base_migration').replace(/\\/g, '/')}'
      export default class extends BaseMigration {
        async up(schema) { schema.raw('SELECT 1') }
        async down(schema) { schema.raw('SELECT 1') }
      }
    `)

    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)

    // Run only first
    await runner.ensureTrackingTable()
    await db.run("INSERT INTO _migrations (name, batch) VALUES (?, ?)", ['20240101_a', 1])

    const statuses = await runner.status()
    expect(statuses).toHaveLength(2)
    expect(statuses[0].status).toBe('migrated')
    expect(statuses[0].batch).toBe(1)
    expect(statuses[1].status).toBe('pending')
    expect(statuses[1].batch).toBeNull()
  })

  test('getLastBatch increments', async () => {
    const db = createTestDb()
    const runner = new MigrationRunner(db, tmpDir)
    await runner.ensureTrackingTable()

    expect(await runner.getLastBatch()).toBe(0)
    await db.run('INSERT INTO _migrations (name, batch) VALUES (?, ?)', ['a', 1])
    expect(await runner.getLastBatch()).toBe(1)
    await db.run('INSERT INTO _migrations (name, batch) VALUES (?, ?)', ['b', 2])
    expect(await runner.getLastBatch()).toBe(2)
  })

  test('fresh() drops all tables and re-runs', async () => {
    const db = createTestDb()
    await db.exec('CREATE TABLE fresh_test (id INTEGER)')
    await db.run("INSERT INTO fresh_test (id) VALUES (?)", [1])

    // Verify table has data
    const before = await db.query('SELECT * FROM fresh_test')
    expect(before).toHaveLength(1)

    const runner = new MigrationRunner(db, tmpDir)
    // No migration files in tmpDir, so fresh just drops everything
    await runner.fresh()

    // fresh_test should be gone
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fresh_test'")
    expect(tables).toHaveLength(0)
  })
})

// Cleanup
afterAll(() => cleanTmp())

import { afterAll } from 'bun:test'
