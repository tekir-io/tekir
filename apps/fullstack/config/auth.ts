import { JwtGuard, DatabaseTokenGuard, SessionGuard } from '@tekir/auth'
import type { AuthUser } from '@tekir/auth'
import { db } from '#services'
import env from '#env'

const resolve = async (id: string | number): Promise<AuthUser | null> => {
  const { User } = await import('~/models/user')
  const user = await User.find(Number(id))
  if (!user) return null
  return { id: user.id, ...user.toJSON() }
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
      db,
      prefix: 'oat_',
      expiresIn: 30 * 86400,
      resolve,
    }),
    web: () => new SessionGuard({ resolve }),
  },
}
