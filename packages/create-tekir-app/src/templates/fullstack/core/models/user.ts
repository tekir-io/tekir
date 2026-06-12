import { BaseModel, column } from '@tekir/db'
import { hash } from '#services'

export class User extends BaseModel {
  static table = 'users'
  static hidden = ['password']
  static timestamps = true
  static fillable = ['name', 'email', 'password']

  // Schema describes columns to the model so queries like `User.find`,
  // `User.where`, and `User.create` know which columns exist. Tables
  // themselves are created by the migrations under `database/migrations`.
  static schema = {
    id: column.id(),
    name: column.string({ nullable: false }),
    email: column.string({ nullable: false, unique: true }),
    password: column.string({ nullable: false }),
  }

  declare id: number
  declare name: string
  declare email: string
  declare password: string

  static hooks = {
    beforeCreate: [
      async (user: User) => {
        user.password = await hash.make(user.password)
      },
    ],
  }
}
