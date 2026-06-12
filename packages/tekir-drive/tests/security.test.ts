import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { LocalDriver } from '../src/drivers/local'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `tekir-drive-security-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('LocalDriver — path traversal prevention', () => {
  let tmpDir: string
  let driver: LocalDriver

  beforeEach(() => {
    tmpDir = makeTempDir()
    driver = new LocalDriver(tmpDir, '/uploads', 'test-secret-key')
  })

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  test('rejects ../ traversal', () => {
    expect(() => (driver as any).resolve('../../../etc/passwd')).toThrow('Path traversal detected')
  })

  test('rejects ../../ deep traversal', () => {
    expect(() => (driver as any).resolve('../../../../../../etc/shadow')).toThrow('Path traversal detected')
  })

  test('rejects absolute path outside root', () => {
    expect(() => (driver as any).resolve('/etc/passwd')).toThrow('Path traversal detected')
  })

  test('rejects encoded traversal', () => {
    expect(() => (driver as any).resolve('..%2F..%2Fetc/passwd')).toThrow('Path traversal detected')
  })

  test('rejects backslash traversal', () => {
    expect(() => (driver as any).resolve('..\\..\\etc\\passwd')).toThrow('Path traversal detected')
  })

  test('allows valid nested paths', () => {
    expect(() => (driver as any).resolve('uploads/images/photo.jpg')).not.toThrow()
  })

  test('allows simple filenames', () => {
    expect(() => (driver as any).resolve('file.txt')).not.toThrow()
  })

  test('allows deep nested paths', () => {
    expect(() => (driver as any).resolve('a/b/c/d/e/file.txt')).not.toThrow()
  })

  test('put with traversal throws', async () => {
    await expect(driver.put('../../malicious.txt', 'evil')).rejects.toThrow('Path traversal detected')
  })

  test('get with traversal throws', async () => {
    await expect(driver.get('../../../etc/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('delete with traversal throws', async () => {
    await expect(driver.delete('../../important.db')).rejects.toThrow('Path traversal detected')
  })

  test('exists with traversal throws', async () => {
    await expect(driver.exists('../../etc/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('copy source with traversal throws', async () => {
    await driver.put('safe.txt', 'data')
    await expect(driver.copy('../../etc/passwd', 'stolen.txt')).rejects.toThrow('Path traversal detected')
  })

  test('copy dest with traversal throws', async () => {
    await driver.put('safe.txt', 'data')
    await expect(driver.copy('safe.txt', '../../malicious.txt')).rejects.toThrow('Path traversal detected')
  })

  test('move source with traversal throws', async () => {
    await expect(driver.move('../../etc/passwd', 'stolen.txt')).rejects.toThrow('Path traversal detected')
  })

  test('move dest with traversal throws', async () => {
    await driver.put('safe.txt', 'data')
    await expect(driver.move('safe.txt', '../../malicious.txt')).rejects.toThrow('Path traversal detected')
  })

  test('getMetadata with traversal throws', async () => {
    await expect(driver.getMetadata('../../etc/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('mid-path traversal is caught', () => {
    expect(() => (driver as any).resolve('uploads/../../etc/passwd')).toThrow('Path traversal detected')
  })

  test('normal file operations work end-to-end', async () => {
    await driver.put('test.txt', 'hello')
    expect(await driver.exists('test.txt')).toBe(true)
    const content = await driver.getString('test.txt')
    expect(content).toBe('hello')
    await driver.delete('test.txt')
    expect(await driver.exists('test.txt')).toBe(false)
  })

  test('nested directory operations work', async () => {
    await driver.put('photos/2024/jan/photo.jpg', 'image-data')
    expect(await driver.exists('photos/2024/jan/photo.jpg')).toBe(true)
  })

  test('getStream with traversal throws', async () => {
    await expect(driver.getStream('../../etc/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('getString with traversal throws', async () => {
    await expect(driver.getString('../../etc/passwd')).rejects.toThrow('Path traversal detected')
  })

  test('list with traversal prefix throws', async () => {
    await expect(driver.list('../../etc')).rejects.toThrow('Path traversal detected')
  })

  test('getUrl does not validate (URL generation only)', () => {
    const url = driver.getUrl('file.txt')
    expect(url).toBe('/uploads/file.txt')
  })

  test('copy within same directory works', async () => {
    await driver.put('src.txt', 'data')
    await driver.copy('src.txt', 'dst.txt')
    expect(await driver.getString('dst.txt')).toBe('data')
  })

  test('move within same directory works', async () => {
    await driver.put('before.txt', 'content')
    await driver.move('before.txt', 'after.txt')
    expect(await driver.exists('before.txt')).toBe(false)
    expect(await driver.getString('after.txt')).toBe('content')
  })

  test('put with buffer content', async () => {
    await driver.put('binary.bin', Buffer.from([0xFF, 0x00, 0xAB]))
    const buf = await driver.get('binary.bin')
    expect(buf[0]).toBe(0xFF)
    expect(buf[1]).toBe(0x00)
    expect(buf[2]).toBe(0xAB)
  })

  test('getMetadata returns size and date', async () => {
    await driver.put('meta.txt', 'hello world')
    const meta = await driver.getMetadata('meta.txt')
    expect(meta.size).toBe(11)
    expect(meta.lastModified).toBeInstanceOf(Date)
  })

  test('getSignedUrl returns URL with token', async () => {
    await driver.put('secret.pdf', 'data')
    const url = await driver.getSignedUrl('secret.pdf', { expiresIn: 60 })
    expect(url).toContain('token=')
    expect(url).toContain('expires=')
  })

  test('verifySignedUrl accepts a fresh signature', async () => {
    const url = await driver.getSignedUrl('secret.pdf', { expiresIn: 60 })
    const params = new URLSearchParams(url.split('?')[1])
    expect(driver.verifySignedUrl('secret.pdf', params.get('token')!, params.get('expires')!)).toBe(true)
  })

  test('verifySignedUrl rejects a forged token', async () => {
    const url = await driver.getSignedUrl('secret.pdf', { expiresIn: 60 })
    const params = new URLSearchParams(url.split('?')[1])
    const forged = Buffer.from('attacker').toString('base64url')
    expect(driver.verifySignedUrl('secret.pdf', forged, params.get('expires')!)).toBe(false)
  })

  test('verifySignedUrl rejects a tampered key', async () => {
    const url = await driver.getSignedUrl('secret.pdf', { expiresIn: 60 })
    const params = new URLSearchParams(url.split('?')[1])
    expect(driver.verifySignedUrl('other.pdf', params.get('token')!, params.get('expires')!)).toBe(false)
  })

  test('verifySignedUrl rejects an expired URL', () => {
    const past = Date.now() - 1000
    const url = `/uploads/secret.pdf?token=${Buffer.from('whatever').toString('base64url')}&expires=${past}`
    const params = new URLSearchParams(url.split('?')[1])
    expect(driver.verifySignedUrl('secret.pdf', params.get('token')!, params.get('expires')!)).toBe(false)
  })

  test('getSignedUrl throws when no secret is configured', async () => {
    const naked = new LocalDriver(tmpDir, '/uploads', '')
    await expect(naked.getSignedUrl('x.pdf', { expiresIn: 60 })).rejects.toThrow('signed URLs require a secret')
  })

  test('overwrite existing file', async () => {
    await driver.put('over.txt', 'first')
    await driver.put('over.txt', 'second')
    expect(await driver.getString('over.txt')).toBe('second')
  })

  test('delete nonexistent file does not throw', async () => {
    await expect(driver.delete('ghost.txt')).resolves.toBeUndefined()
  })
})
