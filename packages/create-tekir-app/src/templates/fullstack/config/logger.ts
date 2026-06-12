import env from '#env'
import type { LoggerConfig } from '@tekir/logger'

export default {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  pretty: env.NODE_ENV !== 'production',
  name: env.APP_NAME,
  timestamp: true,
  redact: ['password', 'token', 'secret'],
} satisfies LoggerConfig
