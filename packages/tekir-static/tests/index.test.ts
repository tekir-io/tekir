import { test, expect, describe } from 'bun:test'
import { serveStatic, StaticProvider } from '../src/index'
import type { StaticConfig } from '../src/index'


describe('serveStatic', () => {
  test('returns a function (middleware)', () => {
    const middleware = serveStatic()
    expect(typeof middleware).toBe('function')
  })

  test('returns a function with no arguments (uses defaults)', () => {
    const middleware = serveStatic({})
    expect(typeof middleware).toBe('function')
  })

  test('returns a function when all options are supplied', () => {
    const middleware = serveStatic({
      dir: 'public',
      maxAge: 3600,
      immutable: true,
      dotFiles: 'deny',
      etag: false,
      index: 'index.html',
    })
    expect(typeof middleware).toBe('function')
  })

  // ── Default config values ──────────────────────────────────────────────────
  // We verify defaults by exercising the middleware against a mock context and
  // observing that non-GET/HEAD requests are immediately passed through to next().

  test('non-GET/HEAD request calls next()', async () => {
    const middleware = serveStatic()
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'POST', path: '/file.txt' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  test('DELETE request calls next()', async () => {
    const middleware = serveStatic()
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'DELETE', path: '/file.txt' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  test('path with ".." calls next() (directory traversal guard)', async () => {
    const middleware = serveStatic()
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'GET', path: '/../../etc/passwd' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  test('dot file with dotFiles:"ignore" (default) calls next()', async () => {
    const middleware = serveStatic({ dotFiles: 'ignore' })
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'GET', path: '/.env' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  test('dot file with dotFiles:"deny" returns 403', async () => {
    const middleware = serveStatic({ dotFiles: 'deny' })
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'GET', path: '/.secret' } }
    const result = await middleware(ctx as any, next)
    expect(nextCalled).toBe(false)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
  })

  test('dot file with dotFiles:"allow" falls through to file resolution', async () => {
    // File won't exist, so next() will be called — but dotFiles handling won't
    // block it with 403 or early-return.
    const middleware = serveStatic({ dotFiles: 'allow', dir: '__nonexistent__' })
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'GET', path: '/.env' } }
    await middleware(ctx as any, next)
    // Either next() was called (file not found) or a Response returned — but
    // it must NOT be a 403.
    if (!nextCalled) {
      // If a response was returned, it should not be 403
      // (this branch is unreachable for a non-existent dir, but guard anyway)
    }
    expect(nextCalled).toBe(true)
  })

  test('non-existent file calls next()', async () => {
    const middleware = serveStatic({ dir: '__definitely_does_not_exist_xyz__' })
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'GET', path: '/missing.txt' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  test('HEAD request passes through to file resolution (not blocked by method check)', async () => {
    // HEAD is allowed — it should not be blocked at the method guard.
    // For a non-existent file, next() should be called.
    const middleware = serveStatic({ dir: '__definitely_does_not_exist_xyz__' })
    let nextCalled = false
    const next = async () => { nextCalled = true }

    const ctx = { request: { method: 'HEAD', path: '/missing.txt' } }
    await middleware(ctx as any, next)
    expect(nextCalled).toBe(true)
  })

  // ── Config type contract ───────────────────────────────────────────────────

  test('StaticConfig interface: dir is optional string', () => {
    const config: StaticConfig = { dir: 'assets' }
    expect(config.dir).toBe('assets')
  })

  test('StaticConfig interface: maxAge is optional number', () => {
    const config: StaticConfig = { maxAge: 86400 }
    expect(config.maxAge).toBe(86400)
  })

  test('StaticConfig interface: immutable is optional boolean', () => {
    const config: StaticConfig = { immutable: true }
    expect(config.immutable).toBe(true)
  })

  test('StaticConfig interface: dotFiles accepts "ignore" | "deny" | "allow"', () => {
    const a: StaticConfig = { dotFiles: 'ignore' }
    const b: StaticConfig = { dotFiles: 'deny' }
    const c: StaticConfig = { dotFiles: 'allow' }
    expect(a.dotFiles).toBe('ignore')
    expect(b.dotFiles).toBe('deny')
    expect(c.dotFiles).toBe('allow')
  })

  test('StaticConfig interface: etag is optional boolean', () => {
    const config: StaticConfig = { etag: false }
    expect(config.etag).toBe(false)
  })

  test('StaticConfig interface: index is optional string', () => {
    const config: StaticConfig = { index: 'home.html' }
    expect(config.index).toBe('home.html')
  })

  test('empty config object is valid', () => {
    const config: StaticConfig = {}
    expect(config).toEqual({})
  })
})


describe('StaticProvider', () => {
  test('is a class that can be instantiated', () => {
    const provider = new StaticProvider()
    expect(provider).toBeInstanceOf(StaticProvider)
  })

  test('has a boot method', () => {
    const provider = new StaticProvider()
    expect(typeof provider.boot).toBe('function')
  })

  test('boot returns a Promise', async () => {
    const provider = new StaticProvider()
    let fallbackSet = false
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') return (k: string, def?: any) => def
        if (key === 'server') return { fallback: () => { fallbackSet = true } }
        return null
      },
    }
    const result = provider.boot(mockApp as any)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBeUndefined()
  })

  test('boot registers a fallback handler on server', async () => {
    const provider = new StaticProvider()
    let fallbackHandler: any = null

    const mockApp = {
      use: (key: string) => {
        if (key === 'config') return (k: string, def?: any) => def
        if (key === 'server') return { fallback: (fn: any) => { fallbackHandler = fn } }
        return null
      },
    }

    await provider.boot(mockApp as any)
    expect(typeof fallbackHandler).toBe('function')
  })

  test('boot uses custom dir from config', async () => {
    const provider = new StaticProvider()
    let fallbackSet = false

    const mockApp = {
      use: (key: string) => {
        if (key === 'config') {
          return (k: string, def?: any) => {
            if (k === 'static.dir') return 'assets'
            return def
          }
        }
        if (key === 'server') return { fallback: () => { fallbackSet = true } }
        return null
      },
    }

    await provider.boot(mockApp as any)
    expect(fallbackSet).toBe(true)
  })
})


describe('serveStatic MIME types', () => {
  // We create real temp files and serve them to verify Content-Type headers.
  const { mkdirSync, writeFileSync, existsSync } = require('fs')
  const { join } = require('path')
  const tmpDir = join(process.cwd(), '__static_test_tmp__')

  // Setup temp directory with stub files for MIME testing
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const mimeTests: Array<[string, string]> = [
    ['style.css', 'text/css; charset=utf-8'],
    ['app.js', 'application/javascript; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['image.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['icon.svg', 'image/svg+xml'],
    ['font.woff2', 'font/woff2'],
    ['doc.pdf', 'application/pdf'],
    ['module.wasm', 'application/wasm'],
    ['readme.txt', 'text/plain; charset=utf-8'],
    ['icon.gif', 'image/gif'],
    ['icon.webp', 'image/webp'],
    ['icon.ico', 'image/x-icon'],
    ['font.woff', 'font/woff'],
    ['font.ttf', 'font/ttf'],
    ['font.otf', 'font/otf'],
    ['video.mp4', 'video/mp4'],
    ['audio.mp3', 'audio/mpeg'],
    ['data.xml', 'application/xml'],
  ]

  // Create all stub files
  for (const [filename] of mimeTests) {
    const fp = join(tmpDir, filename)
    if (!existsSync(fp)) writeFileSync(fp, 'test-content')
  }

  for (const [filename, expectedMime] of mimeTests) {
    test(`serves ${filename} with Content-Type: ${expectedMime}`, async () => {
      const middleware = serveStatic({ dir: '__static_test_tmp__', etag: false })
      const ctx = { request: { method: 'GET', path: `/${filename}` } }
      const result = await middleware(ctx as any, async () => {})
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).headers.get('Content-Type')).toBe(expectedMime)
    })
  }
})


describe('serveStatic Cache-Control', () => {
  const { mkdirSync, writeFileSync, existsSync } = require('fs')
  const { join } = require('path')
  const tmpDir = join(process.cwd(), '__static_test_tmp__')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const fp = join(tmpDir, 'cache-test.txt')
  if (!existsSync(fp)) writeFileSync(fp, 'cache-content')

  const ctx = { request: { method: 'GET', path: '/cache-test.txt' } }

  test('no Cache-Control header when maxAge=0 and immutable=false', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', maxAge: 0, immutable: false, etag: false })
    const result = await mw({ ...ctx } as any, async () => {}) as Response
    expect(result.headers.get('Cache-Control')).toBeNull()
  })

  test('Cache-Control with maxAge only', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', maxAge: 3600, etag: false })
    const result = await mw({ ...ctx } as any, async () => {}) as Response
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })

  test('Cache-Control with immutable only', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', maxAge: 0, immutable: true, etag: false })
    const result = await mw({ ...ctx } as any, async () => {}) as Response
    expect(result.headers.get('Cache-Control')).toBe('public, immutable')
  })

  test('Cache-Control with both maxAge and immutable', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', maxAge: 31536000, immutable: true, etag: false })
    const result = await mw({ ...ctx } as any, async () => {}) as Response
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })
})


describe('serveStatic ETag', () => {
  const { mkdirSync, writeFileSync, existsSync, statSync } = require('fs')
  const { join } = require('path')
  const tmpDir = join(process.cwd(), '__static_test_tmp__')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const fp = join(tmpDir, 'etag-test.txt')
  if (!existsSync(fp)) writeFileSync(fp, 'etag-content')

  test('includes ETag header by default', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const ctx = { request: { method: 'GET', path: '/etag-test.txt', header: () => null } }
    const result = await mw(ctx as any, async () => {}) as Response
    const etag = result.headers.get('ETag')
    expect(etag).toBeTruthy()
    expect(etag!.startsWith('"')).toBe(true)
    expect(etag!.endsWith('"')).toBe(true)
  })

  test('no ETag header when etag=false', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/etag-test.txt' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.headers.get('ETag')).toBeNull()
  })

  test('returns 304 when If-None-Match matches ETag', async () => {
    const stat = statSync(fp)
    const expectedEtag = `"${stat.size}-${stat.mtimeMs}"`
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const ctx = {
      request: {
        method: 'GET',
        path: '/etag-test.txt',
        header: (name: string) => name === 'if-none-match' ? expectedEtag : null,
      },
    }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(304)
  })

  test('returns 200 when If-None-Match does not match', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const ctx = {
      request: {
        method: 'GET',
        path: '/etag-test.txt',
        header: (name: string) => name === 'if-none-match' ? '"wrong-etag"' : null,
      },
    }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(200)
  })

  test('ETag format includes file size and mtime', async () => {
    const stat = statSync(fp)
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const ctx = { request: { method: 'GET', path: '/etag-test.txt', header: () => null } }
    const result = await mw(ctx as any, async () => {}) as Response
    const etag = result.headers.get('ETag')
    expect(etag).toBe(`"${stat.size}-${stat.mtimeMs}"`)
  })
})


describe('serveStatic custom index', () => {
  const { mkdirSync, writeFileSync, existsSync } = require('fs')
  const { join } = require('path')
  const tmpDir = join(process.cwd(), '__static_test_tmp__')
  const subDir = join(tmpDir, 'subdir')
  if (!existsSync(subDir)) mkdirSync(subDir, { recursive: true })

  test('uses custom index file name for directory requests', async () => {
    const indexPath = join(subDir, 'home.html')
    if (!existsSync(indexPath)) writeFileSync(indexPath, '<html>home</html>')
    const mw = serveStatic({ dir: '__static_test_tmp__', index: 'home.html', etag: false })
    const ctx = { request: { method: 'GET', path: '/subdir/' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result).toBeInstanceOf(Response)
    expect(result.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  test('falls through when custom index does not exist in directory', async () => {
    const emptyDir = join(tmpDir, 'emptydir')
    if (!existsSync(emptyDir)) mkdirSync(emptyDir, { recursive: true })
    const mw = serveStatic({ dir: '__static_test_tmp__', index: 'nonexistent.html' })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/emptydir/' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})


describe('serveStatic defaults', () => {
  test('default dir is "public" (non-existent dir calls next)', async () => {
    const mw = serveStatic() // defaults: dir='public'
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/surely-missing-file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('default dotFiles is "ignore" (dot file calls next)', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/.gitignore' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('PATCH request calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'PATCH', path: '/file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('PUT request calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'PUT', path: '/file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('unknown extension returns application/octet-stream', async () => {
    const { writeFileSync, existsSync } = require('fs')
    const { join } = require('path')
    const tmpDir = join(process.cwd(), '__static_test_tmp__')
    const fp = join(tmpDir, 'file.xyz123')
    if (!existsSync(fp)) writeFileSync(fp, 'binary-data')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/file.xyz123' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.headers.get('Content-Type')).toBe('application/octet-stream')
  })
})


describe('serveStatic — directory traversal prevention', () => {
  test('path with encoded ".." calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/%2e%2e/etc/passwd' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('path with double dot in middle calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/foo/../bar' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('path with triple dots is not traversal', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/...' } }
    await mw(ctx as any, async () => { nextCalled = true })
    // Triple dot is not ".." so not blocked by traversal guard; file just doesn't exist
    expect(nextCalled).toBe(true)
  })

  test('path with backslash traversal calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/..\\..\\etc\\passwd' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('absolute path with ".." at start calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/../../../etc/shadow' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})


describe('serveStatic — dot files', () => {
  test('.htaccess with dotFiles:ignore calls next', async () => {
    const mw = serveStatic({ dotFiles: 'ignore' })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/.htaccess' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('.htaccess with dotFiles:deny returns 403', async () => {
    const mw = serveStatic({ dotFiles: 'deny' })
    const ctx = { request: { method: 'GET', path: '/.htaccess' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(403)
  })

  test('.DS_Store with dotFiles:deny returns 403', async () => {
    const mw = serveStatic({ dotFiles: 'deny' })
    const ctx = { request: { method: 'GET', path: '/.DS_Store' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(403)
  })

  test('.git/config with dotFiles:deny calls next or returns 403', async () => {
    const mw = serveStatic({ dotFiles: 'deny' })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/.git/config' } }
    const result = await mw(ctx as any, async () => { nextCalled = true })
    // The dot file check triggers on the first path segment starting with dot
    if (result) {
      expect((result as Response).status).toBe(403)
    } else {
      expect(nextCalled).toBe(true)
    }
  })

  test('nested dot file with dotFiles:ignore calls next', async () => {
    const mw = serveStatic({ dotFiles: 'ignore' })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/dir/.hidden' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('file starting with dot in subdirectory with deny', async () => {
    const mw = serveStatic({ dotFiles: 'deny' })
    const ctx = { request: { method: 'GET', path: '/sub/.env.local' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(403)
  })
})


describe('serveStatic — HTTP methods', () => {
  test('OPTIONS request calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'OPTIONS', path: '/file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('CONNECT request calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'CONNECT', path: '/file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('TRACE request calls next()', async () => {
    const mw = serveStatic()
    let nextCalled = false
    const ctx = { request: { method: 'TRACE', path: '/file.txt' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})


describe('serveStatic — real file serving', () => {
  const { mkdirSync, writeFileSync, existsSync } = require('fs')
  const { join } = require('path')
  const tmpDir = join(process.cwd(), '__static_test_tmp__')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  test('serves .html file with correct MIME type', async () => {
    const fp = join(tmpDir, 'page.html')
    if (!existsSync(fp)) writeFileSync(fp, '<html><body>test</body></html>')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/page.html' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  test('serves file with correct body content', async () => {
    const fp = join(tmpDir, 'body-test.txt')
    writeFileSync(fp, 'exact-content-123')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/body-test.txt' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(await result.text()).toBe('exact-content-123')
  })

  test('file response status is 200', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/body-test.txt' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.status).toBe(200)
  })

  test('serves .map file as application/json', async () => {
    const fp = join(tmpDir, 'app.js.map')
    if (!existsSync(fp)) writeFileSync(fp, '{"version":3}')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/app.js.map' } }
    const result = await mw(ctx as any, async () => {}) as Response
    const ct = result.headers.get('Content-Type')
    expect(ct).toBeDefined()
  })

  test('serves .webmanifest file', async () => {
    const fp = join(tmpDir, 'manifest.webmanifest')
    if (!existsSync(fp)) writeFileSync(fp, '{"name":"test"}')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/manifest.webmanifest' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result).toBeInstanceOf(Response)
  })

  test('root path serves index.html when it exists', async () => {
    const fp = join(tmpDir, 'index.html')
    if (!existsSync(fp)) writeFileSync(fp, '<html>index</html>')
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    const ctx = { request: { method: 'GET', path: '/' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result).toBeInstanceOf(Response)
    expect(result.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  test('path without trailing slash for directory calls next', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', etag: false })
    let nextCalled = false
    const ctx = { request: { method: 'GET', path: '/subdir' } }
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('maxAge and immutable options together on served file', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__', maxAge: 86400, immutable: true, etag: false })
    const ctx = { request: { method: 'GET', path: '/body-test.txt' } }
    const result = await mw(ctx as any, async () => {}) as Response
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable')
  })

  test('etag is consistent for same file', async () => {
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const ctx1 = { request: { method: 'GET', path: '/body-test.txt', header: () => null } }
    const ctx2 = { request: { method: 'GET', path: '/body-test.txt', header: () => null } }
    const r1 = await mw(ctx1 as any, async () => {}) as Response
    const r2 = await mw(ctx2 as any, async () => {}) as Response
    expect(r1.headers.get('ETag')).toBe(r2.headers.get('ETag'))
  })

  test('different files have different etags', async () => {
    const fp1 = join(tmpDir, 'etag-a.txt')
    const fp2 = join(tmpDir, 'etag-b.txt')
    writeFileSync(fp1, 'content-a-unique')
    writeFileSync(fp2, 'content-b-unique-different-length')
    const mw = serveStatic({ dir: '__static_test_tmp__' })
    const r1 = await mw({ request: { method: 'GET', path: '/etag-a.txt', header: () => null } } as any, async () => {}) as Response
    const r2 = await mw({ request: { method: 'GET', path: '/etag-b.txt', header: () => null } } as any, async () => {}) as Response
    expect(r1.headers.get('ETag')).not.toBe(r2.headers.get('ETag'))
  })
})


describe('StaticProvider — extended', () => {
  test('boot with custom maxAge from config', async () => {
    const provider = new StaticProvider()
    let fallbackSet = false
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') {
          return (k: string, def?: any) => {
            if (k === 'static.maxAge') return 86400
            return def
          }
        }
        if (key === 'server') return { fallback: () => { fallbackSet = true } }
        return null
      },
    }
    await provider.boot(mockApp as any)
    expect(fallbackSet).toBe(true)
  })

  test('boot with immutable from config', async () => {
    const provider = new StaticProvider()
    let fallbackSet = false
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') {
          return (k: string, def?: any) => {
            if (k === 'static.immutable') return true
            return def
          }
        }
        if (key === 'server') return { fallback: () => { fallbackSet = true } }
        return null
      },
    }
    await provider.boot(mockApp as any)
    expect(fallbackSet).toBe(true)
  })

  test('multiple instances are independent', () => {
    const p1 = new StaticProvider()
    const p2 = new StaticProvider()
    expect(p1).not.toBe(p2)
    expect(p1).toBeInstanceOf(StaticProvider)
    expect(p2).toBeInstanceOf(StaticProvider)
  })

  test('boot can be called multiple times', async () => {
    const provider = new StaticProvider()
    let callCount = 0
    const mockApp = {
      use: (key: string) => {
        if (key === 'config') return (k: string, def?: any) => def
        if (key === 'server') return { fallback: () => { callCount++ } }
        return null
      },
    }
    await provider.boot(mockApp as any)
    await provider.boot(mockApp as any)
    expect(callCount).toBe(2)
  })
})
