import { service } from '@tekir/core'
import type { View } from '@tekir/view'
import type { Database } from '@tekir/db'
import type { Logger } from '@tekir/logger'
import type { Hash } from '@tekir/hash'

export const view = service<View>('view')
export const db = service<Database>('db')
export const logger = service<Logger>('logger')
export const hash = service<Hash>('hash')
