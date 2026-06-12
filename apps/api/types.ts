import type { User } from './core/models/user'
import type { ModelFields } from '@tekir/db'

declare module '@tekir/auth' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TekirAuthUser extends Omit<ModelFields<User>, 'id'> {}
}
