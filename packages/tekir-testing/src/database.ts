
/**
 * Setup an in-memory test database with model tables.
 * Returns a cleanup function.
 *
 * @example
 * ```ts
 * import { beforeEach, afterEach } from 'bun:test'
 * import { setupTestDb } from '@tekir/testing'
 * import { User } from '~/models/user'
 * import { Post } from '~/models/post'
 *
 * let cleanup: () => Promise<void>
 *
 * beforeEach(async () => {
 *   cleanup = await setupTestDb([User, Post])
 * })
 *
 * afterEach(() => cleanup())
 * ```
 */
interface TestDbModel {
  createSQL: string
  table: string
}

/**
 * Set up test database tables from model definitions and return a cleanup function
 * that deletes all rows from those tables.
 *
 * @param {TestDbModel[]} models - Array of models with createSQL and table properties
 * @returns {Promise<() => Promise<void>>} Cleanup function that truncates all registered tables
 *
 * @example
 * ```ts
 * const cleanup = await setupTestDb([User, Post])
 * // ... run tests ...
 * await cleanup()
 * ```
 */
export async function setupTestDb(models: TestDbModel[]): Promise<() => Promise<void>> {
  try {

    const { getApp } = require('@tekir/core')
    const db = getApp().use('db')
    for (const model of models) {
      await db.exec(model.createSQL)
    }
  } catch {}

  return async () => {
    try {

      const { getApp } = require('@tekir/core')
      const db = getApp().use('db')
      for (const model of models) {
        await db.exec(`DELETE FROM ${quoteIdentifier(model.table)}`)
      }
    } catch {}
  }
}

/**
 * Quote a SQL identifier (table name) safely by validating it against a
 * conservative pattern and escaping any embedded double quotes. The value is
 * developer-provided so this is correctness/robustness, not an injection
 * boundary, but a table name containing a `"` would otherwise break the query.
 *
 * @param {string} name - The identifier to quote
 * @returns {string} The double-quoted, escaped identifier
 */
function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Invalid table identifier: ${name}`)
  }
  return `"${name.replace(/"/g, '""')}"`
}
