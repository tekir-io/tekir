import type { TekirApp } from '@tekir/core'
import { swagger } from '@tekir/swagger'
import TodoController from '~/controllers/todo_controller'

export default function ({ router }: TekirApp) {
  router.register(TodoController)
  swagger(router, { title: 'tekir + Bun API', version: '1.0.0', path: '/docs' })
}
