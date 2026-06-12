import { BaseModel, column, belongsTo, hasMany, scope, type Relation } from '@tekir/db'
import { Project } from './project'
import { User } from './user'
import { Comment } from './comment'

export class Task extends BaseModel {
  static table = 'tasks'

  declare id: number
  declare title: string
  declare description: string | null
  declare projectId: number
  declare assigneeId: number | null
  declare status: string
  declare priority: string
  declare dueDate: string | null
  declare completedAt: string | null
  declare createdAt: string
  declare updatedAt: string | null

  static schema = {
    id: column.id(),
    title: column.string(),
    description: column.text({ nullable: true }),
    projectId: column.integer({ references: { table: 'projects', column: 'id' } }),
    assigneeId: column.integer({ nullable: true, references: { table: 'users', column: 'id' } }),
    status: column.string({ default: 'todo' }),
    priority: column.string({ default: 'medium' }),
    dueDate: column.date({ nullable: true }),
    completedAt: column.date({ nullable: true }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
  }

  static fillable = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate', 'projectId']
  static touches = ['project']

  static relations: Record<string, Relation> = {
    project: belongsTo(() => Project),
    assignee: belongsTo(() => User),
    comments: hasMany(() => Comment),
  }

  static todo = scope((q) => q.where('status', 'todo'))
  static inProgress = scope((q) => q.where('status', 'in_progress'))
  static done = scope((q) => q.where('status', 'done'))
  static overdue = scope((q) => q.where('status', '!=', 'done').whereNotNull('dueDate').where('dueDate', '<', new Date().toISOString()))
}
