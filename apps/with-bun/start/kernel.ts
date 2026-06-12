import type { TekirApp } from '@tekir/core'
import { serverTiming } from '@tekir/core'
import { cors } from '@tekir/cors'
import { DatabaseProvider } from '@tekir/db'
import { bodyParser } from '@tekir/bodyparser'

export default function ({ app, router, config }: TekirApp) {
  app.registerAll([DatabaseProvider])
  router.useGlobal([cors(config('cors', { origin: true }))])
  router.useRouter([bodyParser(), serverTiming()])
}
