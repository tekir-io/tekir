import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { tekir } from '../src/tekir'

describe('tekir() autoload', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'tekir-autoload-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  test('does not import root env.ts when envFile is not set', async () => {
    const flag = { ran: false }
    ;(globalThis as any).__envFlag__ = flag
    writeFileSync(
      join(tmpRoot, 'env.ts'),
      `;(globalThis as any).__envFlag__.ran = true\nexport default {}\n`,
    )

    await tekir({ appRoot: tmpRoot, environment: 'web' })
    expect(flag.ran).toBe(false)
    delete (globalThis as any).__envFlag__
  })

  test('imports envFile only when explicitly set', async () => {
    const flag = { ran: false }
    ;(globalThis as any).__envFlag2__ = flag
    writeFileSync(
      join(tmpRoot, 'my-env.ts'),
      `;(globalThis as any).__envFlag2__.ran = true\nexport default {}\n`,
    )

    await tekir({ appRoot: tmpRoot, environment: 'web', envFile: 'my-env.ts' })
    expect(flag.ran).toBe(true)
    delete (globalThis as any).__envFlag2__
  })

  test('does not scan <root>/config when configDir is not set', async () => {
    mkdirSync(join(tmpRoot, 'config'))
    writeFileSync(
      join(tmpRoot, 'config', 'app.ts'),
      `export default { name: 'should-not-load' }\n`,
    )

    const app = await tekir({ appRoot: tmpRoot, environment: 'web' })
    expect<unknown>(app.config('app.name')).toBeUndefined()
  })

  test('loads configDir when explicitly set', async () => {
    mkdirSync(join(tmpRoot, 'config'))
    writeFileSync(
      join(tmpRoot, 'config', 'app.ts'),
      `export default { name: 'loaded' }\n`,
    )

    const app = await tekir({ appRoot: tmpRoot, environment: 'web', configDir: 'config' })
    expect<unknown>(app.config('app.name')).toBe('loaded')
  })

  test('does not scan <root>/start when startDir is not set', async () => {
    const flag = { ran: false }
    ;(globalThis as any).__startFlag__ = flag
    mkdirSync(join(tmpRoot, 'start'))
    writeFileSync(
      join(tmpRoot, 'start', 'kernel.ts'),
      `export default async () => { (globalThis as any).__startFlag__.ran = true }\n`,
    )

    await tekir({ appRoot: tmpRoot, environment: 'web' })
    expect(flag.ran).toBe(false)
    delete (globalThis as any).__startFlag__
  })

  test('runs start kernel + start dir files when startDir is set', async () => {
    const seen: string[] = []
    ;(globalThis as any).__seen__ = seen
    mkdirSync(join(tmpRoot, 'start'))
    writeFileSync(
      join(tmpRoot, 'start', 'kernel.ts'),
      `export default async () => { (globalThis as any).__seen__.push('kernel') }\n`,
    )
    writeFileSync(
      join(tmpRoot, 'start', 'routes.ts'),
      `export default async () => { (globalThis as any).__seen__.push('routes') }\n`,
    )

    await tekir({ appRoot: tmpRoot, environment: 'web', startDir: 'start' })
    expect(seen).toEqual(['kernel', 'routes'])
    delete (globalThis as any).__seen__
  })

  test('absolute paths work for envFile/configDir/startDir', async () => {
    const flag = { ran: false }
    ;(globalThis as any).__absFlag__ = flag
    writeFileSync(
      join(tmpRoot, 'env.ts'),
      `;(globalThis as any).__absFlag__.ran = true\nexport default {}\n`,
    )

    await tekir({ appRoot: '/some/other/dir', environment: 'web', envFile: join(tmpRoot, 'env.ts') })
    expect(flag.ran).toBe(true)
    delete (globalThis as any).__absFlag__
  })

  test('missing envFile/configDir/startDir is silently skipped', async () => {
    // Files do not exist; no throw.
    const app = await tekir({
      appRoot: tmpRoot,
      environment: 'web',
      envFile: 'env.ts',
      configDir: 'config',
      startDir: 'start',
    })
    expect(app).toBeDefined()
  })
})
