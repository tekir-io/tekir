import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { LocalDriver } from '../src/drivers/local'
import { serveDrive } from '../src/serve'
import {
  sanitizeFilename, getExtension, validateUpload, assertValidUpload, UploadValidationError,
} from '../src/validation'

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `tekir-drive-serve-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('serveDrive — signed-URL enforcement', () => {
  let tmp: string
  let driver: LocalDriver
  let handler: (req: Request) => Promise<Response | null>

  beforeEach(async () => {
    tmp = makeTempDir()
    driver = new LocalDriver(tmp, '/uploads', 'serve-secret')
    await driver.put('private/report.pdf', 'CONFIDENTIAL')
    handler = serveDrive({ driver, urlPrefix: '/uploads' })
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('rejects an unsigned request for a private file with 403', async () => {
    const res = await handler(new Request('http://x/uploads/private/report.pdf'))
    expect(res!.status).toBe(403)
  })

  test('serves the file when a valid signed URL is presented', async () => {
    const signed = await driver.getSignedUrl('private/report.pdf', { expiresIn: 60 })
    const res = await handler(new Request('http://x' + signed))
    expect(res!.status).toBe(200)
    expect(await res!.text()).toBe('CONFIDENTIAL')
  })

  test('rejects a forged token', async () => {
    const expires = Date.now() + 60_000
    const forged = Buffer.from('attacker').toString('base64url')
    const res = await handler(new Request(`http://x/uploads/private/report.pdf?token=${forged}&expires=${expires}`))
    expect(res!.status).toBe(403)
  })

  test('rejects an expired token', async () => {
    const signed = await driver.getSignedUrl('private/report.pdf', { expiresIn: 60 })
    const url = new URL('http://x' + signed)
    url.searchParams.set('expires', String(Date.now() - 1000))
    const res = await handler(new Request(url.toString()))
    expect(res!.status).toBe(403)
  })

  test('a signature for a different key does not unlock this file', async () => {
    const signed = await driver.getSignedUrl('private/report.pdf', { expiresIn: 60 })
    const params = new URL('http://x' + signed).search
    // Reuse the token but point at a different path.
    const res = await handler(new Request('http://x/uploads/other.pdf' + params))
    expect(res!.status).toBe(403)
  })

  test('falls through (null) for paths outside the prefix', async () => {
    const res = await handler(new Request('http://x/api/users'))
    expect(res).toBeNull()
  })

  test('encoded traversal in the path is rejected', async () => {
    const signed = await driver.getSignedUrl('private/report.pdf', { expiresIn: 60 })
    const params = new URL('http://x' + signed).search
    // %2e%2e survives URL normalization and decodes to `..` inside the handler.
    const res = await handler(new Request('http://x/uploads/%2e%2e/%2e%2e/etc/passwd' + params))
    // Either a fall-through (null, normalized out of the prefix) or a non-200
    // denial — never a successful read of a file outside the root.
    if (res !== null) expect(res.status).not.toBe(200)
  })

  test('public mode serves without a signature when requireSignature is false', async () => {
    const pub = serveDrive({ driver, urlPrefix: '/uploads', requireSignature: false })
    const res = await pub(new Request('http://x/uploads/private/report.pdf'))
    expect(res!.status).toBe(200)
    expect(await res!.text()).toBe('CONFIDENTIAL')
  })
})

describe('LocalDriver — null byte and URL encoding', () => {
  let tmp: string
  let driver: LocalDriver

  beforeEach(() => {
    tmp = makeTempDir()
    driver = new LocalDriver(tmp, '/uploads', 'k')
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('resolve rejects a null byte in the key', () => {
    expect(() => (driver as any).resolve('a\0b.txt')).toThrow('Path traversal detected')
  })

  test('put with a null-byte key throws', async () => {
    await expect(driver.put('evil\0.txt', 'x')).rejects.toThrow('Path traversal detected')
  })

  test('getUrl validates and encodes the key', () => {
    expect(driver.getUrl('a b/c.txt')).toBe('/uploads/a%20b/c.txt')
  })

  test('getUrl on a traversal key throws', () => {
    expect(() => driver.getUrl('../escape.txt')).toThrow('Path traversal detected')
  })

  test('getSignedUrl encodes the path but signs the raw key', async () => {
    await driver.put('my file.pdf', 'data')
    const url = await driver.getSignedUrl('my file.pdf', { expiresIn: 60 })
    expect(url).toContain('/uploads/my%20file.pdf')
    const params = new URLSearchParams(url.split('?')[1])
    // Verification uses the raw (decoded) key.
    expect(driver.verifySignedUrl('my file.pdf', params.get('token')!, params.get('expires')!)).toBe(true)
  })
})

describe('upload validation helpers', () => {
  test('sanitizeFilename strips directory components', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('a/b/c.txt')).toBe('c.txt')
    expect(sanitizeFilename('foo\\bar.png')).toBe('bar.png')
  })

  test('sanitizeFilename neutralizes traversal and dotfiles', () => {
    expect(sanitizeFilename('..')).toBe('file')
    expect(sanitizeFilename('.env')).toBe('env')
    expect(sanitizeFilename('...hidden')).toBe('hidden')
  })

  test('sanitizeFilename removes control/null bytes and unsafe chars', () => {
    expect(sanitizeFilename('a\0b\tc.txt')).toBe('abc.txt')
    expect(sanitizeFilename('na me$.png')).toBe('na_me_.png')
  })

  test('sanitizeFilename never returns empty', () => {
    expect(sanitizeFilename('')).toBe('file')
    expect(sanitizeFilename('///')).toBe('file')
  })

  test('getExtension returns lowercased extension', () => {
    expect(getExtension('Photo.JPG')).toBe('jpg')
    expect(getExtension('archive.tar.gz')).toBe('gz')
    expect(getExtension('noext')).toBe('')
    expect(getExtension('.env')).toBe('')
  })

  test('validateUpload enforces extension allowlist', () => {
    const opts = { allowedExtensions: ['jpg', '.png'] }
    expect(validateUpload('a.jpg', 10, opts).ok).toBe(true)
    expect(validateUpload('a.png', 10, opts).ok).toBe(true)
    expect(validateUpload('a.html', 10, opts).ok).toBe(false)
    expect(validateUpload('a.js', 10, opts).ok).toBe(false)
    expect(validateUpload('noext', 10, opts).ok).toBe(false)
  })

  test('validateUpload enforces max size', () => {
    expect(validateUpload('a.jpg', 100, { maxSize: 50 }).ok).toBe(false)
    expect(validateUpload('a.jpg', 50, { maxSize: 50 }).ok).toBe(true)
  })

  test('assertValidUpload throws UploadValidationError on failure', () => {
    expect(() => assertValidUpload('a.exe', 10, { allowedExtensions: ['jpg'] })).toThrow(UploadValidationError)
  })

  test('no options means anything is allowed', () => {
    expect(validateUpload('a.exe', 999999, {}).ok).toBe(true)
  })
})

describe('LocalDriver — upload enforcement via constructor', () => {
  let tmp: string

  beforeEach(() => { tmp = makeTempDir() })
  afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }) })

  test('put rejects a disallowed extension', async () => {
    const d = new LocalDriver(tmp, '/uploads', 'k', { allowedExtensions: ['jpg', 'png'] })
    await expect(d.put('evil.html', '<script>')).rejects.toThrow(UploadValidationError)
  })

  test('put rejects content over maxSize', async () => {
    const d = new LocalDriver(tmp, '/uploads', 'k', { maxSize: 5 })
    await expect(d.put('big.txt', 'way too long')).rejects.toThrow(UploadValidationError)
  })

  test('put allows a valid upload within limits', async () => {
    const d = new LocalDriver(tmp, '/uploads', 'k', { allowedExtensions: ['txt'], maxSize: 100 })
    await d.put('ok.txt', 'hello')
    expect(await d.getString('ok.txt')).toBe('hello')
  })

  test('streaming put enforces maxSize', async () => {
    const d = new LocalDriver(tmp, '/uploads', 'k', { maxSize: 4 })
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('abcdefgh')); c.close() },
    })
    await expect(d.put('s.bin', stream)).rejects.toThrow(UploadValidationError)
  })

  test('driver with no upload options stays backward compatible', async () => {
    const d = new LocalDriver(tmp, '/uploads', 'k')
    await d.put('anything.exe', 'x')
    expect(await d.exists('anything.exe')).toBe(true)
  })
})
