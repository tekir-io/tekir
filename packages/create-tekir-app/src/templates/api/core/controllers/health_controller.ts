import { Controller, Get } from '@tekir/http-decorators'

@Controller('/health')
export default class HealthController {
  @Get('/')
  async check() {
    return { status: 'ok' }
  }
}
