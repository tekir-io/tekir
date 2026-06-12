import { Listener, On } from '@tekir/event-decorators'
import { logger } from '#services'

@Listener()
export class TaskEvents {
  @On('task.status_changed')
  async onStatusChanged(data: { taskId: number; status: string }) {
    logger.info({ event: 'task.status_changed', ...data }, 'Task status changed')
  }
}
