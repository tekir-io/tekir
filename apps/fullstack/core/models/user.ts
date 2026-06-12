import { BaseModel, column, hasMany, scope, type Relation } from '@tekir/db'
import { Post } from './post'

export class User extends BaseModel {
  static table = 'users'
  static schema = {
    id: column.id(),
    name: column.string(),
    email: column.string({ unique: true }),
    password: column.string({ hidden: true }),
    role: column.string({ default: 'user' }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
  }

  static fillable = ['name', 'email', 'password', 'role']

  static relations: Record<string, Relation> = {
    posts: hasMany(() => Post),
  }

  static appends = ['isAdmin']
  static admins = scope((q) => q.where('role', 'admin'))

  declare id: number
  declare name: string
  declare email: string
  declare password: string
  declare role: string
  declare createdAt: string
  declare updatedAt: string | null

  get isAdmin(): boolean {
    return this.role === 'admin'
  }
}
