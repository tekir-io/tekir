import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { Schema } from './schema'
import type { BaseMigration } from './base_migration'

export interface MigrationFile {
  name: string
  path: string
}

export interface MigrationStatus {
  name: string
  status: 'pending' | 'migrated'
  batch: number | null
}

export class MigrationRunner {
  private db: any
  private migrationsDir: string

  constructor(db: any, migrationsDir: string) {
    this.db = db
    this.migrationsDir = migrationsDir
  }

  async ensureTrackingTable(): Promise<void> {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      batch INTEGER NOT NULL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }

  discoverMigrations(): MigrationFile[] {
    if (!existsSync(this.migrationsDir)) return []
    return readdirSync(this.migrationsDir)
      .filter(f => /\.(ts|js)$/.test(f) && !f.startsWith('_'))
      .sort()
      .map(f => ({
        name: f.replace(/\.(ts|js)$/, ''),
        path: join(this.migrationsDir, f).replace(/\\/g, '/'),
      }))
  }

  async getExecuted(): Promise<string[]> {
    const rows = await this.db.query('SELECT name FROM _migrations ORDER BY id')
    return rows.map((r: any) => r.name)
  }

  async getPending(): Promise<MigrationFile[]> {
    await this.ensureTrackingTable()
    const executed = new Set(await this.getExecuted())
    return this.discoverMigrations().filter(f => !executed.has(f.name))
  }

  async getLastBatch(): Promise<number> {
    const row = await this.db.queryOne('SELECT MAX(batch) as batch FROM _migrations')
    return row?.batch ?? 0
  }

  async runUp(): Promise<{ migrated: string[] }> {
    await this.ensureTrackingTable()
    const pending = await this.getPending()
    if (pending.length === 0) return { migrated: [] }

    const batch = (await this.getLastBatch()) + 1
    const migrated: string[] = []

    for (const file of pending) {
      await this.executeMigration(file, 'up', batch)
      migrated.push(file.name)
    }

    return { migrated }
  }

  async runDown(options?: { step?: number }): Promise<{ rolledBack: string[] }> {
    await this.ensureTrackingTable()
    const step = options?.step ?? 0
    const lastBatch = await this.getLastBatch()
    if (lastBatch === 0) return { rolledBack: [] }

    const targetBatch = step > 0 ? Math.max(1, lastBatch - step + 1) : lastBatch

    const rows = await this.db.query(
      'SELECT name FROM _migrations WHERE batch >= ? ORDER BY id DESC',
      [targetBatch]
    )

    const allFiles = this.discoverMigrations()
    const fileMap = new Map(allFiles.map(f => [f.name, f]))
    const rolledBack: string[] = []

    for (const row of rows) {
      const file = fileMap.get(row.name)
      if (!file) continue
      await this.executeMigration(file, 'down', 0)
      rolledBack.push(file.name)
    }

    return { rolledBack }
  }

  async status(): Promise<MigrationStatus[]> {
    await this.ensureTrackingTable()
    const executed = await this.db.query('SELECT name, batch FROM _migrations ORDER BY id')
    const executedMap = new Map<string, number>(executed.map((r: any) => [r.name, r.batch]))
    const allFiles = this.discoverMigrations()

    return allFiles.map(f => ({
      name: f.name,
      status: executedMap.has(f.name) ? 'migrated' as const : 'pending' as const,
      batch: executedMap.get(f.name) ?? null,
    }))
  }

  async fresh(): Promise<{ migrated: string[] }> {
    const tables = await this.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    for (const t of tables) {
      await this.db.exec(`DROP TABLE IF EXISTS "${t.name}"`)
    }
    return this.runUp()
  }

  private async executeMigration(file: MigrationFile, direction: 'up' | 'down', batch: number): Promise<void> {
    const mod = await import(file.path)
    const MigrationClass = mod.default
    const migration: BaseMigration = new MigrationClass()

    const schema = new Schema(this.db, this.db.driver || 'sqlite')
    await migration[direction](schema)
    await schema.execute()

    if (direction === 'up') {
      await this.db.run(
        'INSERT INTO _migrations (name, batch) VALUES (?, ?)',
        [file.name, batch]
      )
    } else {
      await this.db.run('DELETE FROM _migrations WHERE name = ?', [file.name])
    }
  }
}
