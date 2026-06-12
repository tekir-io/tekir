import { BaseModel, column, hasMany, scope, type Relation } from '@tekir/db'
import { Project } from './project'
import { Task } from './task'
import { Comment } from './comment'

export class User extends BaseModel {
  static table = 'users'

  declare id: number
  declare name: string
  declare email: string
  declare password: string
  declare role: string
  declare avatar: string | null
  declare bio: string | null
  declare createdAt: string
  declare updatedAt: string | null

  static schema = {
    id: column.id(),
    name: column.string(),
    email: column.string({ unique: true, hidden: false }),
    password: column.string({ hidden: true }),
    role: column.string({ default: 'member' }),
    avatar: column.string({ nullable: true }),
    bio: column.text({ nullable: true }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
  }

  static fillable = ['name', 'email', 'password', 'bio']

  static appends = ['isAdmin']

  static relations: Record<string, Relation> = {
    projects: hasMany(() => Project),
    tasks: hasMany(() => Task),
    comments: hasMany(() => Comment),
  }

  static admins = scope((q) => q.where('role', 'admin'))
  static members = scope((q) => q.where('role', 'member'))

  get isAdmin(): boolean {
    return this.role === 'admin'
  }
}
