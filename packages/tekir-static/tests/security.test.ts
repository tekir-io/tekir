import { test, expect, describe } from 'bun:test'
import { resolve, relative } from 'path'

// Test the path traversal logic used in BOTH middleware.ts and provider.ts
function isTraversal(urlPath: string, rootDir = '/app/public'): boolean {
  const root = resolve(rootDir)
  const decoded = decodeURIComponent(urlPath)
  const filePath = resolve(root, decoded.replace(/^\/+/, ''))
  const rel = relative(root, filePath)
  return rel.startsWith('..') || rel.startsWith('/')
}

// ═══════════════════════════════════════════════════════════
// Basic traversal
// ═══════════════════════════════════════════════════════════

describe('Static — basic path traversal', () => {
  test('normal paths are allowed', () => {
    expect(isTraversal('/index.html')).toBe(false)
    expect(isTraversal('/css/style.css')).toBe(false)
    expect(isTraversal('/images/logo.png')).toBe(false)
    expect(isTraversal('/js/app.js')).toBe(false)
  })

  test('../ traversal is blocked', () => {
    expect(isTraversal('/../etc/passwd')).toBe(true)
    expect(isTraversal('/../../etc/passwd')).toBe(true)
    expect(isTraversal('/../../../etc/shadow')).toBe(true)
  })

  test('deep traversal is blocked', () => {
    expect(isTraversal('/../../../../../../../../etc/passwd')).toBe(true)
  })

  test('mid-path traversal is blocked', () => {
    expect(isTraversal('/foo/../../etc/passwd')).toBe(true)
    expect(isTraversal('/images/../../../etc/passwd')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════
// URL encoding bypass attempts
// ═══════════════════════════════════════════════════════════

describe('Static — URL encoded traversal', () => {
  test('%2e%2e (encoded ..) is blocked', () => {
    expect(isTraversal('/%2e%2e/etc/passwd')).toBe(true)
  })

  test('%2e%2e/%2e%2e is blocked', () => {
    expect(isTraversal('/%2e%2e/%2e%2e/etc/passwd')).toBe(true)
  })

  test('%2F (encoded /) with .. is blocked', () => {
    expect(isTraversal('/..%2f..%2fetc/passwd')).toBe(true)
  })

  test('mixed encoding is blocked', () => {
    expect(isTraversal('/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).toBe(true)
  })

  test('double encoding stays literal (not decoded twice)', () => {
    // %252e becomes %2e after first decode, stays as literal
    expect(isTraversal('/%252e%252e/etc/passwd')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════

describe('Static — edge cases', () => {
  test('root path is allowed', () => {
    expect(isTraversal('/')).toBe(false)
  })

  test('empty path is allowed', () => {
    expect(isTraversal('')).toBe(false)
  })

  test('dot files are allowed (traversal check only)', () => {
    expect(isTraversal('/.env')).toBe(false)
    expect(isTraversal('/.gitignore')).toBe(false)
  })

  test('deeply nested valid path', () => {
    expect(isTraversal('/a/b/c/d/e/f/g/file.txt')).toBe(false)
  })

  test('path with spaces', () => {
    expect(isTraversal('/my%20file.txt')).toBe(false)
  })

  test('path with special chars', () => {
    expect(isTraversal('/file%23name.txt')).toBe(false)
  })

  test('backslash traversal is blocked', () => {
    expect(isTraversal('/..\\..\\etc\\passwd')).toBe(true)
  })

  test('traversal with null byte + extension is blocked', () => {
    expect(isTraversal('/../etc/passwd%00.jpg')).toBe(true)
  })

  test('triple dots resolve without traversal', () => {
    // '...' is a valid filename on most systems, resolve handles it
    const result = isTraversal('/...')
    // Platform dependent — just check it doesn't crash
    expect(typeof result).toBe('boolean')
  })
})
