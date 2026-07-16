import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeMigrationCommand, makeModelCommand, makeSeederCommand } from '../src/cli'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const context = (appRoot: string) => ({
  appRoot,
  tekir: { logger: { info() {}, error() {} } },
})

describe('database scaffold commands', () => {
  test('reject names that could escape the generated directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tekir-db-cli-'))
    roots.push(root)
    await expect(makeMigrationCommand.run(['../../outside'], context(root))).rejects.toThrow('Invalid migration name')
    await expect(makeModelCommand.run(['Bad\"Name'], context(root))).rejects.toThrow('Invalid model name')
    await expect(makeSeederCommand.run(['../user'], context(root))).rejects.toThrow('Invalid seeder name')
  })

  test('still accepts conventional framework artifact names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tekir-db-cli-'))
    roots.push(root)
    await expect(makeMigrationCommand.run(['create_users'], context(root))).resolves.toBeUndefined()
    await expect(makeModelCommand.run(['UserProfile'], context(root))).resolves.toBeUndefined()
    await expect(makeSeederCommand.run(['user'], context(root))).resolves.toBeUndefined()
  })
})
