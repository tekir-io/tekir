import env from '#env'
import type { AppConfig } from '@tekir/core'

export default {
  name: env.APP_NAME,
  key: env.APP_KEY,
  port: env.PORT,
  env: env.NODE_ENV,
} satisfies AppConfig
