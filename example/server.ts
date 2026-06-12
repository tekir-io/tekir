/**
 * Tekir contributor playground.
 *
 * Defines the app + routes inline. `index.ts` calls `app.start()` for
 * `bun run dev`. Tests `import { app }` and boot it on a random port.
 *
 * Database path swaps to `:memory:` automatically when running under
 * `bun test` (Bun sets `NODE_ENV=test` for test runs), so tests don't
 * touch your dev sqlite file.
 */
import { tekir } from '@tekir/core'
import { cors } from '@tekir/cors'
import { swagger } from '@tekir/swagger'
import { DatabaseProvider } from '@tekir/db'
import type { Database } from '@tekir/db'
import type { HttpContext } from '@tekir/core'

const sqlitePath = process.env.NODE_ENV === 'test' ? ':memory:' : './data/example.sqlite'

export const { router, service, server } = await tekir({
  config: {
    app: { name: 'tekir-example', port: 5001, env: 'development' },
    database: {
      default: 'sqlite',
      connections: { sqlite: { driver: 'sqlite', connection: { path: sqlitePath } } },
    },
  },
  providers: [DatabaseProvider],
  middleware: [cors({ origin: true })],
})

const db = service<Database>('db')

await db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL
)`)

// Seed only when the table is empty so re-runs against a persistent file
// (dev mode) don't pile duplicate rows.
const userCount = (await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users'))?.n ?? 0
if (userCount === 0) {
  await db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['kubilay', 'kubilay@tekir.io'])
}

router.get('/', () => ({
  message: 'tekir example app',
  hint: 'try /users, /users/1, /echo (POST), /docs',
}))

router.get('/health', () => ({ status: 'ok', uptime: process.uptime() }))

router.get('/users', async () => await db.query('SELECT * FROM users'))

router.get('/users/:id', async ({ params }: HttpContext) => {
  const user = await db.queryOne('SELECT * FROM users WHERE id = ?', [params.id])
  return user ?? { error: 'not found' }
})

router.post('/users', async ({ body }: HttpContext) => {
  const name = String(body.name ?? '')
  const email = String(body.email ?? '')
  if (!name || !email) return { error: 'name and email required' }
  await db.run('INSERT INTO users (name, email) VALUES (?, ?)', [name, email])
  return await db.queryOne('SELECT * FROM users ORDER BY id DESC LIMIT 1')
})

router.post('/echo', ({ body }: HttpContext) => ({ received: body }))

swagger(router, { title: 'tekir example', version: '1.0.0', path: '/docs' })
