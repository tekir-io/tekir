import type { TekirApp } from '@tekir/core'
import { emitter } from '#services'
import { UserEvents } from '~/listeners/user_events'
import { TaskEvents } from '~/listeners/task_events'

export default function (_tekir: TekirApp) {
  emitter.register(UserEvents, TaskEvents)
}
