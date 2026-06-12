import { BaseMigration } from '@tekir/db'
import type { Schema } from '@tekir/db'

export default class extends BaseMigration {
  up(schema: Schema) {
    schema.createTable('auth_tokens', (t) => {
      t.id()
      t.string('user_id').notNullable()
      t.string('name').defaultTo('')
      t.string('hash').notNullable().unique()
      t.text('metadata').defaultTo('{}')
      t.timestamp('created_at').notNullable()
      t.timestamp('expires_at').nullable()
      t.timestamp('last_used_at').nullable()
    })
  }

  down(schema: Schema) {
    schema.dropTableIfExists('auth_tokens')
  }
}
