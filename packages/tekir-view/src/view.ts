import type { ViewEngine, RenderOptions } from './types'
import { join } from 'path'

/**
 * View rendering service that delegates to a pluggable {@link ViewEngine}.
 *
 * Registered in the application container as `'view'`. Supports both
 * full-HTML rendering and streaming responses.
 *
 * @example
 * ```ts
 * const view = new View()
 * view.configure(myReactEngine, '/app/views')
 * const response = await view.render(HomePage, { title: 'Hello' })
 * ```
 */
export class View {
  private engine: ViewEngine | null = null
  private dir: string = join(process.cwd(), 'resources/views')

  /**
   * Configure the view engine and optionally override the views directory.
   *
   * @param engine - The view engine implementation to use for rendering.
   * @param dir - Absolute path to the views directory. Defaults to `<cwd>/resources/views`.
   * @returns The View instance for chaining.
   *
   * @example
   * ```ts
   * view.configure(reactEngine, '/app/resources/views')
   * ```
   */
  configure(engine: ViewEngine, dir?: string): this {
    this.engine = engine
    if (dir) this.dir = dir
    return this
  }

  /**
   * Get the configured view engine.
   *
   * @returns The active {@link ViewEngine} instance.
   * @throws If no view engine has been configured.
   */
  getEngine(): ViewEngine {
    if (!this.engine) {
      throw new Error(
        '[tekir/view] No view engine configured. ' +
        'Set one in config/view.ts or call view.configure(engine).'
      )
    }
    return this.engine
  }

  /**
   * Get the configured views directory path.
   *
   * @returns The absolute path to the views directory.
   */
  getDir(): string {
    return this.dir
  }

  /**
   * Render a template and return an HTTP `Response`.
   *
   * Uses streaming by default when the engine supports it.
   *
   * @param template - The template component or identifier to render.
   * @param data - Props or data to pass to the template.
   * @param options - Render options (streaming, status code, extra headers).
   * @returns A `Response` with `Content-Type: text/html`.
   *
   * @example
   * ```ts
   * const response = await view.render(HomePage, { user }, { status: 200 })
   * ```
   */
  async render(template: any, data?: any, options?: RenderOptions): Promise<Response> {
    const engine = this.getEngine()
    const { stream: useStream = true, status = 200, headers: extra = {} } = options ?? {}
    // Default to `nosniff` so a browser cannot MIME-sniff the HTML response
    // into another content type. `extra` can still override any header,
    // including these defaults, for callers that need to.
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    }

    if (useStream && engine.renderStream) {
      const stream = await engine.renderStream(template, data)
      return new Response(stream, { status, headers })
    }

    const html = await engine.render(template, data)
    return new Response(html, { status, headers })
  }

  /**
   * Render a template to a raw HTML string (no Response wrapping).
   *
   * @param template - The template component or identifier to render.
   * @param data - Props or data to pass to the template.
   * @returns The rendered HTML string.
   *
   * @example
   * ```ts
   * const html = await view.renderToHTML(EmailTemplate, { name: 'Alice' })
   * ```
   */
  async renderToHTML(template: any, data?: any): Promise<string> {
    return this.getEngine().render(template, data)
  }
}
