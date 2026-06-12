import type { App } from '@tekir/core'
import { Auth } from './auth_manager'
import { attachAuth } from './middleware'

/**
 * Service provider that registers the {@link Auth} manager into the
 * application container and wires up a lightweight `ctx.auth` initializer
 * onto the router so handlers can call `auth.login(...)` without manually
 * adding middleware in the kernel.
 */
export class AuthProvider {
  /**
   * Reads the `auth` config, instantiates the {@link Auth} manager, and
   * registers a global router middleware that puts an empty `ctx.auth` on
   * every request. Token verification stays opt-in via `authenticate()`
   * or `silentAuth()` on the routes that actually need it.
   *
   * @param app - The application instance.
   */
  async register(app: App) {
    const config = app.use('config')
    if (!config('auth')) return
    app.instance('auth', new Auth(config('auth')))

    try {
      const router = app.use<any>('router')
      if (router && typeof router.useGlobal === 'function') {
        router.useGlobal([attachAuth()])
      }
    } catch {
      // Router not available yet — apps without a router (e.g. CLI-only)
      // simply skip the middleware registration.
    }
  }
}
