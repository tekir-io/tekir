import { JwtGuard, DatabaseTokenGuard } from '@tekir/auth'
import type { AuthConfig } from '@tekir/auth'
import env from '#env'
import { db } from '#services'
import { User } from '~/models/user'

export default {
  defaultGuard: 'jwt',
  guards: {
    jwt: () => new JwtGuard({
      secret: env.APP_KEY,
      expiresIn: 3600,
      model: User,
    }),
    api: () => new DatabaseTokenGuard({
      db, prefix: 'oat_', expiresIn: 30 * 86400,
      model: User,
    }),
  },
} satisfies AuthConfig
