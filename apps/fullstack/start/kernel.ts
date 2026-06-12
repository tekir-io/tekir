import type { TekirApp } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import { CacheProvider } from '@tekir/cache'
import { AuthProvider } from '@tekir/auth'
import { ViewProvider } from '@tekir/view'
import { HashProvider } from '@tekir/hash'
import { cors } from '@tekir/cors'
import { session } from '@tekir/session'
import { silentAuth } from '@tekir/auth'
import requestLogger from '~/middleware/request_logger'
import addRequestId from '~/middleware/add_request_id'

export default function({ app, router, config }: TekirApp) {
  app.registerAll([DatabaseProvider, CacheProvider, AuthProvider, ViewProvider, HashProvider])

  router.useGlobal([
    cors(config('cors')),
    session(config('session')),
    silentAuth(),
  ])

  router.useRouter([
    addRequestId,
    requestLogger,
  ])
}
