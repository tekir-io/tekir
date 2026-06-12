import type { User } from './core/models/user'
import type { ModelFields } from '@tekir/db'

declare module '@tekir/auth' {
  interface TekirAuthUser extends ModelFields<User> {}
}
