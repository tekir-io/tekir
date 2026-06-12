import type { TekirApp } from '@tekir/core'
import { db } from '#services'
import { User } from '~/models/user'
import { Post } from '~/models/post'

export default async function({ logger, config }: TekirApp) {
  if (config('database.connections.sqlite.connection.path') === ':memory:') {
    await db.exec(User.createSQL)
    await db.exec(Post.createSQL)
    await db.exec(`CREATE TABLE IF NOT EXISTS auth_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT DEFAULT '', hash TEXT NOT NULL UNIQUE, abilities TEXT DEFAULT '[]', created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT)`)

    if ((await User.count()) === 0) {
      await User.createMany([
        { name: 'Ali', email: 'ali@tekir.dev', role: 'admin', password: 'hashed' },
        { name: 'Veli', email: 'veli@tekir.dev', role: 'user', password: 'hashed' },
        { name: 'Ayse', email: 'ayse@tekir.dev', role: 'user', password: 'hashed' },
      ])
      await Post.createMany([
        { title: 'Getting Started with tekir', body: 'tekir is a Bun-native framework...', userId: 1, status: 'published' },
        { title: 'Building APIs', body: 'Learn how to build REST APIs...', userId: 1, status: 'published' },
        { title: 'Draft Post', body: 'This is still a draft...', userId: 2, status: 'draft' },
      ])
      logger.info('Database seeded')
    }
  }
}
