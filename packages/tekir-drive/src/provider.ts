import type { App } from '@tekir/core'
import { Drive } from './manager'

export class DriveProvider {
  async register(app: App) {
    const config = app.use('config')
    if (!config('drive')) return
    app.instance('drive', new Drive(config('drive')))
  }
}
