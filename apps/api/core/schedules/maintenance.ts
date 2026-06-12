import { CronJob, Schedule, Every } from '@tekir/cron-decorators'
import { db, cache } from '#services'

@CronJob()
export class MaintenanceJobs {
  @Every('1m', 'clean-expired-tokens')
  async cleanExpiredTokens() {
    await db.run(`DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`)
  }

  @Every('30m', 'clear-cache')
  async clearCache() {
    await cache.flush()
  }

  @Schedule('0 0 * * *', 'daily-stats')
  async dailyStats() {
    const projects = await db.queryOne('SELECT COUNT(*) as count FROM projects')
    const tasks = await db.queryOne('SELECT COUNT(*) as count FROM tasks')
    console.log(`[stats] Projects: ${projects?.count}, Tasks: ${tasks?.count}`)
  }
}
