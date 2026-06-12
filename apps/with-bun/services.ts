import { service } from '@tekir/core'
import type { Database } from '@tekir/db'
export const db = service<Database>('db')
