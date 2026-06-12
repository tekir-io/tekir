import { test, expect, describe, afterEach } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseMultipart, PayloadTooLargeError } from '../src/parser'

const BOUNDARY = '----tekirtestboundary'

// Build a raw multipart/form-data body from field / file parts.
function buildMultipart(parts: Array<{ name: string; filename?: string; type?: string; data: Uint8Array | string }>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const p of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename !== undefined) head += `; filename="${p.filename}"`
    head += '\r\n'
    if (p.type) head += `Content-Type: ${p.type}\r\n`
    head += '\r\n'
    chunks.push(enc.encode(head))
    chunks.push(typeof p.data === 'string' ? enc.encode(p.data) : p.data)
    chunks.push(enc.encode('\r\n'))
  }
  chunks.push(enc.encode(`--${BOUNDARY}--\r\n`))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

// A Request whose body is a real ReadableStream that emits in small slices, so
// the streaming parser exercises its incremental boundary logic (and so we can
// assert it never buffers the whole oversized body).
function streamRequest(body: Uint8Array, opts?: { sliceSize?: number; contentLength?: string | null; onPull?: (sent: number) => void }): Request {
  const sliceSize = opts?.sliceSize ?? 64
  let pos = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos >= body.length) { controller.close(); return }
      const end = Math.min(pos + sliceSize, body.length)
      controller.enqueue(body.subarray(pos, end))
      pos = end
      opts?.onPull?.(pos)
    },
  })
  const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
  if (opts?.contentLength !== null) headers['content-length'] = opts?.contentLength ?? String(body.length)
  return new Request('http://localhost/upload', { method: 'POST', headers, body: stream, duplex: 'half' } as any)
}

const tmpDirs: string[] = []
function freshTmpDir(): string {
  const d = join(tmpdir(), `tekir-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  tmpDirs.push(d)
  return d
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})


describe('streaming multipart — normal parsing (regression)', () => {
  test('parses small fields and a file correctly', async () => {
    const body = buildMultipart([
      { name: 'name', data: 'Ali' },
      { name: 'bio', data: 'hello world' },
      { name: 'avatar', filename: 'photo.jpg', type: 'image/jpeg', data: 'image-bytes-here' },
    ])
    const { body: fields, files } = await parseMultipart(streamRequest(body), {})
    expect(fields.name).toBe('Ali')
    expect(fields.bio).toBe('hello world')
    const file = files.file('avatar')
    expect(file).not.toBeNull()
    expect(file!.clientName).toBe('photo.jpg')
    expect(file!.extname).toBe('jpg')
    expect(file!.type).toBe('image')
    expect(file!.toString()).toBe('image-bytes-here')
    expect(file!.size).toBe('image-bytes-here'.length)
  })

  test('repeated field name collects into an array', async () => {
    const body = buildMultipart([
      { name: 'tag', data: 'a' },
      { name: 'tag', data: 'b' },
    ])
    const { body: fields } = await parseMultipart(streamRequest(body, { sliceSize: 8 }), {})
    expect(fields.tag).toEqual(['a', 'b'])
  })

  test('binary content with embedded CRLF survives streaming', async () => {
    const raw = new Uint8Array([0, 1, 2, 0x0d, 0x0a, 3, 4, 0x0d, 0x0a, 5, 255])
    const body = buildMultipart([{ name: 'blob', filename: 'b.bin', data: raw }])
    const { files } = await parseMultipart(streamRequest(body, { sliceSize: 3 }), {})
    const f = files.file('blob')!
    expect(Array.from(f.toBuffer())).toEqual(Array.from(raw))
  })
})


describe('streaming multipart — early limit enforcement', () => {
  test('total size over limit aborts before full buffering', async () => {
    // 2MB body, 64kb limit. Track how many bytes the stream actually pulled:
    // it must abort long before draining the whole body (no OOM-style full read).
    const big = new Uint8Array(2 * 1024 * 1024).fill(0x61)
    const body = buildMultipart([{ name: 'f', filename: 'big.bin', data: big }])
    let pulled = 0
    const req = streamRequest(body, { sliceSize: 8192, contentLength: null, onPull: (p) => { pulled = p } })
    await expect(parseMultipart(req, { limit: '64kb', maxFileSize: '8mb' })).rejects.toBeInstanceOf(PayloadTooLargeError)
    // Aborted early: nowhere near the full 2MB+ body was read.
    expect(pulled).toBeLessThan(body.length / 2)
  })

  test('per-file maxFileSize enforced mid-stream', async () => {
    const data = new Uint8Array(200 * 1024).fill(0x62)
    const body = buildMultipart([{ name: 'f', filename: 'big.bin', data }])
    const req = streamRequest(body, { sliceSize: 8192, contentLength: null })
    await expect(parseMultipart(req, { maxFileSize: '64kb', limit: '50mb' })).rejects.toBeInstanceOf(PayloadTooLargeError)
  })

  test('content-length pre-check rejects without reading body', async () => {
    const body = buildMultipart([{ name: 'f', filename: 'x.bin', data: 'tiny' }])
    let pulled = 0
    const req = streamRequest(body, { contentLength: String(100 * 1024 * 1024), onPull: (p) => { pulled = p } })
    await expect(parseMultipart(req, { limit: '1mb' })).rejects.toBeInstanceOf(PayloadTooLargeError)
    // The parser rejects on the Content-Length header before getReader(); any
    // bytes counted come only from the stream's eager pre-pull, not the parser
    // draining the body.
    expect(pulled).toBeLessThanOrEqual(64)
  })

  test('maxFiles exceeded throws (no longer silently dropped)', async () => {
    const body = buildMultipart([
      { name: 'a', filename: '1.txt', data: 'one' },
      { name: 'b', filename: '2.txt', data: 'two' },
      { name: 'c', filename: '3.txt', data: 'three' },
    ])
    const req = streamRequest(body, { sliceSize: 16 })
    await expect(parseMultipart(req, { maxFiles: 2 })).rejects.toBeInstanceOf(PayloadTooLargeError)
  })

  test('maxFields exceeded throws', async () => {
    const body = buildMultipart([
      { name: 'a', data: '1' },
      { name: 'b', data: '2' },
      { name: 'c', data: '3' },
    ])
    const req = streamRequest(body, { sliceSize: 16 })
    await expect(parseMultipart(req, { maxFields: 2 })).rejects.toBeInstanceOf(PayloadTooLargeError)
  })
})


describe('streaming multipart — disk spill', () => {
  test('large file spills to disk and is readable; small one stays in memory', async () => {
    const dir = freshTmpDir()
    const bigData = new Uint8Array(300 * 1024)
    for (let i = 0; i < bigData.length; i++) bigData[i] = i & 0xff
    const body = buildMultipart([
      { name: 'small', filename: 's.txt', data: 'in-memory' },
      { name: 'big', filename: 'big.bin', data: bigData },
    ])
    const req = streamRequest(body, { sliceSize: 16384, contentLength: null })
    const { files } = await parseMultipart(req, {
      tmpDir: dir,
      spillThreshold: '64kb',
      maxFileSize: '5mb',
      limit: '5mb',
    })

    const big = files.file('big')!
    expect(big.isSpilled).toBe(true)
    expect(big.tmpPath).not.toBeNull()
    expect(existsSync(big.tmpPath!)).toBe(true)
    expect(big.size).toBe(bigData.length)
    // Content on disk matches exactly.
    expect(Array.from(readFileSync(big.tmpPath!))).toEqual(Array.from(bigData))
    // Lazily readable back through the file API.
    expect(big.toBuffer().length).toBe(bigData.length)

    const small = files.file('small')!
    expect(small.isSpilled).toBe(false)
    expect(small.toString()).toBe('in-memory')
  })

  test('spilled temp files are cleaned up when a later part overflows', async () => {
    const dir = freshTmpDir()
    const first = new Uint8Array(200 * 1024).fill(0x41)
    const second = new Uint8Array(5 * 1024 * 1024).fill(0x42)
    const body = buildMultipart([
      { name: 'a', filename: 'a.bin', data: first },
      { name: 'b', filename: 'b.bin', data: second },
    ])
    const req = streamRequest(body, { sliceSize: 32768, contentLength: null })
    await expect(
      parseMultipart(req, { tmpDir: dir, spillThreshold: '64kb', limit: '1mb', maxFileSize: '8mb' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeError)
    // No leaked temp files left behind in the directory.
    if (existsSync(dir)) {
      const { readdirSync } = require('fs')
      expect(readdirSync(dir).length).toBe(0)
    }
  })
})


describe('streaming multipart — filename sanitization', () => {
  test('traversal filename is sanitized to a basename inside tmpDir', async () => {
    const dir = freshTmpDir()
    // Custom hook returns a traversal name; the resolver strips it to a bare
    // basename so the spill stays inside tmpDir and nothing escapes.
    const body = buildMultipart([
      { name: 'f', filename: '../../evil.txt', data: new Uint8Array(200 * 1024).fill(0x63) },
    ])
    const req = streamRequest(body, { sliceSize: 16384, contentLength: null })
    const { files } = await parseMultipart(req, {
      tmpDir: dir,
      spillThreshold: '64kb',
      maxFileSize: '5mb',
      limit: '5mb',
      tmpFileName: () => '../../../escape.txt',
    })
    const f = files.file('f')!
    expect(f.size).toBe(200 * 1024)
    // Sanitized to basename within tmpDir; never escapes to the parent.
    expect(f.tmpPath).toBe(join(dir, 'escape.txt'))
    expect(existsSync(join(dir, 'escape.txt'))).toBe(true)
    expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false)
  })

  test('degenerate tmpFileName hook is rejected, file stays in memory', async () => {
    const dir = freshTmpDir()
    const body = buildMultipart([
      { name: 'f', filename: 'doc.bin', data: new Uint8Array(200 * 1024).fill(0x63) },
    ])
    const req = streamRequest(body, { sliceSize: 16384, contentLength: null })
    const { files } = await parseMultipart(req, {
      tmpDir: dir,
      spillThreshold: '64kb',
      maxFileSize: '5mb',
      limit: '5mb',
      // A hook that yields a name reducing to '..' has no safe basename, so the
      // resolver rejects it and the part is kept in memory instead.
      tmpFileName: () => '..',
    })
    const f = files.file('f')!
    expect(f.isSpilled).toBe(false)
    expect(f.tmpPath).toBeNull()
    expect(f.size).toBe(200 * 1024)
  })

  test('safe spilled filename stays inside tmpDir', async () => {
    const dir = freshTmpDir()
    const body = buildMultipart([
      { name: 'f', filename: 'doc.bin', data: new Uint8Array(200 * 1024).fill(0x64) },
    ])
    const req = streamRequest(body, { sliceSize: 16384, contentLength: null })
    const { files } = await parseMultipart(req, {
      tmpDir: dir,
      spillThreshold: '64kb',
      maxFileSize: '5mb',
      limit: '5mb',
      tmpFileName: () => 'upload.tmp',
    })
    const f = files.file('f')!
    expect(f.isSpilled).toBe(true)
    expect(f.tmpPath).toBe(join(dir, 'upload.tmp'))
    expect(existsSync(join(dir, 'upload.tmp'))).toBe(true)
  })
})
