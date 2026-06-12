import { BaseModel, column, belongsTo, type Relation } from '@tekir/db'
import { Task } from './task'
import { User } from './user'

export class Comment extends BaseModel {
  static table = 'comments'

  declare id: number
  declare body: string
  declare taskId: number
  declare userId: number
  declare createdAt: string
  declare updatedAt: string | null

  static schema = {
    id: column.id(),
    body: column.text(),
    taskId: column.integer({ references: { table: 'tasks', column: 'id' } }),
    userId: column.integer({ references: { table: 'users', column: 'id' } }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
  }

  static fillable = ['body', 'taskId', 'userId']
  static touches = ['task']

  static relations: Record<string, Relation> = {
    task: belongsTo(() => Task),
    user: belongsTo(() => User),
  }
}
