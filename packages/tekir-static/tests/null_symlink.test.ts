import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { resolve, join } from 'path'
import { mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'fs'
import os from 'os'
import { resolveSafePath, realPathContained } from '../src/resolver'

const ROOT = resolve('/app/public')

describe('resolveSafePath — null byte rejection', () => {
  test('rejects an encoded NUL byte', () => {
    const r = resolveSafePath('/file.jpg%00.txt', ROOT)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('malformed')
  })

  test('rejects a NUL combined with traversal', () => {
    const r = resolveSafePath('/%2e%2e/etc/passwd%00.jpg', ROOT)
    expect(r.ok).toBe(false)
    // Either malformed (NUL) or traversal is an acceptable rejection.
    expect(['malformed', 'traversal']).toContain(r.reason!)
  })

  test('rejects a literal NUL byte in the path', () => {
    const r = resolveSafePath('/a\0b.txt', ROOT)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('malformed')
  })

  test('a normal path with no NUL still resolves', () => {
    expect(resolveSafePath('/img/logo.png', ROOT).ok).toBe(true)
  })
})

describe('realPathContained — symlink escape', () => {
  let tmp: string
  let root: string
  let outside: string

  beforeEach(() => {
    tmp = join(os.tmpdir(), `tekir-static-symlink-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    root = join(tmp, 'public')
    outside = join(tmp, 'secret')
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(root, 'ok.txt'), 'safe')
    writeFileSync(join(outside, 'passwd'), 'root:x:0:0')
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('a real file inside the root is contained', async () => {
    expect(await realPathContained(join(root, 'ok.txt'), root)).toBe(true)
  })

  test('a symlink pointing outside the root is not contained', async () => {
    const link = join(root, 'leak')
    try {
      symlinkSync(outside, link, 'dir')
    } catch {
      // Some CI environments forbid symlink creation; skip gracefully.
      return
    }
    expect(await realPathContained(join(link, 'passwd'), root)).toBe(false)
  })

  test('a missing file is treated as contained (no false traversal)', async () => {
    expect(await realPathContained(join(root, 'does-not-exist.txt'), root)).toBe(true)
  })
})
