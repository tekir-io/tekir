import type { TekirApp } from '@tekir/core'
import { db } from '#services'

export default async function (_tekir: TekirApp) {
  await db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', ['Hello World', 'First post from tekir + Next.js'])
}
