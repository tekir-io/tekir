import { BaseModel, column, belongsTo, hasMany, manyToMany, scope, type Relation } from '@tekir/db'
import { User } from './user'
import { Task } from './task'

export class Project extends BaseModel {
  static table = 'projects'
  static softDeletes = true

  declare id: number
  declare name: string
  declare description: string | null
  declare ownerId: number
  declare status: string
  declare isPublic: boolean
  declare createdAt: string
  declare updatedAt: string | null
  declare deletedAt: string | null

  static schema = {
    id: column.id(),
    name: column.string(),
    description: column.text({ nullable: true }),
    ownerId: column.integer({ references: { table: 'users', column: 'id' } }),
    status: column.string({ default: 'active' }),
    isPublic: column.boolean({ default: 1 }),
    createdAt: column.dateTime({ autoCreate: true }),
    updatedAt: column.dateTime({ autoCreate: true, autoUpdate: true, nullable: true }),
    deletedAt: column.dateTime({ nullable: true }),
  }

  static fillable = ['name', 'description', 'status', 'isPublic', 'ownerId']

  static relations: Record<string, Relation> = {
    owner: belongsTo(() => User),
    tasks: hasMany(() => Task),
    members: manyToMany(() => User, { pivotTable: 'project_members' }),
  }

  static active = scope((q) => q.where('status', 'active'))
  static archived = scope((q) => q.where('status', 'archived'))
}
