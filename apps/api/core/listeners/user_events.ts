import { Listener, On } from '@tekir/event-decorators'
import { logger } from '#services'

@Listener()
export class UserEvents {
  @On('user.registered')
  async onRegistered(data: { userId: number; email: string }) {
    logger.info({ event: 'user.registered', ...data }, 'New user registered')
  }

  @On('user.login')
  async onLogin(data: { userId: number }) {
    logger.info({ event: 'user.login', ...data }, 'User logged in')
  }
}
