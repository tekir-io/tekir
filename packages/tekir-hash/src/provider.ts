import type { App } from '@tekir/core'
import { Hash } from './manager'

export class HashProvider {
  async register(app: App) {
    const config = app.use('config')
    if (!config('hash')) return
    app.instance('hash', new Hash(config('hash')))
  }
}
