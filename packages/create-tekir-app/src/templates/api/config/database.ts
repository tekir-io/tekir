import env from '#env'
import type { DatabaseConfig } from '@tekir/db'

export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      connection: { path: env.DB_PATH },
    },
  },
} satisfies DatabaseConfig
