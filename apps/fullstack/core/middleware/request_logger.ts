import type { HttpContext } from '@tekir/core'
import { logger } from '#services'

export default async function requestLogger(ctx: HttpContext, next: () => Promise<void>) {
  const start = performance.now()
  await next()
  const ms = (performance.now() - start).toFixed(2)
  logger.info(`${ctx.request.method} ${ctx.route.pattern} ${ms}ms`)
}
