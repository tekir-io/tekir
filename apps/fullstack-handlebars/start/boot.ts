import type { TekirApp } from '@tekir/core'
import { db, hash } from '#services'

export default async function({ logger }: TekirApp) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const count = await db.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM users')
  if (count && count.c === 0) {
    const pw = await hash.make('secret')
    await db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['Alice', 'alice@tekir.dev', pw, 'admin'])
    await db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['Bob', 'bob@tekir.dev', pw, 'user'])
    await db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['Charlie', 'charlie@tekir.dev', pw, 'user'])

    await db.run("INSERT INTO posts (title, body, status, user_id) VALUES (?, ?, ?, ?)", ['Getting Started with tekir', 'tekir is a Bun-native web framework.', 'published', 1])
    await db.run("INSERT INTO posts (title, body, status, user_id) VALUES (?, ?, ?, ?)", ['Handlebars Templates', 'This app uses Handlebars as the view engine.', 'published', 1])
    await db.run("INSERT INTO posts (title, body, status, user_id) VALUES (?, ?, ?, ?)", ['Draft Post', 'This is a draft.', 'draft', 2])

    logger.info('Database seeded (password: secret)')
  }
}
