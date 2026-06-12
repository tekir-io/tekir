import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadDir } from '../src/loader'

describe('loadDir', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-loader-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty array when directory does not exist', async () => {
    const result = await loadDir(join(tmp, 'missing'))
    expect(result).toEqual([])
  })

  test('imports every file in the directory and returns default exports', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export default { name: "A" }\n')
    writeFileSync(join(tmp, 'b.ts'), 'export default { name: "B" }\n')

    const result = await loadDir<{ name: string }>(tmp)
    expect(result).toHaveLength(2)
    const names = result.map(r => r.name).sort()
    expect(names).toEqual(['A', 'B'])
  })

  test('supports a custom picker', async () => {
    writeFileSync(join(tmp, 'job.ts'), 'export class Job { name = "X" }\n')

    const result = await loadDir<{ name: string }>(tmp, {
      pick: (mod: any) => new mod.Job(),
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('X')
  })

  test('skips files that do not match the regex when `match` is set', async () => {
    writeFileSync(join(tmp, 'auth.controller.ts'), 'export default "auth"\n')
    writeFileSync(join(tmp, 'helpers.ts'), 'export default "helper"\n')

    const result = await loadDir<string>(tmp, { match: /\.controller$/ })
    expect(result).toEqual(['auth'])
  })

  test('skips files matching the `ignore` pattern', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export default "a"\n')
    writeFileSync(join(tmp, 'a.test.ts'), 'export default "a-test"\n')

    const result = await loadDir<string>(tmp, { ignore: /\.test$/ })
    expect(result).toEqual(['a'])
  })

  test('does not recurse by default', async () => {
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(join(tmp, 'top.ts'), 'export default "top"\n')
    writeFileSync(join(tmp, 'nested', 'inside.ts'), 'export default "inside"\n')

    const result = await loadDir<string>(tmp)
    expect(result).toEqual(['top'])
  })

  test('recurses when recursive: true', async () => {
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(join(tmp, 'top.ts'), 'export default "top"\n')
    writeFileSync(join(tmp, 'nested', 'inside.ts'), 'export default "inside"\n')

    const result = await loadDir<string>(tmp, { recursive: true })
    expect(result.sort()).toEqual(['inside', 'top'])
  })

  test('drops `.d.ts` files', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export default "real"\n')
    writeFileSync(join(tmp, 'a.d.ts'), 'export default "type"\n')

    const result = await loadDir<string>(tmp)
    expect(result).toEqual(['real'])
  })

  test('filters empty results by default', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export default "kept"\n')
    writeFileSync(join(tmp, 'b.ts'), 'export const named = "no-default"\n')

    const result = await loadDir<unknown>(tmp, {
      pick: (mod: any) => mod.default,
    })
    expect(result).toEqual(['kept'])
  })

  test('default pick auto-grabs the single named export when no default', async () => {
    writeFileSync(
      join(tmp, 'auth.ts'),
      'export class AuthController {}\n',
    )

    const result = await loadDir<any>(tmp)
    expect(result).toHaveLength(1)
    expect(typeof result[0]).toBe('function')
    expect((result[0] as any).name).toBe('AuthController')
  })

  test('default pick prefers a decorator-tagged class among multiple named exports', async () => {
    writeFileSync(
      join(tmp, 'mixed.ts'),
      `
export class Helper {}
export class Controller {}
Controller.__prefix = ['/api']
export const noise = 42
`,
    )

    const result = await loadDir<any>(tmp)
    expect(result).toHaveLength(1)
    expect(result[0]?.__prefix).toEqual(['/api'])
  })

  test('default pick falls through to the namespace when nothing matches', async () => {
    writeFileSync(
      join(tmp, 'cfg.ts'),
      'export const a = 1; export const b = 2\n',
    )

    const result = await loadDir<any>(tmp)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ a: 1, b: 2 })
  })
})

import { loadDirEntries } from '../src/loader'

describe('loadDirEntries', () => {
  let tmp2: string

  beforeEach(() => {
    tmp2 = mkdtempSync(join(tmpdir(), 'tekir-loader-entries-'))
  })

  afterEach(() => {
    rmSync(tmp2, { recursive: true, force: true })
  })

  test('keeps the source file path next to every picked export', async () => {
    writeFileSync(join(tmp2, 'a.ts'), 'export default "alpha"\n')
    writeFileSync(join(tmp2, 'b.ts'), 'export default "beta"\n')

    const entries = await loadDirEntries<string>(tmp2)
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.file.endsWith('.ts')).toBe(true)
      expect(typeof entry.picked).toBe('string')
    }
  })
})
