import type { App } from '@tekir/core'
import { I18n } from './i18n'

export class I18nProvider {
  async register(app: App) {
    const config = app.use('config')
    if (!config('i18n')) return
    app.instance('i18n', new I18n(config('i18n') as ConstructorParameters<typeof I18n>[0]))
  }

  async boot(app: App) {
    const config = app.use('config')
    if (!app.has('i18n') || config('i18n.middleware') === false) return
    app.use('router').useGlobal(
      app.use('i18n').middleware()
    )
  }
}
