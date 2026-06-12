import { join } from 'path'
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'fs'

export interface Command {
  name: string
  description: string
  run(args: string[], ctx: any): Promise<void>
}

export const migrateCommand: Command = {
  name: 'migrate',
  description: 'Run pending database migrations',
  async run(_args, { tekir, appRoot }) {
    const db = tekir.app.use('db')
    const migrationsDir = join(appRoot, 'database', 'migrations')
    const { MigrationRunner } = await import('./migration/migration_runner')
    const runner = new MigrationRunner(db, migrationsDir)

    try {
      const { migrated } = await runner.runUp()
      if (migrated.length === 0) {
        tekir.logger.info('Nothing to migrate')
      } else {
        for (const name of migrated) tekir.logger.info(`  Migrated: ${name}`)
        tekir.logger.info(`${migrated.length} migration(s) applied`)
      }
    } catch (e: any) {
      tekir.logger.error(`Migration failed: ${e.message}`)
    }
  },
}

export const migrateGenerateCommand: Command = {
  name: 'migrate:generate',
  description: 'Generate migration files from schema diff',
  async run(args, { appRoot, tekir }) {
    try {
      const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api')
      const config = tekir.config
      const schema = config('database.schema')
      if (!schema) { tekir.logger.error('No schema found in config/database.ts'); return }

      const migrationsDir = join(appRoot, 'database', 'migrations')
      mkdirSync(migrationsDir, { recursive: true })

      const snapshotPath = join(migrationsDir, '_snapshot.json')
      let prev = null
      if (existsSync(snapshotPath)) {
        prev = JSON.parse(readFileSync(snapshotPath, 'utf8'))
      }

      const cur = await generateSQLiteDrizzleJson(schema)

      if (!prev) {
        writeFileSync(snapshotPath, JSON.stringify(cur, null, 2))
        tekir.logger.info('Initial snapshot created. Run again after schema changes to generate migrations.')
        return
      }

      const sqlStatements = await generateSQLiteMigration(prev, cur)
      if (!sqlStatements.length) {
        tekir.logger.info('No schema changes detected')
        return
      }

      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const name = args[0] || 'migration'
      const fileName = `${timestamp}_${name}.sql`
      const sql = sqlStatements.join(';\n') + ';'

      writeFileSync(join(migrationsDir, fileName), sql)
      writeFileSync(snapshotPath, JSON.stringify(cur, null, 2))
      tekir.logger.info(`Created: database/migrations/${fileName}`)
      tekir.logger.info(`SQL:\n${sql}`)
    } catch (e: any) {
      tekir.logger.error(`Generate failed: ${e.message}`)
    }
  },
}

export const migratePushCommand: Command = {
  name: 'migrate:push',
  description: 'Push schema directly to database (no migration files)',
  async run(_args, { tekir }) {
    try {
      const { pushSQLiteSchema } = await import('drizzle-kit/api')
      const config = tekir.config
      const schema = config('database.schema')
      const db = tekir.app.use('db')

      if (!schema) { tekir.logger.error('No schema found in config/database.ts'); return }

      const result = await pushSQLiteSchema(schema, db.drizzle)
      tekir.logger.info('Schema pushed to database')
      if (result?.statementsToExecute?.length) {
        for (const stmt of result.statementsToExecute) {
          tekir.logger.debug(`  ${stmt}`)
        }
      }
    } catch (e: any) {
      tekir.logger.error(`Push failed: ${e.message}`)
    }
  },
}

export const migrateDropCommand: Command = {
  name: 'migrate:drop',
  description: 'Drop all tables',
  async run(_args, { tekir }) {
    const db = tekir.app.use('db')
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    for (const t of tables) {
      await db.exec(`DROP TABLE IF EXISTS "${t.name}"`)
    }
    tekir.logger.info(`Dropped ${tables.length} tables`)
  },
}

export const migrateRollbackCommand: Command = {
  name: 'migrate:rollback',
  description: 'Rollback the last batch of migrations',
  async run(args, { tekir, appRoot }) {
    const db = tekir.app.use('db')
    const migrationsDir = join(appRoot, 'database', 'migrations')
    const { MigrationRunner } = await import('./migration/migration_runner')
    const runner = new MigrationRunner(db, migrationsDir)
    const step = args[0] ? parseInt(args[0], 10) : undefined

    try {
      const { rolledBack } = await runner.runDown(step ? { step } : undefined)
      if (rolledBack.length === 0) {
        tekir.logger.info('Nothing to rollback')
      } else {
        for (const name of rolledBack) tekir.logger.info(`  Rolled back: ${name}`)
        tekir.logger.info(`${rolledBack.length} migration(s) rolled back`)
      }
    } catch (e: any) {
      tekir.logger.error(`Rollback failed: ${e.message}`)
    }
  },
}

export const migrateStatusCommand: Command = {
  name: 'migrate:status',
  description: 'Show the status of all migrations',
  async run(_args, { tekir, appRoot }) {
    const db = tekir.app.use('db')
    const migrationsDir = join(appRoot, 'database', 'migrations')
    const { MigrationRunner } = await import('./migration/migration_runner')
    const runner = new MigrationRunner(db, migrationsDir)

    const statuses = await runner.status()
    if (statuses.length === 0) {
      tekir.logger.info('No migrations found')
      return
    }

    console.log('\n  Migration                              Status     Batch')
    console.log('  ' + '-'.repeat(58))
    for (const s of statuses) {
      const status = s.status === 'migrated' ? '\x1b[32mMigrated\x1b[0m' : '\x1b[33mPending \x1b[0m'
      const batch = s.batch !== null ? String(s.batch) : '-'
      console.log(`  ${s.name.padEnd(40)} ${status}  ${batch}`)
    }
    console.log()
  },
}

export const migrateFreshCommand: Command = {
  name: 'migrate:fresh',
  description: 'Drop all tables and re-run all migrations',
  async run(_args, { tekir, appRoot }) {
    const db = tekir.app.use('db')
    const migrationsDir = join(appRoot, 'database', 'migrations')
    const { MigrationRunner } = await import('./migration/migration_runner')
    const runner = new MigrationRunner(db, migrationsDir)

    try {
      tekir.logger.info('Dropping all tables...')
      const { migrated } = await runner.fresh()
      for (const name of migrated) tekir.logger.info(`  Migrated: ${name}`)
      tekir.logger.info(`Fresh migration complete (${migrated.length} migrations)`)
    } catch (e: any) {
      tekir.logger.error(`Fresh migration failed: ${e.message}`)
    }
  },
}

export const seedCommand: Command = {
  name: 'seed',
  description: 'Run database seeders',
  async run(_args, { appRoot, tekir }) {
    const seedersDir = join(appRoot, 'database', 'seeders')
    if (!existsSync(seedersDir)) {
      tekir.logger.warn('No seeders directory found')
      return
    }

    const files = readdirSync(seedersDir).filter(f => /\.(ts|js)$/.test(f)).sort()
    for (const file of files) {
      try {
        const mod = await import(join(seedersDir, file).replace(/\\/g, '/'))
        if (mod.run) await mod.run()
        tekir.logger.info(`Seeded: ${file}`)
      } catch (e: any) {
        tekir.logger.error(`Seeder ${file}: ${e.message}`)
      }
    }
  },
}

export const makeMigrationCommand: Command = {
  name: 'make:migration',
  description: 'Create a new migration file',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: make:migration <name>'); return }

    const dir = join(appRoot, 'database', 'migrations')
    mkdirSync(dir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const fileName = `${timestamp}_${name}.ts`
    const className = name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
    const tableName = name.replace(/^create_/, '').replace(/^add_.*_to_/, '')

    const content = `import { BaseMigration, type Schema } from '@tekir/db'

export default class ${className} extends BaseMigration {
  async up(schema: Schema) {
    schema.createTable('${tableName}', (table) => {
      table.id()
      table.timestamps()
    })
  }

  async down(schema: Schema) {
    schema.dropTable('${tableName}')
  }
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: database/migrations/${fileName}`)
  },
}

export const makeModelCommand: Command = {
  name: 'make:model',
  description: 'Create a new model',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: tekir make:model <Name>'); return }

    const dir = join(appRoot, 'app', 'models')
    mkdirSync(dir, { recursive: true })

    const fileName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + '.ts'
    const className = name.charAt(0).toUpperCase() + name.slice(1)
    const tableName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + 's'

    const content = `import { BaseModel, column } from '@tekir/db'

export class ${className} extends BaseModel {
  static table = '${tableName}'
  static schema = {
    id: column.id(),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
  }
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: app/models/${fileName}`)
  },
}

export const makeSeederCommand: Command = {
  name: 'make:seeder',
  description: 'Create a new seeder file',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: tekir make:seeder <name>'); return }

    const dir = join(appRoot, 'database', 'seeders')
    mkdirSync(dir, { recursive: true })

    const fileName = `${name}_seeder.ts`
    const modelName = name.charAt(0).toUpperCase() + name.slice(1)
    const content = `import { ${modelName} } from '~/models/${name}'

export async function run() {
  if ((await ${modelName}.count()) > 0) return

  await ${modelName}.createMany([
  ])
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: database/seeders/${fileName}`)
  },
}

export const dbCommands: Command[] = [
  migrateCommand,
  migrateRollbackCommand,
  migrateStatusCommand,
  migrateFreshCommand,
  migrateGenerateCommand,
  migratePushCommand,
  migrateDropCommand,
  seedCommand,
  makeMigrationCommand,
  makeModelCommand,
  makeSeederCommand,
]
