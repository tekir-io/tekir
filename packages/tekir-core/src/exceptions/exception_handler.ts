import type { HttpContext } from '../http/types'
import { HttpException } from './http_exception'

export type ErrorReporter = (error: Error, ctx: HttpContext) => void | Promise<void>

export class ExceptionHandler {
  private reporters: ErrorReporter[] = []
  private ignoredCodes: string[] = []
  private ignoredStatuses: number[] = []
  private statusPageMap: Record<string, (ctx: HttpContext, error: any) => any> = {}
  public debug = false

  /** Ignore these HTTP status codes when reporting */
  ignoreStatuses(...statuses: number[]): this {
    this.ignoredStatuses.push(...statuses)
    return this
  }

  /** Ignore these error codes when reporting */
  ignoreCodes(...codes: string[]): this {
    this.ignoredCodes.push(...codes)
    return this
  }

  /** Register an error reporter (logger, Sentry, etc.) */
  report(reporter: ErrorReporter): this {
    this.reporters.push(reporter)
    return this
  }

  /**
   * Register status pages for specific HTTP error codes.
   * Renders custom HTML/views instead of JSON for browser requests.
   * @example
   * handler.statusPages({
   *   '404': (ctx) => render(NotFoundPage),
   *   '500..599': (ctx, error) => render(ErrorPage, { error }),
   * })
   */
  statusPages(pages: Record<string, (ctx: HttpContext, error: any) => any>): this {
    this.statusPageMap = { ...this.statusPageMap, ...pages }
    return this
  }

  async handle(error: Error, ctx: HttpContext): Promise<Response> {
    // Let exceptions with their own handle() method self-render
    if (typeof (error as any).handle === 'function') {
      try {
        const result = await (error as any).handle(error, ctx)
        if (result instanceof Response) return result
        if (result) return new Response(typeof result === 'object' ? JSON.stringify(result) : String(result), {
          status: (error as any).statusCode || 500,
          headers: { 'Content-Type': typeof result === 'object' ? 'application/json' : 'text/html; charset=utf-8' },
        })
      } catch {}
    }

    // Report
    const statusCode = (error as any).statusCode || 500
    const code = (error as any).code || ''
    const shouldReport = !this.ignoredCodes.includes(code) && !this.ignoredStatuses.includes(statusCode)
    if (shouldReport) await this._report(error, ctx)

    // Let exceptions with their own report() method self-report
    if (typeof (error as any).report === 'function') {
      try { await (error as any).report(error, ctx) } catch {}
    }

    // Status pages (HTML requests only)
    const accept = (ctx as any).request?.raw?.headers?.get('accept') || ''
    if (accept.includes('text/html') && Object.keys(this.statusPageMap).length > 0) {
      const page = this._matchStatusPage(statusCode)
      if (page) {
        try {
          const result = await page(ctx, error)
          if (result instanceof Response) return result
          return new Response(String(result), {
            status: statusCode,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } catch {}
      }
    }

    // HttpException → JSON
    if (error instanceof HttpException) {
      return new Response(JSON.stringify(error.toJSON()), {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Generic error
    const body = this.debug
      ? { error: { message: error.message, code: 'INTERNAL_SERVER_ERROR', statusCode: 500, stack: error.stack } }
      : { error: { message: 'Internal Server Error', code: 'INTERNAL_SERVER_ERROR', statusCode: 500 } }

    return new Response(JSON.stringify(body), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private _matchStatusPage(status: number): ((ctx: HttpContext, error: any) => any) | null {
    // Exact match first
    if (this.statusPageMap[String(status)]) return this.statusPageMap[String(status)]
    // Range match (e.g. '500..599')
    for (const [key, fn] of Object.entries(this.statusPageMap)) {
      if (key.includes('..')) {
        const [min, max] = key.split('..').map(Number)
        if (status >= min && status <= max) return fn
      }
    }
    return null
  }

  private async _report(error: Error, ctx: HttpContext): Promise<void> {
    for (const reporter of this.reporters) {
      try { await reporter(error, ctx) } catch {}
    }
  }
}
