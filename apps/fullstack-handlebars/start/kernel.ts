import type { TekirApp } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import { ViewProvider } from '@tekir/view'
import { HashProvider } from '@tekir/hash'
import { session } from '@tekir/session'

export default function({ app, router }: TekirApp) {
  app.registerAll([DatabaseProvider, ViewProvider, HashProvider])
  router.useGlobal([session({ cookieName: 'tekir_session', age: 7200 })])
}
