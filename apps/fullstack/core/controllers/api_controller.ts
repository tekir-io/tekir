import { Controller, Get, Middleware } from '@tekir/http-decorators'
import { limiter } from '@tekir/limiter'
import type { HttpContext } from '@tekir/core'

@Controller('/api')
export class ApiController {
  @Get('/health')
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }
  }

  @Get('/limited')
  @Middleware([limiter({ max: 3, window: 60 })])
  limited() {
    return { message: 'You got through!' }
  }

  @Get('/items/:id', { where: { id: { match: /^\d+$/, cast: Number } } })
  item({ params }: HttpContext) {
    return { id: params.id, type: typeof params.id }
  }
}
