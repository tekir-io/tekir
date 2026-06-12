import { tekir } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import { swagger } from '@tekir/swagger'
import { StaticProvider } from '@tekir/static'
import type { Database } from '@tekir/db'

const { router, service, start } = await tekir({
  config: {
    app: { name: 'tekir + Bun Fullstack', port: 3000, env: 'development' },
    database: {
      default: 'sqlite',
      connections: { sqlite: { driver: 'sqlite', connection: { path: ':memory:' } } },
    },
  },
  providers: [DatabaseProvider, StaticProvider],
  frontend: { type: 'bun' },
})

const db = service<Database>('db')

await db.exec(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0
)`)

await db.run('INSERT INTO todos (title) VALUES (?)', ['Learn tekir'])
await db.run('INSERT INTO todos (title) VALUES (?)', ['Build something cool'])

router.get('/api/todos', async () => await db.query('SELECT * FROM todos'))

router.post('/api/todos', async ({ body }) => {
  await db.run('INSERT INTO todos (title) VALUES (?)', [body.title])
  return await db.queryOne('SELECT * FROM todos ORDER BY id DESC LIMIT 1')
})

router.put('/api/todos/:id', async ({ body, params }) => {
  await db.run('UPDATE todos SET done = ? WHERE id = ?', [body.done ? 1 : 0, params.id])
  return await db.queryOne('SELECT * FROM todos WHERE id = ?', [params.id])
})

router.delete('/api/todos/:id', async ({ params }) => {
  await db.run('DELETE FROM todos WHERE id = ?', [params.id])
  return { deleted: true }
})

swagger(router, { title: 'tekir + Bun API', version: '1.0.0', path: '/docs' })

start(() => {
  console.log(`Server running at http://localhost:3000`)
})
