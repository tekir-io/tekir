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
  frontend: { type: 'next' },
})

const db = service<Database>('db')

await db.exec(`CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`)

// API routes — /api/* goes to tekir, everything else goes to Next.js
router.get('/api/posts', async () => await db.query('SELECT * FROM posts'))

router.get('/api/posts/:id', async ({ params }) => {
  return await db.queryOne('SELECT * FROM posts WHERE id = ?', [params.id])
})

router.post('/api/posts', async ({ body }) => {
  await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', [body.title, body.content || ''])
  return await db.queryOne('SELECT * FROM posts ORDER BY id DESC LIMIT 1')
})

router.delete('/api/posts/:id', async ({ params }) => {
  await db.run('DELETE FROM posts WHERE id = ?', [params.id])
  return { deleted: true }
})

swagger(router, { title: 'My App API', version: '1.0.0', path: '/docs' })

start(() => {
  console.log('Server running at http://localhost:3000')
})
