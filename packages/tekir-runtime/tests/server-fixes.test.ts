import { test, expect, describe } from 'bun:test'
import { serve, headersToObject } from '../src/server'
import { fileResponse } from '../src/file'
import { spawn } from '../src/spawn'
import { openDatabase } from '../src/sqlite'
import { join } from 'path'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'

// These exercise the Node fallback path of @tekir/runtime. Under `bun test`
// `serve()` runs the Bun path, but the behaviors asserted (streaming, body
// limits, file traversal, spawn error, sqlite readonly+WAL) are runtime
// agnostic and must hold on both.

describe('serve — streaming (no full-body buffering)', () => {
  test('streams a ReadableStream response chunk by chunk', async () => {
    const encoder = new TextEncoder()
    const server = serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('chunk1\n'))
          controller.enqueue(encoder.encode('chunk2\n'))
          controller.close()
        },
      }), { headers: { 'Content-Type': 'text/plain' } }),
    })
    const res = await fetch(`http://localhost:${server.port}/`)
    expect(await res.text()).toBe('chunk1\nchunk2\n')
    server.stop()
  })

  test('an SSE-style infinite-ish stream delivers early chunks without hanging', async () => {
    const encoder = new TextEncoder()
    const server = serve({
      port: 0,
      fetch: () => {
        let n = 0
        const stream = new ReadableStream({
          pull(controller) {
            if (n >= 3) { controller.close(); return }
            controller.enqueue(encoder.encode(`data: ${n++}\n\n`))
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      },
    })
    const res = await fetch(`http://localhost:${server.port}/sse`)
    const text = await res.text()
    expect(text).toContain('data: 0')
    expect(text).toContain('data: 2')
    server.stop()
  })
})

describe('serve — response headers', () => {
  test('preserves multiple Set-Cookie values as separate headers', () => {
    const headers = new Headers()
    headers.append('Set-Cookie', 'a=1; Path=/; HttpOnly')
    headers.append('Set-Cookie', 'b=2; Path=/; SameSite=Lax')
    const out = headersToObject(headers)
    expect(out['set-cookie']).toEqual([
      'a=1; Path=/; HttpOnly',
      'b=2; Path=/; SameSite=Lax',
    ])
  })
})

describe('serve — request body size limit', () => {
  test('rejects an oversized body with 413', async () => {
    const server = serve({
      port: 0,
      maxRequestBodySize: 1024,
      fetch: async (req) => new Response(await req.text()),
    })
    const res = await fetch(`http://localhost:${server.port}/`, {
      method: 'POST',
      body: 'x'.repeat(5000),
    })
    expect(res.status).toBe(413)
    server.stop()
  })

  test('allows a body within the limit', async () => {
    const server = serve({
      port: 0,
      maxRequestBodySize: 1024 * 1024,
      fetch: async (req) => new Response(await req.text()),
    })
    const res = await fetch(`http://localhost:${server.port}/`, {
      method: 'POST',
      body: 'hello',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    server.stop()
  })
})

describe('fileResponse — base-dir traversal guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tekir-file-'))
  writeFileSync(join(dir, 'ok.txt'), 'safe')

  test('serves a file inside the base dir', async () => {
    const res = await fileResponse('ok.txt', 200, { baseDir: dir })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('safe')
  })

  test('rejects a traversal escape', async () => {
    await expect(fileResponse('../../../etc/passwd', 200, { baseDir: dir }))
      .rejects.toThrow(/escapes base directory/)
  })

  test('cleanup', () => { rmSync(dir, { recursive: true }) })
})

describe('fileResponse — MIME consistency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tekir-mime-'))
  writeFileSync(join(dir, 'page.html'), '<h1>hi</h1>')

  test('derives Content-Type from extension', async () => {
    const res = await fileResponse(join(dir, 'page.html'))
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  test('cleanup', () => { rmSync(dir, { recursive: true }) })
})

describe('spawn — error path', () => {
  test('rejects when the binary does not exist', async () => {
    await expect(spawn({ cmd: ['definitely-not-a-real-binary-xyz123'] }))
      .rejects.toBeDefined()
  })
})

describe('openDatabase — readonly skips WAL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tekir-sqlite-'))
  const dbPath = join(dir, 'app.sqlite')

  test('creates a writable db', () => {
    const db = openDatabase(dbPath)
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    db.close()
  })

  test('opens readonly without throwing on WAL', () => {
    expect(() => {
      const db = openDatabase(dbPath, { readonly: true })
      db.close()
    }).not.toThrow()
  })

  test('cleanup', () => { rmSync(dir, { recursive: true }) })
})
