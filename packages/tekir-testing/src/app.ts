import { existsSync } from 'fs'
import { join } from 'path'
import { client } from './client'
export type { TestAppOptions } from './types'
import type { TestAppOptions } from './types'

/**
 * Boot a Tekir application in test mode and return everything you need to
 * make HTTP assertions: the live app, an ephemeral HTTP server bound to a
 * random port, a pre-configured API client, and a shutdown helper.
 *
 * Out of the box this also:
 * - **Sets `environment: 'test'`** so the framework picks the test config
 *   branch when one exists (`config.app.env === 'test'`).
 * - **Forces sqlite databases to `:memory:`** so tests are fully isolated
 *   from your dev SQLite file. Disable via `{ inMemoryDb: false }` if your
 *   app already targets a dedicated test file or another driver.
 * - **Auto-runs pending migrations** from `<appRoot>/database/migrations`
 *   when the directory exists and `@tekir/db` is installed. Disable via
 *   `{ migrate: false }` or force-on with `{ migrate: true }`.
 *
 * ## Resolving `appRoot`
 *
 * - No argument: defaults to `process.cwd()`. This works when `bun test` is
 *   run from the project root (the typical case).
 * - String argument: treated as the test file's `import.meta.dir`; the parent
 *   directory becomes the app root. Useful when tests live in a subdir and
 *   the runner is invoked from elsewhere.
 * - Options object: pass `appRoot` explicitly for full control plus any
 *   other knobs.
 *
 * @param dirOrOptions - Optional. Either the test file's directory (string,
 *   typically `import.meta.dir`) or a {@link TestAppOptions} object.
 * @returns An object with the booted app, server, base URL, a pre-configured
 *   `request` client and a `shutdown()` cleanup function.
 *
 * @example No-arg, runs from project root:
 * ```ts
 * import { createTestApp, test, expect } from '@tekir/testing'
 *
 * const { request } = await createTestApp()
 *
 * test('health check responds', async () => {
 *   const res = await request.get('/health')
 *   res.assertOk()
 *   expect(res.body).toHaveProperty('status', 'ok')
 * })
 * ```
 *
 * @example Tests in a nested folder:
 * ```ts
 * const { request } = await createTestApp(import.meta.dir)
 * ```
 *
 * @example Custom database, no auto-migrate:
 * ```ts
 * const { request, shutdown } = await createTestApp({
 *   appRoot: import.meta.dir,
 *   migrate: false,
 *   inMemoryDb: false,
 *   config: {
 *     database: { default: 'sqlite', connections: {
 *       sqlite: { driver: 'sqlite', connection: { path: './tests/db.sqlite' } }
 *     }},
 *   },
 * })
 * ```
 */
export async function createTestApp(dirOrOptions?: string | TestAppOptions) {
  const opts = typeof dirOrOptions === 'string'
    ? { appRoot: join(dirOrOptions, '..') }
    : dirOrOptions

  const appRoot = opts?.appRoot || process.cwd()
  const inMemoryDb = opts?.inMemoryDb !== false
  const { tekir } = await import('@tekir/core')

  // Resolve the in-memory sqlite override BEFORE booting tekir, so the
  // database provider opens `:memory:` from the start instead of touching
  // the dev sqlite file.
  let databaseOverride: unknown
  if (inMemoryDb && !opts?.config?.database) {
    databaseOverride = await buildInMemoryDatabaseConfig(appRoot)
  }

  // Auto-detect the conventional project layout when the user did not
  // override. Users on a non-standard layout pass exact paths; users who
  // explicitly want zero scanning pass `false`.
  const envFile = opts?.envFile === false
    ? undefined
    : (opts?.envFile ?? (existsSync(join(appRoot, 'env.ts')) ? 'env.ts' : undefined))
  const configDir = opts?.configDir === false
    ? undefined
    : (opts?.configDir ?? (existsSync(join(appRoot, 'config')) ? 'config' : undefined))
  const startDir = opts?.startDir === false
    ? undefined
    : (opts?.startDir ?? (existsSync(join(appRoot, 'start')) ? 'start' : undefined))

  const tekirApp = await tekir({
    appRoot,
    environment: 'test',
    envFile,
    configDir,
    startDir,
    config: {
      app: { env: 'test' },
      ...(databaseOverride ? { database: databaseOverride } : {}),
      ...opts?.config,
    },
  })

  tekirApp.server.configure({ port: opts?.port || 0 })
  await tekirApp.server.start()

  try {
    // Run migrations from <appRoot>/database/migrations if present.
    const migrationsDir = join(appRoot, 'database', 'migrations')
    const shouldMigrate = opts?.migrate ?? existsSync(migrationsDir)
    if (shouldMigrate) {
      await runMigrations(tekirApp, migrationsDir, opts?.migrate === true)
    }
  } catch (error) {
    // A migration failure happens after the listener has started. Always tear
    // the app down before surfacing it so a failed test bootstrap cannot leak a
    // port, timers, or database connections into the rest of the suite.
    await tekirApp.shutdown().catch(() => {})
    throw error
  }

  const addr = tekirApp.server.getServer()
  const baseUrl = `http://localhost:${addr.port}`

  return {
    app: tekirApp,
    server: tekirApp.server,
    baseUrl,
    request: client(baseUrl),
    shutdown: () => tekirApp.shutdown(),
  }
}

/**
 * Read the app's `config/database.ts` (if any) and return a clone with every
 * sqlite connection's path swapped to `:memory:`. Falls back to a stock
 * single-connection in-memory sqlite config when no database config exists.
 */
async function buildInMemoryDatabaseConfig(appRoot: string): Promise<unknown> {
  const fallback = {
    default: 'sqlite',
    connections: { sqlite: { driver: 'sqlite', connection: { path: ':memory:' } } },
  }
  for (const ext of ['ts', 'js', 'mjs']) {
    const candidate = join(appRoot, 'config', `database.${ext}`)
    if (!existsSync(candidate)) continue
    try {
      const mod = await import(candidate)
      const original = mod.default ?? mod
      // Shallow structural clone that only swaps the sqlite path. A
      // JSON.parse(JSON.stringify(...)) round-trip would silently drop
      // function/Date/undefined fields the user put in their config (e.g. a
      // dynamic `path`/`pool` factory), so preserve everything except the one
      // value we intentionally override.
      if (original?.connections) {
        const cloned: any = { ...original, connections: { ...original.connections } }
        for (const [name, conn] of Object.entries(original.connections) as [string, any][]) {
          if (conn?.driver === 'sqlite' && conn.connection) {
            cloned.connections[name] = {
              ...conn,
              connection: { ...conn.connection, path: ':memory:' },
            }
          }
        }
        return cloned
      }
    } catch (error) {
      throw new Error(`[@tekir/testing] Failed to load database config at ${candidate}`, { cause: error })
    }
  }
  return fallback
}

// String-indirect import so TS doesn't statically resolve `@tekir/db` (it is
// a soft, optional dependency — apps without it still get a working test
// harness, they just don't get auto-migrations).
const optionalImport = (name: string): Promise<any> => import(name)

async function runMigrations(tekirApp: any, migrationsDir: string, required: boolean) {
  if (!existsSync(migrationsDir)) return
  let MigrationRunner: any
  try {
    MigrationRunner = (await optionalImport('@tekir/db')).MigrationRunner
  } catch (error) {
    if (required) {
      throw new Error('[@tekir/testing] migrate:true requires @tekir/db to be installed', { cause: error })
    }
    return // auto-detected migrations remain optional when @tekir/db is absent
  }
  let db: any
  try { db = tekirApp.app.use('db') } catch { return }
  if (!db) return
  const runner = new MigrationRunner(db, migrationsDir)
  await runner.runUp()
}
