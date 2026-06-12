import type { TekirApp } from '@tekir/core'
import { serverTiming } from '@tekir/core'
import { cors } from '@tekir/cors'
import { DatabaseProvider } from '@tekir/db'
import { CacheProvider } from '@tekir/cache'
import { AuthProvider } from '@tekir/auth'
import { EmitterProvider } from '@tekir/emitter'
import { HashProvider } from '@tekir/hash'
import { CronProvider } from '@tekir/cron'
import { bodyParser } from '@tekir/bodyparser'
import requestLogger from '~/middleware/request_logger'

export default function ({ app, router, config }: TekirApp) {
  app.registerAll([
    DatabaseProvider,
    CacheProvider,
    AuthProvider,
    EmitterProvider,
    HashProvider,
    CronProvider,
  ])

  router.useGlobal([cors(config('cors'))])
  router.useRouter([bodyParser(), serverTiming(), requestLogger])
}
