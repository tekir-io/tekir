import { BaseNotification } from '@tekir/notification'
import type { ChannelName } from '@tekir/notification'
import type { Task } from '~/models/task'
import type { User } from '~/models/user'

export class TaskAssignedNotification extends BaseNotification {
  constructor(public task: Task, public assignee: User) { super() }

  via(): ChannelName[] { return ['database', 'log'] }

  toDatabase() {
    return {
      type: 'task_assigned',
      title: `You were assigned: ${this.task.title}`,
      body: `Task "${this.task.title}" has been assigned to you.`,
    }
  }

  toLog() {
    return `Task "${this.task.title}" assigned to ${this.assignee.name}`
  }
}
