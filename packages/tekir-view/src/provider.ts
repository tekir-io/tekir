import type { App } from '@tekir/core'
import { View } from './view'

/**
 * Service provider that reads the `view` configuration and registers
 * a configured {@link View} instance in the application container.
 */
export class ViewProvider {
  /**
   * Register the View service into the application container.
   *
   * @param app - The Tekir application instance.
   * @returns A promise that resolves once registration is complete.
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('view')) return

    const engine = config('view.engine')
    if (!engine) return

    const view = new View()
    view.configure(engine, config('view.dir'))
    app.instance('view', view)
  }
}
