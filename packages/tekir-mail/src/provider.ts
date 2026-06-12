import type { App } from '@tekir/core'
import { Mail } from './manager'

export class MailProvider {
  async register(app: App) {
    const config = app.use('config')
    if (!config('mail')) return
    app.instance('mail', new Mail(config('mail')))
  }
}
