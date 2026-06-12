import type { App } from '@tekir/core'
import type { SwaggerConfig, RouterLike, OpenApiSpec } from './types'
import { swagger } from './ui'
import { buildOpenApiSpec } from './spec_builder'

/**
 * Service provider that registers Swagger UI and JSON spec endpoints.
 *
 * @example
 * ```ts
 * app.register(new SwaggerProvider({ title: 'My API', version: '1.0.0' }))
 * ```
 */
export class SwaggerProvider {
  private config: SwaggerConfig

  /**
   * @param {SwaggerConfig} [config={}] - Swagger configuration options
   */
  constructor(config: SwaggerConfig = {}) {
    this.config = config
  }

  /**
   * Register Swagger routes and the provider instance into the app container.
   * @param {App} app - The application instance
   * @returns {Promise<void>}
   */
  async register(app: App) {
    const configFn = app.use('config')
    const swaggerConfig: SwaggerConfig = (typeof configFn === 'function' ? configFn('swagger') : null) as SwaggerConfig || this.config
    if (!swaggerConfig && !this.config) return
    app.instance('swagger', this)
    let router: RouterLike | null = null
    try { router = app.use('router') } catch { router = null }
    if (router) {
      swagger(router as any, swaggerConfig)
    }
  }

  /**
   * Build the OpenAPI specification from the given router.
   * @param {RouterLike} router - The router instance
   * @returns {OpenApiSpec} The OpenAPI specification
   */
  buildSpec(router: RouterLike): OpenApiSpec {
    return buildOpenApiSpec(router, this.config)
  }
}
