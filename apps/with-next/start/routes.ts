import type { TekirApp } from '@tekir/core'
import { swagger } from '@tekir/swagger'
import PostController from '~/controllers/post_controller'

export default function ({ router }: TekirApp) {
  router.register(PostController)

  swagger(router, { title: 'tekir + Next.js API', version: '1.0.0', path: '/docs' })
}
