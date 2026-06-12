import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { LocalDriver } from '../src/drivers/local'
import { mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import os from 'os'

// Create a symlink, returning false when the environment forbids it (some CI
// runners and unprivileged Windows sessions reject symlink creation).
function trySymlink(target: string, link: string, type: 'file' | 'dir'): boolean {
  try {
    symlinkSync(target, link, type)
    return true
  } catch {
    return false
  }
}

describe('LocalDriver — symlink escape containment', () => {
  let tmp: string
  let root: string
  let outside: string
  let driver: LocalDriver

  beforeEach(() => {
    tmp = join(os.tmpdir(), `tekir-drive-symlink-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    root = join(tmp, 'storage')
    outside = join(tmp, 'secret')
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'passwd'), 'root:x:0:0')
    driver = new LocalDriver(root, '/uploads', 'test-secret-key')
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('get through a symlinked directory pointing outside root is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.get('leak/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('getString through a symlinked directory is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.getString('leak/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('get through a symlinked file pointing outside root is rejected', async () => {
    const link = join(root, 'passwd-link')
    if (!trySymlink(join(outside, 'passwd'), link, 'file')) return
    await expect(driver.get('passwd-link')).rejects.toThrow('Path traversal detected')
  })

  test('put into a symlinked directory pointing outside root is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.put('leak/injected.txt', 'evil')).rejects.toThrow('Path traversal detected')
    expect(existsSync(join(outside, 'injected.txt'))).toBe(false)
  })

  test('delete through a symlinked directory pointing outside root is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.delete('leak/passwd')).rejects.toThrow('Path traversal detected')
    // The outside file must remain untouched.
    expect(existsSync(join(outside, 'passwd'))).toBe(true)
  })

  test('exists through a symlinked directory pointing outside root is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.exists('leak/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('copy out through a symlinked destination directory is rejected', async () => {
    await driver.put('safe.txt', 'data')
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.copy('safe.txt', 'leak/stolen.txt')).rejects.toThrow('Path traversal detected')
    expect(existsSync(join(outside, 'stolen.txt'))).toBe(false)
  })

  test('move out through a symlinked destination directory is rejected', async () => {
    await driver.put('safe.txt', 'data')
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.move('safe.txt', 'leak/stolen.txt')).rejects.toThrow('Path traversal detected')
    expect(existsSync(join(outside, 'stolen.txt'))).toBe(false)
    // The source must survive a rejected move.
    expect(await driver.exists('safe.txt')).toBe(true)
  })

  test('getMetadata through a symlinked directory is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.getMetadata('leak/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('list through a symlinked directory is rejected', async () => {
    const link = join(root, 'leak')
    if (!trySymlink(outside, link, 'dir')) return
    await expect(driver.list('leak')).rejects.toThrow('Path traversal detected')
  })

  test('a symlink pointing to a sibling inside root is allowed', async () => {
    const innerTarget = join(root, 'real')
    mkdirSync(innerTarget, { recursive: true })
    writeFileSync(join(innerTarget, 'ok.txt'), 'inside')
    const link = join(root, 'alias')
    if (!trySymlink(innerTarget, link, 'dir')) return
    expect(await driver.getString('alias/ok.txt')).toBe('inside')
  })

  test('normal reads, writes and deletes within root still work', async () => {
    await driver.put('docs/readme.txt', 'hello')
    expect(await driver.exists('docs/readme.txt')).toBe(true)
    expect(await driver.getString('docs/readme.txt')).toBe('hello')
    await driver.delete('docs/readme.txt')
    expect(await driver.exists('docs/readme.txt')).toBe(false)
  })

  test('nested directory creation on put still works', async () => {
    await driver.put('a/b/c/d/file.bin', Buffer.from([1, 2, 3]))
    const buf = await driver.get('a/b/c/d/file.bin')
    expect(buf[0]).toBe(1)
    expect(buf[2]).toBe(3)
  })

  test('reading a missing file surfaces a not-found error, not a traversal error', async () => {
    await expect(driver.get('does-not-exist.txt')).rejects.not.toThrow('Path traversal detected')
  })
})

// Exercise the realpath containment logic directly so coverage holds even in
// environments (e.g. unprivileged Windows) where symlink creation is denied
// and the integration tests above skip their assertions.
describe('LocalDriver — realpath containment logic', () => {
  let tmp: string
  let root: string
  let outside: string
  let driver: LocalDriver

  beforeEach(() => {
    tmp = join(os.tmpdir(), `tekir-drive-contain-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    root = join(tmp, 'storage')
    outside = join(tmp, 'secret')
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'passwd'), 'root:x:0:0')
    writeFileSync(join(root, 'ok.txt'), 'inside')
    driver = new LocalDriver(root, '/uploads', 'test-secret-key')
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('a real path inside root passes containment', async () => {
    await expect((driver as any).assertContained('ok.txt', join(root, 'ok.txt'))).resolves.toBeDefined()
  })

  test('a real path outside root is rejected', async () => {
    // Mirrors what a resolved symlink target would look like: a real,
    // existing path that sits outside the configured root.
    await expect((driver as any).assertContained('passwd', join(outside, 'passwd')))
      .rejects.toThrow('Path traversal detected')
  })

  test('a missing leaf inside root is contained via its existing parent', async () => {
    await expect((driver as any).assertContained('new.txt', join(root, 'new.txt'))).resolves.toBeDefined()
  })

  test('a missing leaf under an outside parent is rejected', async () => {
    await expect((driver as any).assertContained('x.txt', join(outside, 'x.txt')))
      .rejects.toThrow('Path traversal detected')
  })

  test('a deep missing path resolves to its nearest existing ancestor', async () => {
    // Nested-but-uncreated path inside root: nearest existing ancestor is
    // root, so it is contained (this is the put() create-dirs scenario).
    await expect((driver as any).assertContained('a/b/c.txt', join(root, 'a', 'b', 'c.txt')))
      .resolves.toBeDefined()
  })
})
