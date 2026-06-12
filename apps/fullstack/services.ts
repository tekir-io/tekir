import { service } from '@tekir/core'
import type { View } from '@tekir/view'
import type { Cache } from '@tekir/cache'
import type { Database } from '@tekir/db'
import type { Logger } from '@tekir/logger'

export const view = service<View>('view')
export const cache = service<Cache>('cache')
export const db = service<Database>('db')
export const logger = service<Logger>('logger')
