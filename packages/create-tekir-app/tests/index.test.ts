import { test, expect, describe } from 'bun:test'
import { relative, isAbsolute } from 'path'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveProjectTarget, toPackageName } from '../src/index'

describe('resolveProjectTarget — valid names', () => {
  test('accepts a simple name', () => {
    const r = resolveProjectTarget('my-app', '/work')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.name).toBe('my-app')
      expect(r.targetDir.endsWith('my-app')).toBe(true)
    }
  })
  test('accepts dots, dashes, underscores, digits', () => {
    expect(resolveProjectTarget('app_1.2-x', '/work').ok).toBe(true)
  })
  test('trims surrounding whitespace', () => {
    const r = resolveProjectTarget('  spaced  ', '/work')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('spaced')
  })
})

describe('resolveProjectTarget — traversal / unsafe names rejected', () => {
  test('rejects empty', () => {
    expect(resolveProjectTarget('', '/work').ok).toBe(false)
  })
  test('rejects "."', () => {
    expect(resolveProjectTarget('.', '/work').ok).toBe(false)
  })
  test('rejects ".."', () => {
    expect(resolveProjectTarget('..', '/work').ok).toBe(false)
  })
  test('rejects relative traversal ../x', () => {
    expect(resolveProjectTarget('../x', '/work').ok).toBe(false)
  })
  test('rejects deep traversal ../../tmp/evil', () => {
    expect(resolveProjectTarget('../../tmp/evil', '/work').ok).toBe(false)
  })
  test('rejects POSIX absolute path', () => {
    expect(resolveProjectTarget('/etc/cron.d/x', '/work').ok).toBe(false)
  })
  test('rejects Windows absolute path', () => {
    // isAbsolute treats C:\ as absolute on win32; on POSIX the backslash
    // separator check still rejects it.
    expect(resolveProjectTarget('C:\\Windows\\x', '/work').ok).toBe(false)
  })
  test('rejects forward-slash separators', () => {
    expect(resolveProjectTarget('a/b', '/work').ok).toBe(false)
  })
  test('rejects backslash separators', () => {
    expect(resolveProjectTarget('a\\b', '/work').ok).toBe(false)
  })
  test('rejects special characters', () => {
    expect(resolveProjectTarget('na;me', '/work').ok).toBe(false)
    expect(resolveProjectTarget('na me', '/work').ok).toBe(false)
    expect(resolveProjectTarget('na$me', '/work').ok).toBe(false)
  })
  test('resolved target stays under cwd for valid names', () => {
    const r = resolveProjectTarget('safe', '/work')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const rel = relative('/work', r.targetDir)
      expect(rel.startsWith('..')).toBe(false)
      expect(isAbsolute(rel)).toBe(false)
    }
  })
})

describe('toPackageName', () => {
  test('lowercases', () => {
    expect(toPackageName('MyApp')).toBe('myapp')
  })
  test('strips leading dots and underscores', () => {
    expect(toPackageName('._app')).toBe('app')
  })
  test('keeps dashes and digits', () => {
    expect(toPackageName('my-app-2')).toBe('my-app-2')
  })
  test('falls back to "app" when nothing remains', () => {
    expect(toPackageName('___')).toBe('app')
  })
})

describe('CLI scaffolding integration', () => {
  const entry = new URL('../src/index.ts', import.meta.url).pathname

  test('creates a complete minimal project and renames template files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-tekir-app-'))
    try {
      const result = Bun.spawnSync(
        [process.execPath, entry, 'My-App', '--template=minimal'],
        { cwd }
      )
      expect(result.exitCode).toBe(0)
      const target = join(cwd, 'My-App')
      expect(existsSync(join(target, 'index.ts'))).toBe(true)
      expect(existsSync(join(target, 'tsconfig.json'))).toBe(true)
      expect(existsSync(join(target, 'tsconfig.json.template'))).toBe(false)
      expect(existsSync(join(target, '.gitignore'))).toBe(true)
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
      expect(pkg.name).toBe('my-app')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('refuses to overwrite a non-empty project directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-tekir-app-'))
    try {
      const target = join(cwd, 'existing')
      mkdirSync(target)
      writeFileSync(join(target, 'keep.txt'), 'user data')
      const result = Bun.spawnSync(
        [process.execPath, entry, 'existing', '--template=minimal'],
        { cwd }
      )
      expect(result.exitCode).toBe(1)
      expect(result.stdout.toString()).toContain('already exists and is not empty')
      expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('user data')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
