import { test, expect, describe } from 'bun:test'
import { resolve, relative } from 'path'

function isTraversal(urlPath: string, rootDir = '/app/public'): boolean {
  const root = resolve(rootDir)
  const decoded = decodeURIComponent(urlPath)
  const filePath = resolve(root, decoded.replace(/^\/+/, ''))
  const rel = relative(root, filePath)
  return rel.startsWith('..') || rel.startsWith('/')
}

describe('Static — comprehensive traversal payloads', () => {
  test('simple ../../../etc/passwd', () => { expect(isTraversal('/../../../etc/passwd')).toBe(true) })
  test('URL encoded %2e%2e%2f', () => { expect(isTraversal('/%2e%2e/etc/passwd')).toBe(true) })
  test('mixed encoding', () => { expect(isTraversal('/%2e%2e%2f%2e%2e/etc')).toBe(true) })
  test('backslash on windows', () => { expect(isTraversal('/..\\..\\etc')).toBe(true) })
  test('null byte + traversal', () => { expect(isTraversal('/../etc/passwd%00.jpg')).toBe(true) })
  test('nested valid + traversal', () => { expect(isTraversal('/css/../../etc/passwd')).toBe(true) })
  test('triple nested traversal', () => { expect(isTraversal('/a/b/../../../etc/x')).toBe(true) })

  test('valid /index.html', () => { expect(isTraversal('/index.html')).toBe(false) })
  test('valid /css/style.css', () => { expect(isTraversal('/css/style.css')).toBe(false) })
  test('valid /images/photo.jpg', () => { expect(isTraversal('/images/photo.jpg')).toBe(false) })
  test('valid /deep/a/b/c/file.js', () => { expect(isTraversal('/deep/a/b/c/file.js')).toBe(false) })
  test('valid /file with spaces.txt', () => { expect(isTraversal('/file%20with%20spaces.txt')).toBe(false) })
  test('valid root', () => { expect(isTraversal('/')).toBe(false) })
  test('valid empty', () => { expect(isTraversal('')).toBe(false) })
  test('valid /.hidden', () => { expect(isTraversal('/.hidden')).toBe(false) })
  test('valid /a..b.txt (dots in name)', () => { expect(isTraversal('/a..b.txt')).toBe(false) })

  test('8 levels deep traversal', () => { expect(isTraversal('/../../../../../../../../etc/shadow')).toBe(true) })
  test('traversal with query string (path only)', () => { expect(isTraversal('/../etc/passwd')).toBe(true) })
  test('unicode path stays valid', () => { expect(isTraversal('/%C3%BC%C3%B6%C3%A4.txt')).toBe(false) })
  test('hash in path', () => { expect(isTraversal('/file%23name.txt')).toBe(false) })
})
