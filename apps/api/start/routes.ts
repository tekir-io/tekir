import type { TekirApp } from '@tekir/core'
import { swagger } from '@tekir/swagger'
import AuthController from '~/controllers/auth_controller'
import ProjectController from '~/controllers/project_controller'
import TaskController from '~/controllers/task_controller'
import CommentController from '~/controllers/comment_controller'
import UploadController from '~/controllers/upload_controller'
import HealthController from '~/controllers/health_controller'

export default function ({ router }: TekirApp) {
  router.register(AuthController, ProjectController, TaskController, CommentController, UploadController, HealthController)

  swagger(router, {
    title: 'tekir Project Management API',
    version: '1.0.0',
    description: 'A complete project management API built with tekir framework',
    path: '/docs',
    servers: [{ url: 'http://localhost:4001', description: 'Development' }],
  })
}
