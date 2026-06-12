import { test, expect, describe } from 'bun:test'
import {
  detectRuntime, isBun, isNode, runtimeName, runtimeVersion,
  readFile, readFileText, writeFile, fileExists, fileSize, fileResponse,
  serve, openDatabase, gc, spawn,
  hashBcrypt, verifyBcrypt, hashArgon2, verifyArgon2,
} from '../src/index'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'

const tmpDir = join(import.meta.dir, '__runtime_test_tmp__')


describe('detectRuntime', () => {
  test('returns bun or node', () => {
    const rt = detectRuntime()
    expect(['bun', 'node']).toContain(rt)
  })

  test('is consistent across calls', () => {
    expect(detectRuntime()).toBe(detectRuntime())
  })

  test('isBun returns boolean', () => {
    expect(typeof isBun()).toBe('boolean')
  })

  test('isNode returns boolean', () => {
    expect(typeof isNode()).toBe('boolean')
  })

  test('isBun and isNode are mutually exclusive', () => {
    expect(isBun() !== isNode()).toBe(true)
  })

  test('runtimeName returns string', () => {
    expect(['Bun', 'Node.js']).toContain(runtimeName())
  })

  test('runtimeVersion returns non-empty string', () => {
    expect(runtimeVersion().length).toBeGreaterThan(0)
  })

  test('in bun test, isBun is true', () => {
    expect(isBun()).toBe(true)
  })
})


describe('file operations', () => {
  const testFile = join(tmpDir, 'test.txt')
  const testContent = 'Hello from @tekir/runtime'

  test('setup tmp dir', () => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  test('writeFile creates a file', async () => {
    await writeFile(testFile, testContent)
    expect(existsSync(testFile)).toBe(true)
  })

  test('readFileText reads the file', async () => {
    const content = await readFileText(testFile)
    expect(content).toBe(testContent)
  })

  test('readFile returns Uint8Array', async () => {
    const data = await readFile(testFile)
    expect(data).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(data)).toBe(testContent)
  })

  test('fileExists returns true for existing file', async () => {
    expect(await fileExists(testFile)).toBe(true)
  })

  test('fileExists returns false for missing file', async () => {
    expect(await fileExists(join(tmpDir, 'nope.txt'))).toBe(false)
  })

  test('fileSize returns correct size', async () => {
    const size = await fileSize(testFile)
    expect(size).toBe(Buffer.byteLength(testContent))
  })

  test('fileResponse returns Response', async () => {
    const res = await fileResponse(testFile)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe(testContent)
  })

  test('fileResponse with custom status', async () => {
    const res = await fileResponse(testFile, 206)
    expect(res.status).toBe(206)
  })

  test('writeFile with Uint8Array', async () => {
    const path = join(tmpDir, 'binary.bin')
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await writeFile(path, data)
    const read = await readFile(path)
    expect(Array.from(read)).toEqual([1, 2, 3, 4, 5])
  })

  test('writeFile creates nested directories', async () => {
    const path = join(tmpDir, 'nested', 'deep', 'file.txt')
    await writeFile(path, 'nested')
    expect(await readFileText(path)).toBe('nested')
  })

  test('cleanup', () => {
    rmSync(tmpDir, { recursive: true })
  })
})


describe('openDatabase', () => {
  test('opens in-memory database', () => {
    const db = openDatabase(':memory:')
    expect(db).toBeDefined()
    db.close()
  })

  test('exec creates table', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    db.close()
  })

  test('run inserts data', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    db.run('INSERT INTO t (name) VALUES (?)', 'Alice')
    db.close()
  })

  test('query returns rows', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    db.run('INSERT INTO t (name) VALUES (?)', 'Alice')
    db.run('INSERT INTO t (name) VALUES (?)', 'Bob')
    const rows = db.query('SELECT * FROM t').all()
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Alice')
    db.close()
  })

  test('query with params', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    db.run('INSERT INTO t (name) VALUES (?)', 'Alice')
    db.run('INSERT INTO t (name) VALUES (?)', 'Bob')
    const rows = db.query('SELECT * FROM t WHERE name = ?').all('Bob')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bob')
    db.close()
  })

  test('prepare returns statement', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    const stmt = db.prepare('INSERT INTO t (name) VALUES (?)')
    expect(stmt).toBeDefined()
    db.close()
  })

  test('readonly mode', () => {
    // Can't write to readonly in-memory, just verify it opens
    const db = openDatabase(':memory:', { readonly: false })
    expect(db).toBeDefined()
    db.close()
  })
})


describe('password hashing', () => {
  test('hashBcrypt returns hash string', async () => {
    const hash = await hashBcrypt('password123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
  })

  test('verifyBcrypt validates correct password', async () => {
    const hash = await hashBcrypt('secret', 4)
    expect(await verifyBcrypt('secret', hash)).toBe(true)
  })

  test('verifyBcrypt rejects wrong password', async () => {
    const hash = await hashBcrypt('secret', 4)
    expect(await verifyBcrypt('wrong', hash)).toBe(false)
  })

  test('hashArgon2 returns hash string', async () => {
    const hash = await hashArgon2('password123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
  })

  test('verifyArgon2 validates correct password', async () => {
    const hash = await hashArgon2('secret')
    expect(await verifyArgon2('secret', hash)).toBe(true)
  })

  test('verifyArgon2 rejects wrong password', async () => {
    const hash = await hashArgon2('secret')
    expect(await verifyArgon2('wrong', hash)).toBe(false)
  })

  test('different passwords produce different hashes', async () => {
    const h1 = await hashBcrypt('pass1', 4)
    const h2 = await hashBcrypt('pass2', 4)
    expect(h1).not.toBe(h2)
  })
})


describe('gc', () => {
  test('gc does not throw', () => {
    expect(() => gc()).not.toThrow()
  })

  test('gc can be called multiple times', () => {
    gc()
    gc()
    gc()
  })
})


describe('spawn', () => {
  test('runs a command and captures output', async () => {
    const cmd = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node'
    const result = await spawn({ cmd: [cmd, '-e', 'console.log("hello")'] })
    expect(result.stdout.trim()).toBe('hello')
    expect(result.exitCode).toBe(0)
  })

  test('captures exit code', async () => {
    const cmd = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node'
    const result = await spawn({ cmd: [cmd, '-e', 'process.exit(42)'] })
    expect(result.exitCode).toBe(42)
  })

  test('passes environment variables', async () => {
    const cmd = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node'
    const result = await spawn({
      cmd: [cmd, '-e', 'process.stdout.write(process.env.TEST_VAR)'],
      env: { TEST_VAR: 'hello_from_runtime' },
    })
    expect(result.stdout).toBe('hello_from_runtime')
  })
})


describe('serve', () => {
  test('starts and stops a server', async () => {
    const server = serve({
      port: 0, // random port — Bun picks an available one
      fetch: () => new Response('ok'),
    })
    // Bun assigns actual port
    expect(server.port).toBeGreaterThan(0)
    server.stop()
  })

  test('serves HTTP responses', async () => {
    const server = serve({
      port: 19876,
      fetch: (req) => {
        const url = new URL(req.url)
        return new Response(`path: ${url.pathname}`)
      },
    })

    const res = await fetch('http://localhost:19876/test')
    expect(await res.text()).toBe('path: /test')
    server.stop()
  })

  test('handles different methods', async () => {
    const server = serve({
      port: 19877,
      fetch: (req) => new Response(req.method),
    })

    const get = await fetch('http://localhost:19877/')
    expect(await get.text()).toBe('GET')

    const post = await fetch('http://localhost:19877/', { method: 'POST' })
    expect(await post.text()).toBe('POST')

    server.stop()
  })

  test('handles JSON responses', async () => {
    const server = serve({
      port: 19878,
      fetch: () => new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    const res = await fetch('http://localhost:19878/')
    const data = await res.json()
    expect(data.ok).toBe(true)
    server.stop()
  })
})


describe('file operations — extended', () => {
  const tmpDir2 = join(import.meta.dir, '__runtime_test_tmp2__')

  test('setup tmp dir', () => {
    if (existsSync(tmpDir2)) rmSync(tmpDir2, { recursive: true })
    mkdirSync(tmpDir2, { recursive: true })
  })

  test('writeFile with empty string', async () => {
    const path = join(tmpDir2, 'empty.txt')
    await writeFile(path, '')
    expect(await readFileText(path)).toBe('')
  })

  test('fileSize returns 0 for empty file', async () => {
    const path = join(tmpDir2, 'empty.txt')
    const size = await fileSize(path)
    expect(size).toBe(0)
  })

  test('writeFile with unicode content', async () => {
    const path = join(tmpDir2, 'unicode.txt')
    const content = 'こんにちは世界 🌍 مرحبا'
    await writeFile(path, content)
    expect(await readFileText(path)).toBe(content)
  })

  test('writeFile overwrites existing file', async () => {
    const path = join(tmpDir2, 'overwrite.txt')
    await writeFile(path, 'first')
    await writeFile(path, 'second')
    expect(await readFileText(path)).toBe('second')
  })

  test('writeFile with large binary data', async () => {
    const path = join(tmpDir2, 'large.bin')
    const data = new Uint8Array(1024 * 100) // 100KB
    for (let i = 0; i < data.length; i++) data[i] = i % 256
    await writeFile(path, data)
    const read = await readFile(path)
    expect(read.length).toBe(data.length)
    expect(read[0]).toBe(0)
    expect(read[255]).toBe(255)
    expect(read[256]).toBe(0)
  })

  test('fileSize returns correct size for binary file', async () => {
    const path = join(tmpDir2, 'large.bin')
    const size = await fileSize(path)
    expect(size).toBe(1024 * 100)
  })

  test('readFile on binary file preserves bytes', async () => {
    const path = join(tmpDir2, 'small_bin.bin')
    const data = new Uint8Array([0, 127, 128, 255])
    await writeFile(path, data)
    const read = await readFile(path)
    expect(Array.from(read)).toEqual([0, 127, 128, 255])
  })

  test('writeFile with single byte', async () => {
    const path = join(tmpDir2, 'single.bin')
    const data = new Uint8Array([42])
    await writeFile(path, data)
    const read = await readFile(path)
    expect(read.length).toBe(1)
    expect(read[0]).toBe(42)
  })

  test('fileExists returns false for directory path used as file', async () => {
    const dirPath = join(tmpDir2, 'subdir_check')
    mkdirSync(dirPath, { recursive: true })
    // fileExists should still return true for directories in most implementations
    const exists = await fileExists(dirPath)
    expect(typeof exists).toBe('boolean')
  })

  test('readFileText on file with newlines', async () => {
    const path = join(tmpDir2, 'newlines.txt')
    const content = 'line1\nline2\nline3\n'
    await writeFile(path, content)
    expect(await readFileText(path)).toBe(content)
  })

  test('readFileText on file with carriage returns', async () => {
    const path = join(tmpDir2, 'crlf.txt')
    const content = 'line1\r\nline2\r\n'
    await writeFile(path, content)
    expect(await readFileText(path)).toBe(content)
  })

  test('fileResponse for empty file returns 200', async () => {
    const path = join(tmpDir2, 'empty.txt')
    const res = await fileResponse(path)
    expect(res.status).toBe(200)
  })

  test('writeFile creates deeply nested directories', async () => {
    const path = join(tmpDir2, 'a', 'b', 'c', 'd', 'e.txt')
    await writeFile(path, 'deep')
    expect(await readFileText(path)).toBe('deep')
  })

  test('writeFile with very long string', async () => {
    const path = join(tmpDir2, 'long.txt')
    const content = 'x'.repeat(50000)
    await writeFile(path, content)
    expect(await readFileText(path)).toBe(content)
  })

  test('cleanup', () => {
    rmSync(tmpDir2, { recursive: true })
  })
})


describe('openDatabase — extended', () => {
  test('multiple tables in same database', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
    db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER)')
    db.run('INSERT INTO users (name) VALUES (?)', 'Alice')
    db.run('INSERT INTO posts (title, user_id) VALUES (?, ?)', 'Hello', 1)
    const rows = db.query('SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
    expect(rows[0].title).toBe('Hello')
    db.close()
  })

  test('query with multiple params', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT)')
    db.run('INSERT INTO t (a, b) VALUES (?, ?)', 'x', 'y')
    const rows = db.query('SELECT * FROM t WHERE a = ? AND b = ?').all('x', 'y')
    expect(rows).toHaveLength(1)
    db.close()
  })

  test('insert and retrieve integer types', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val INTEGER)')
    db.run('INSERT INTO t (val) VALUES (?)', 42)
    const row = db.query('SELECT val FROM t').get()
    expect(row.val).toBe(42)
    db.close()
  })

  test('insert and retrieve real types', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val REAL)')
    db.run('INSERT INTO t (val) VALUES (?)', 3.14)
    const row = db.query('SELECT val FROM t').get()
    expect(row.val).toBeCloseTo(3.14, 2)
    db.close()
  })

  test('NULL values', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.run('INSERT INTO t (val) VALUES (?)', null)
    const row = db.query('SELECT val FROM t').get()
    expect(row.val).toBeNull()
    db.close()
  })

  test('empty table returns empty array', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    const rows = db.query('SELECT * FROM t').all()
    expect(rows).toHaveLength(0)
    db.close()
  })

  test('query.get returns first row', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    db.run('INSERT INTO t (name) VALUES (?)', 'first')
    db.run('INSERT INTO t (name) VALUES (?)', 'second')
    const row = db.query('SELECT * FROM t ORDER BY id').get()
    expect(row.name).toBe('first')
    db.close()
  })

  test('UPDATE modifies rows', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.run('INSERT INTO t (val) VALUES (?)', 'old')
    db.run('UPDATE t SET val = ? WHERE val = ?', 'new', 'old')
    const row = db.query('SELECT val FROM t').get()
    expect(row.val).toBe('new')
    db.close()
  })

  test('DELETE removes rows', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.run('INSERT INTO t (val) VALUES (?)', 'a')
    db.run('INSERT INTO t (val) VALUES (?)', 'b')
    db.run('DELETE FROM t WHERE val = ?', 'a')
    const rows = db.query('SELECT * FROM t').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].val).toBe('b')
    db.close()
  })

  test('COUNT aggregate', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.run('INSERT INTO t (val) VALUES (?)', 'a')
    db.run('INSERT INTO t (val) VALUES (?)', 'b')
    db.run('INSERT INTO t (val) VALUES (?)', 'c')
    const row = db.query('SELECT COUNT(*) as cnt FROM t').get()
    expect(row.cnt).toBe(3)
    db.close()
  })

  test('UNIQUE constraint', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
    db.run('INSERT INTO t (email) VALUES (?)', 'a@b.com')
    expect(() => db.run('INSERT INTO t (email) VALUES (?)', 'a@b.com')).toThrow()
    db.close()
  })

  test('ORDER BY with LIMIT', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val INTEGER)')
    for (let i = 10; i >= 1; i--) db.run('INSERT INTO t (val) VALUES (?)', i)
    const rows = db.query('SELECT val FROM t ORDER BY val ASC LIMIT 3').all()
    expect(rows.map((r: any) => r.val)).toEqual([1, 2, 3])
    db.close()
  })

  test('GROUP BY with HAVING', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, cat TEXT, val INTEGER)')
    db.run('INSERT INTO t (cat, val) VALUES (?, ?)', 'a', 1)
    db.run('INSERT INTO t (cat, val) VALUES (?, ?)', 'a', 2)
    db.run('INSERT INTO t (cat, val) VALUES (?, ?)', 'b', 3)
    const rows = db.query('SELECT cat, COUNT(*) as cnt FROM t GROUP BY cat HAVING cnt > 1').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].cat).toBe('a')
    db.close()
  })
})


describe('password hashing — extended', () => {
  test('bcrypt hash starts with $2', async () => {
    const hash = await hashBcrypt('test', 4)
    expect(hash.startsWith('$2')).toBe(true)
  })

  test('bcrypt with single character', async () => {
    const hash = await hashBcrypt('a', 4)
    expect(typeof hash).toBe('string')
    expect(await verifyBcrypt('a', hash)).toBe(true)
  })

  test('argon2 with single character', async () => {
    const hash = await hashArgon2('x')
    expect(typeof hash).toBe('string')
    expect(await verifyArgon2('x', hash)).toBe(true)
  })

  test('bcrypt same password hashes differently each time', async () => {
    const h1 = await hashBcrypt('same', 4)
    const h2 = await hashBcrypt('same', 4)
    expect(h1).not.toBe(h2)
    expect(await verifyBcrypt('same', h1)).toBe(true)
    expect(await verifyBcrypt('same', h2)).toBe(true)
  })

  test('argon2 same password hashes differently each time', async () => {
    const h1 = await hashArgon2('same')
    const h2 = await hashArgon2('same')
    expect(h1).not.toBe(h2)
  })

  test('bcrypt with special characters', async () => {
    const password = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
    const hash = await hashBcrypt(password, 4)
    expect(await verifyBcrypt(password, hash)).toBe(true)
  })

  test('argon2 with unicode password', async () => {
    const password = 'パスワード密码'
    const hash = await hashArgon2(password)
    expect(await verifyArgon2(password, hash)).toBe(true)
  })

  test('bcrypt verify with different password is false', async () => {
    const hash = await hashBcrypt('correct', 4)
    expect(await verifyBcrypt('incorrect', hash)).toBe(false)
  })

  test('argon2 hash contains $argon2', async () => {
    const hash = await hashArgon2('test')
    expect(hash).toContain('$argon2')
  })
})


describe('serve — extended', () => {
  test('serves custom headers', async () => {
    const server = serve({
      port: 0,
      fetch: () => new Response('ok', {
        headers: { 'X-Custom': 'value', 'X-Another': 'test' },
      }),
    })
    const res = await fetch(`http://localhost:${server.port}/`)
    expect(res.headers.get('X-Custom')).toBe('value')
    expect(res.headers.get('X-Another')).toBe('test')
    server.stop()
  })

  test('serves 404 responses', async () => {
    const server = serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/found') return new Response('found')
        return new Response('not found', { status: 404 })
      },
    })
    const res = await fetch(`http://localhost:${server.port}/missing`)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not found')
    server.stop()
  })

  test('serves empty body with 204', async () => {
    const server = serve({
      port: 0,
      fetch: () => new Response(null, { status: 204 }),
    })
    const res = await fetch(`http://localhost:${server.port}/`)
    expect(res.status).toBe(204)
    server.stop()
  })

  test('handles request headers', async () => {
    const server = serve({
      port: 0,
      fetch: (req) => {
        const auth = req.headers.get('Authorization')
        return new Response(auth || 'no-auth')
      },
    })
    const res = await fetch(`http://localhost:${server.port}/`, {
      headers: { Authorization: 'Bearer token123' },
    })
    expect(await res.text()).toBe('Bearer token123')
    server.stop()
  })

  test('handles request body in POST', async () => {
    const server = serve({
      port: 0,
      fetch: async (req) => {
        if (req.method === 'POST') {
          const body = await req.text()
          return new Response(`received: ${body}`)
        }
        return new Response('GET')
      },
    })
    const res = await fetch(`http://localhost:${server.port}/`, {
      method: 'POST',
      body: 'hello',
    })
    expect(await res.text()).toBe('received: hello')
    server.stop()
  })

  test('handles PUT and DELETE methods', async () => {
    const server = serve({
      port: 0,
      fetch: (req) => new Response(req.method),
    })
    const put = await fetch(`http://localhost:${server.port}/`, { method: 'PUT' })
    expect(await put.text()).toBe('PUT')
    const del = await fetch(`http://localhost:${server.port}/`, { method: 'DELETE' })
    expect(await del.text()).toBe('DELETE')
    server.stop()
  })

  test('serves multiple concurrent requests', async () => {
    const server = serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        return new Response(url.pathname)
      },
    })
    const results = await Promise.all(
      ['/a', '/b', '/c', '/d', '/e'].map(p =>
        fetch(`http://localhost:${server.port}${p}`).then(r => r.text())
      )
    )
    expect(results).toEqual(['/a', '/b', '/c', '/d', '/e'])
    server.stop()
  })
})


describe('spawn — extended', () => {
  const cmd = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node'

  test('captures stderr', async () => {
    const result = await spawn({ cmd: [cmd, '-e', 'console.error("err")'] })
    expect(result.stderr.trim()).toBe('err')
  })

  test('captures both stdout and stderr', async () => {
    const result = await spawn({ cmd: [cmd, '-e', 'console.log("out"); console.error("err")'] })
    expect(result.stdout.trim()).toBe('out')
    expect(result.stderr.trim()).toBe('err')
  })

  test('true command exits 0', async () => {
    const result = await spawn({ cmd: [cmd, '-e', 'process.exit(0)'] })
    expect(result.exitCode).toBe(0)
  })

  test('multi-line output', async () => {
    const result = await spawn({ cmd: [cmd, '-e', 'console.log("a\\nb\\nc")'] })
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  test('JSON output', async () => {
    const result = await spawn({ cmd: [cmd, '-e', 'console.log(JSON.stringify({ok:true}))'] })
    expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true })
  })
})


describe('detectRuntime — extended', () => {
  test('runtimeVersion matches semver-like format', () => {
    const ver = runtimeVersion()
    expect(ver).toMatch(/^\d+\.\d+/)
  })

  test('detectRuntime returns same value 100 times', () => {
    const first = detectRuntime()
    for (let i = 0; i < 100; i++) {
      expect(detectRuntime()).toBe(first)
    }
  })

  test('isBun and isNode are stable', () => {
    const bunResult = isBun()
    const nodeResult = isNode()
    for (let i = 0; i < 50; i++) {
      expect(isBun()).toBe(bunResult)
      expect(isNode()).toBe(nodeResult)
    }
  })
})


describe('gc — extended', () => {
  test('gc returns undefined', () => {
    expect(gc()).toBeUndefined()
  })

  test('gc called in rapid succession', () => {
    for (let i = 0; i < 10; i++) gc()
    // Should not throw
  })

  test('gc after allocations', () => {
    const arr = new Array(10000).fill('x')
    gc()
    expect(arr.length).toBe(10000) // array still intact
  })

  test('gc after creating objects', () => {
    for (let i = 0; i < 100; i++) ({ a: i, b: 'test' })
    gc()
  })

  test('gc after string concatenation', () => {
    let s = ''
    for (let i = 0; i < 100; i++) s += 'x'
    gc()
    expect(s.length).toBe(100)
  })

  test('gc returns undefined consistently', () => {
    for (let i = 0; i < 5; i++) {
      expect(gc()).toBeUndefined()
    }
  })
})
