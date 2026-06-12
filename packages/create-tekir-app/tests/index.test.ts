import { test, expect, describe } from 'bun:test'
import { relative, isAbsolute } from 'path'
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
