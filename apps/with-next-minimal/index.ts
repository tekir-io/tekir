import { tekir } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import { swagger } from '@tekir/swagger'
import type { Database } from '@tekir/db'

const { router, service, start } = await tekir({
  config: {
    app: { name: 'tekir + Next.js', port: 3000, env: 'development' },
    database: {
      default: 'sqlite',
      connections: { sqlite: { driver: 'sqlite', connection: { path: ':memory:' } } },
    },
  },
  providers: [DatabaseProvider],
  frontend: { type: 'next' },
})

const db = service<Database>('db')

await db.exec(`CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`)

await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', ['Hello World', 'First post from tekir + Next.js'])

router.get('/api/posts', async () => await db.query('SELECT * FROM posts'))

router.get('/api/posts/:id', async ({ params }) => {
  const post = await db.queryOne('SELECT * FROM posts WHERE id = ?', [params.id])
  if (!post) return new Response('{"error":"Not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  return post
})

router.post('/api/posts', async ({ body }) => {
  await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', [body.title, body.content || ''])
  return await db.queryOne('SELECT * FROM posts ORDER BY id DESC LIMIT 1')
})

router.delete('/api/posts/:id', async ({ params }) => {
  await db.run('DELETE FROM posts WHERE id = ?', [params.id])
  return { deleted: true }
})

swagger(router, { title: 'tekir + Next.js API', version: '1.0.0', path: '/docs' })

start(() => {
  console.log(`Server running at http://localhost:3000`)
})
