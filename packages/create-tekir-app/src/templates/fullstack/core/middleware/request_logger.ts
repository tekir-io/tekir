import type { MiddlewareFunction } from '@tekir/core'
import { logger } from '#services'

/**
 * Logs every request as `METHOD /path -> status (durationMs)`.
 * Wired up globally in `start/kernel.ts`.
 */
const requestLogger: MiddlewareFunction = async (ctx, next) => {
  const started = performance.now()
  await next()
  const duration = Math.round(performance.now() - started)
  const status = ctx.response.getStatusCode()
  logger.info(`${ctx.request.method} ${ctx.request.url} -> ${status} (${duration}ms)`)
}

export default requestLogger
