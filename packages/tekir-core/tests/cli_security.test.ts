import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtInCommands } from '../src/cli/index'

function command(name: string) {
  const result = builtInCommands.find((entry) => entry.name === name)
  if (!result) throw new Error(`Missing command ${name}`)
  return result
}

function context(appRoot: string, errors: string[]) {
  return { appRoot, tekir: { logger: { error: (message: string) => errors.push(message), info: () => {} } } }
}

describe('built-in scaffold commands — path and source safety', () => {
  test('rejects traversal and source-injection names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tekir-cli-'))
    const errors: string[] = []
    try {
      for (const name of ['make:controller', 'make:middleware', 'make:provider', 'make:command']) {
        await command(name).run(['../../escaped'], context(root, errors))
        await command(name).run(["Bad');process.exit();//"], context(root, errors))
      }
      expect(errors).toHaveLength(8)
      expect(await Bun.file(join(root, '..', 'escaped_controller.ts')).exists()).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('escapes a custom controller route as a string literal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tekir-cli-'))
    const route = "/posts'); throw new Error('injected"
    try {
      await command('make:controller').run(
        ['PostController', route],
        context(root, []),
      )
      const source = await readFile(join(root, 'app/controllers/post_controller.ts'), 'utf8')
      expect(source).toContain(`@Controller(${JSON.stringify(route)})`)
      expect(source).not.toContain("@Controller('/posts')")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
