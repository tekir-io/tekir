import type { App } from '@tekir/core'
import { Encryption } from './encryption'

export class EncryptionProvider {
  async register(app: App) {
    const config = app.use('config')
    const key = config('app.key') as string | undefined

    if (!key) {
      throw new Error(
        '[@tekir/encryption] app.key is not set. ' +
        'Run "bun run index.ts generate:key" to generate one, ' +
        'then add key: env.APP_KEY to config/app.ts'
      )
    }

    app.instance('encryption', new Encryption(key))
  }
}
