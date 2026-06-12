import { JwtGuard, DatabaseTokenGuard } from '@tekir/auth'
import type { AuthUser } from '@tekir/auth'
import env from '#env'
import { db } from '#services'

const resolve = async (id: string | number): Promise<AuthUser | null> => {
  const { User } = await import('~/models/user')
  return await User.find(Number(id)) as AuthUser | null
}

export default {
  defaultGuard: 'jwt',
  guards: {
    jwt: () => new JwtGuard({
      secret: env.APP_KEY,
      expiresIn: 3600,
      resolve,
    }),
    api: () => new DatabaseTokenGuard({
      db, prefix: 'oat_', expiresIn: 30 * 86400,
      resolve,
    }),
  },
}
