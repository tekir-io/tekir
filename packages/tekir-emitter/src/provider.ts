import type { App } from '@tekir/core'
import { Emitter } from './emitter'

/**
 * Service provider that registers an {@link Emitter} instance into the application container.
 *
 * @example
 * ```ts
 * app.register(new EmitterProvider())
 * ```
 */
export class EmitterProvider {
  /**
   * Register the emitter service with the application.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    app.instance('emitter', new Emitter())
  }
}
