import type { TekirApp } from '@tekir/core'
import { db } from '#services'

export default async function (_tekir: TekirApp) {
  await db.exec(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0
  )`)

  await db.run('INSERT INTO todos (title) VALUES (?)', ['Learn tekir'])
  await db.run('INSERT INTO todos (title) VALUES (?)', ['Build something cool'])
}
