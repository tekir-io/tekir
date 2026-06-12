import type { App } from '@tekir/core'
import { bodyParser } from './middleware'

/**
 * Service provider that registers the body parser middleware globally.
 * Reads configuration from `config('bodyparser')` and attaches the middleware
 * to the application router via `useGlobal`.
 *
 * @example
 * ```ts
 * // config/bodyparser.ts
 * export default { json: { limit: '2mb' }, multipart: { maxFileSize: '10mb' } }
 * ```
 */
export class BodyParserProvider {
  /**
   * Boot the provider by registering the body parser as a global middleware.
   *
   * @param app - The application instance.
   */
  async boot(app: App) {
    const config = app.use('config')
    if (!config('bodyparser')) return
    app.use('router').useGlobal(bodyParser(config('bodyparser')))
  }
}
