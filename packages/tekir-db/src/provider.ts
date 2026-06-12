import type { App } from '@tekir/core'
import { dbCommands } from './cli'

export class DatabaseProvider {
  /** Commands auto-exposed to the app's CLI when this provider is registered. */
  static commands = dbCommands

  async register(app: App) {
    const config = app.use('config')
    if (!config('database')) return
    const { createDatabase } = await import('./database')
    app.instance('db', createDatabase(config('database')))
  }
}
