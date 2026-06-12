import type { Schema } from './schema'

export abstract class BaseMigration {
  connection?: string

  abstract up(schema: Schema): Promise<void> | void
  abstract down(schema: Schema): Promise<void> | void
}
