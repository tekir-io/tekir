import { tekir } from '@tekir/core'
import { cors } from '@tekir/cors'
import { swagger } from '@tekir/swagger'
import { DatabaseProvider } from '@tekir/db'
import type { Database } from '@tekir/db'

const { router, service, start } = await tekir({
  config: {
    app: { name: 'My App', port: 3000, env: 'development' },
    database: {
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', connection: { path: './database/app.sqlite' } },
      },
    },
  },
  providers: [DatabaseProvider],
  middleware: [cors({ origin: true })],
})

const db = service<Database>('db')

await db.exec(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`)

router.get('/todos', async () => {
  return await db.query('SELECT * FROM todos')
})

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

swagger(router, { title: 'My App', version: '1.0.0', path: '/docs' })

start(() => {
  console.log('Server running at http://localhost:3000')
})
