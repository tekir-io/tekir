import { service } from '@tekir/core'
import type { Auth } from '@tekir/auth'
import type { Database } from '@tekir/db'
import type { Cache } from '@tekir/cache'
import type { Hash } from '@tekir/hash'
import type { Emitter } from '@tekir/emitter'
import type { Drive } from '@tekir/drive'
import type { Notification } from '@tekir/notification'
import type { Cron } from '@tekir/cron'
import type { Logger } from '@tekir/logger'

export const auth = service<Auth>('auth')
export const db = service<Database>('db')
export const cache = service<Cache>('cache')
export const hash = service<Hash>('hash')
export const emitter = service<Emitter>('emitter')
export const drive = service<Drive>('drive')
export const notify = service<Notification>('notification')
export const cron = service<Cron>('cron')
export const logger = service<Logger>('logger')
