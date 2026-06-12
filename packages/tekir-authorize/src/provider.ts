import type { App } from '@tekir/core'
import { Authorize } from './authorize'

/**
 * Service provider that registers the Authorize instance into the application container.
 *
 * @example
 * ```ts
 * app.register(new AuthorizeProvider())
 * ```
 */
export class AuthorizeProvider {
  /**
   * Register the Authorize service into the app container.
   * @param {App} app - The application instance
   * @returns {Promise<void>}
   */
  async register(app: App) {
    app.instance('authorize', new Authorize())
  }
}
