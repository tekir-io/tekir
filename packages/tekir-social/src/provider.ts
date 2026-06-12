import type { App } from '@tekir/core'
import { Social } from './social'

/**
 * Service provider that reads the `social` configuration and registers
 * a {@link Social} instance in the application container.
 */
export class SocialProvider {
  /**
   * Register the Social authentication manager into the application container.
   *
   * @param app - The Tekir application instance.
   * @returns A promise that resolves once registration is complete.
   */
  async register(app: App) {
    const config = app.use('config')
    const socialConfig = config('social')
    if (!socialConfig?.providers) return

    const social = new Social(socialConfig)
    app.singleton('social', () => social)
  }
}
