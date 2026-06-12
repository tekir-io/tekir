import { BaseMigration } from '@tekir/db'
import type { Schema } from '@tekir/db'

export default class extends BaseMigration {
  up(schema: Schema) {
    schema.createTable('users', (t) => {
      t.id()
      t.string('name').notNullable()
      t.string('email').notNullable().unique()
      t.string('password').notNullable()
      t.timestamps()
    })
  }

  down(schema: Schema) {
    schema.dropTableIfExists('users')
  }
}
