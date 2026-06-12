import { test, expect, describe } from 'bun:test'
import { resolve } from 'path'
import { resolveSafePath } from '../src/resolver'

const ROOT = resolve('/app/public')

describe('resolveSafePath — happy paths', () => {
  test('resolves a flat file', () => {
    const r = resolveSafePath('/index.html', ROOT)
    expect(r.ok).toBe(true)
    expect(r.path).toBe(resolve(ROOT, 'index.html'))
  })

  test('resolves a nested file', () => {
    expect(resolveSafePath('/css/app.css', ROOT).ok).toBe(true)
  })

  test('decodes percent-encoded spaces', () => {
    const r = resolveSafePath('/my%20file.txt', ROOT)
    expect(r.ok).toBe(true)
    expect(r.path).toBe(resolve(ROOT, 'my file.txt'))
  })
})

describe('resolveSafePath — malformed encoding', () => {
  test('returns malformed for an unterminated percent', () => {
    const r = resolveSafePath('/%E0%A4%A', ROOT)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('malformed')
  })

  test('returns malformed for a bare %', () => {
    const r = resolveSafePath('/foo%', ROOT)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('malformed')
  })
})

describe('resolveSafePath — traversal', () => {
  test('rejects ../', () => {
    expect(resolveSafePath('/../etc/passwd', ROOT).reason).toBe('traversal')
  })

  test('rejects mid-path traversal', () => {
    expect(resolveSafePath('/css/../../etc/passwd', ROOT).reason).toBe('traversal')
  })

  test('rejects encoded ../', () => {
    expect(resolveSafePath('/%2e%2e/etc/passwd', ROOT).reason).toBe('traversal')
  })
})

describe('resolveSafePath — dotfile policy', () => {
  test('rejects /.env by default', () => {
    expect(resolveSafePath('/.env', ROOT).reason).toBe('dotfile')
  })

  test('rejects /.git/config by default', () => {
    expect(resolveSafePath('/.git/config', ROOT).reason).toBe('dotfile')
  })

  test('rejects /assets/.private/file by default', () => {
    expect(resolveSafePath('/assets/.private/file', ROOT).reason).toBe('dotfile')
  })

  test('rejects /.well-known/x by default (single allowlist policy lives in caller)', () => {
    expect(resolveSafePath('/.well-known/health', ROOT).reason).toBe('dotfile')
  })

  test('allow policy lets dot segments through', () => {
    expect(resolveSafePath('/.env', ROOT, 'allow').ok).toBe(true)
    expect(resolveSafePath('/.git/config', ROOT, 'allow').ok).toBe(true)
  })

  test('deny policy still flags dot segments', () => {
    expect(resolveSafePath('/.env', ROOT, 'deny').reason).toBe('dotfile')
  })

  test('non-dot segments like /assets/file.html are not flagged', () => {
    expect(resolveSafePath('/assets/file.html', ROOT).ok).toBe(true)
  })

  test('rejects encoded-backslash dotfile bypass on Windows', () => {
    // %5C decodes to `\`, which Windows resolves as a path separator.
    expect(resolveSafePath('/assets%5c.git/config', ROOT).reason).toBe('dotfile')
    expect(resolveSafePath('/assets%5C.git/config', ROOT).reason).toBe('dotfile')
  })

  test('rejects literal-backslash dotfile bypass on Windows', () => {
    expect(resolveSafePath('/assets\\.git/config', ROOT).reason).toBe('dotfile')
  })
})
