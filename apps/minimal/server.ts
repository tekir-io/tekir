import { tekir } from '@tekir/core'
import { cors } from '@tekir/cors'
import { DatabaseProvider } from '@tekir/db'
import { CronProvider, Cron } from '@tekir/cron'
import type { Database } from '@tekir/db'

const { router, service, ...rest } = await tekir({
  config: {
    app: { name: 'Minimal TODO', port: 3000, env: 'development' },
    database: {
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', connection: { path: ':memory:' } },
      },
    },
  },
  providers: [DatabaseProvider, CronProvider],
  middleware: [cors({ origin: true })],
})

const db = service<Database>('db')
const cron = service<Cron>('cron')

cron.add('clean-done-todos', '0 * * * *', async () => {
  await db.run('DELETE FROM todos WHERE done = 1')
})

await db.exec(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`)

router.get('/todos', async () => await db.query('SELECT * FROM todos'))

router.get('/todos/:id', async ({ params }) => await db.queryOne('SELECT * FROM todos WHERE id = ?', [params.id]) ?? { error: 'Not found' })

router.post('/todos', async ({ body }) => {
  await db.run('INSERT INTO todos (title) VALUES (?)', [body.title])
  return await db.queryOne('SELECT * FROM todos ORDER BY id DESC LIMIT 1')
})

router.put('/todos/:id', async ({ body, params }) => {
  await db.run('UPDATE todos SET done = ? WHERE id = ?', [body.done ? 1 : 0, params.id])
  return await db.queryOne('SELECT * FROM todos WHERE id = ?', [params.id])
})

router.delete('/todos/:id', async ({ params }) => {
  await db.run('DELETE FROM todos WHERE id = ?', [params.id])
  return { deleted: true }
})

router.get('/health', () => ({ status: 'ok', time: new Date().toISOString() }))

export const app = { router, service, ...rest }
