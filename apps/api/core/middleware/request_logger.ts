import { logger } from '#services'
import type { HttpContext } from '@tekir/core'

export default async function requestLogger(ctx: HttpContext, next: () => Promise<void>) {
  const start = performance.now()
  await next()
  const ms = (performance.now() - start).toFixed(2)
  logger.info(`${ctx.request.method} ${ctx.route.pattern} ${ctx.response.getStatusCode()} ${ms}ms`)
}
