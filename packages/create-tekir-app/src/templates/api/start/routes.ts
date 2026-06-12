import type { TekirApp } from '@tekir/core'
import { swagger } from '@tekir/swagger'
import AuthController from '~/controllers/auth_controller'
import HealthController from '~/controllers/health_controller'

export default function ({ router }: TekirApp) {
  router.register(AuthController, HealthController)

  swagger(router, {
    title: 'My API',
    version: '1.0.0',
    description: 'API built with tekir framework',
    path: '/docs',
    servers: [{ url: 'http://localhost:4001', description: 'Development' }],
  })
}
