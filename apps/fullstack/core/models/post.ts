import { BaseModel, column, belongsTo, scope, type Relation } from '@tekir/db'
import { User } from './user'

export class Post extends BaseModel {
  static table = 'posts'
  static softDeletes = true
  static schema = {
    id: column.id(),
    title: column.string(),
    body: column.text(),
    userId: column.integer({ references: { table: 'users', column: 'id' } }),
    status: column.string({ default: 'draft' }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
    deletedAt: column.dateTime({ nullable: true }),
  }

  static fillable = ['title', 'body', 'userId', 'status']
  static touches = ['user']

  static relations: Record<string, Relation> = {
    user: belongsTo(() => User),
  }

  static published = scope((q) => q.where('status', 'published'))
  static drafts = scope((q) => q.where('status', 'draft'))

  declare id: number
  declare title: string
  declare body: string
  declare userId: number
  declare status: string
  declare createdAt: string
  declare updatedAt: string | null
  declare deletedAt: string | null
}
