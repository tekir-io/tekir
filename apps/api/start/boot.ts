import type { TekirApp } from '@tekir/core'
import { db, cron } from '#services'
import { MaintenanceJobs } from '~/schedules/maintenance'
import { User } from '~/models/user'
import { Project } from '~/models/project'
import { Task } from '~/models/task'
import { Comment } from '~/models/comment'
import { run as runSeeder } from '#database/seeders/seed'

export default async function ({ logger }: TekirApp) {
  await db.exec(User.createSQL)
  await db.exec(Project.createSQL)
  await db.exec(Task.createSQL)
  await db.exec(Comment.createSQL)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      hash TEXT NOT NULL UNIQUE,
      abilities TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT
    )
  `)

  if ((await User.count()) === 0) {
    await runSeeder()
    logger.info('Database seeded')
  }

  await cron.register(MaintenanceJobs)
}
