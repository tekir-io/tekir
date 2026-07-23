import { basename, isAbsolute, join, relative, resolve } from 'path'
import type { BodyParserConfig } from './types'
import { MultipartFiles } from './multipart_files'
import { UploadedFile, parseSize, formatSize } from './uploaded_file'

/**
 * Thrown by {@link parseMultipart} when the request exceeds configured upload
 * limits. Carries a `statusCode` so framework error handlers can return
 * `413 Payload Too Large` automatically. The streaming parser throws this
 * mid-stream (before the whole body is buffered) when `limit`, `maxFileSize`,
 * `maxFiles`, or `maxFields` is exceeded.
 */
export class PayloadTooLargeError extends Error {
  statusCode = 413
  constructor(message: string) {
    super(message)
    this.name = 'PayloadTooLargeError'
  }
  toJSON() {
    return { error: { message: this.message, statusCode: this.statusCode } }
  }
}


const CR = 0x0d
const LF = 0x0a
const DASH = 0x2d

/** Extract the boundary token from a `multipart/form-data` content-type. */
function getBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) return null
  return (m[1] ?? m[2]).trim()
}

/** Find the first index of `needle` in `hay` starting at `from`, or -1. */
function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const last = hay.length - needle.length
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Parse a part's raw header block into a header map. */
function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of block.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
  }
  return headers
}

/** Pull `name`/`filename` out of a `Content-Disposition` header. */
function parseDisposition(value: string): { name?: string; filename?: string } {
  const out: { name?: string; filename?: string } = {}
  const name = /name="([^"]*)"/i.exec(value)
  if (name) out.name = name[1]
  // `filename*=UTF-8''...` (RFC 5987) takes precedence over plain `filename=`.
  const ext = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(value)
  if (ext) {
    try { out.filename = decodeURIComponent(ext[1].trim().replace(/^"|"$/g, '')) } catch { out.filename = ext[1] }
  } else {
    const fn = /filename="([^"]*)"/i.exec(value)
    if (fn) out.filename = fn[1]
  }
  return out
}

// State machine: looking for the part headers, then streaming the part body.
const enum St { Preamble, Headers, Body }

/**
 * Accumulates a single file part's bytes, spilling to a temp file on disk once
 * it crosses `spillThreshold` so memory stays bounded for large uploads.
 */
class PartSink {
  size = 0
  private chunks: Buffer[] = []
  private buffered = 0
  private spillPath: string | null = null
  private writeStream: any = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private spillThreshold: number,
    private tmpPath: string | null,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) return
    this.size += chunk.length
    if (this.writeStream) {
      await this.streamWrite(Buffer.from(chunk))
      return
    }
    this.chunks.push(Buffer.from(chunk))
    this.buffered += chunk.length
    // Once buffered content crosses the threshold (and a tmp path exists),
    // flush everything to disk and switch to streaming writes.
    if (this.tmpPath && this.buffered > this.spillThreshold) {
      const { createWriteStream } = await import('fs')
      this.writeStream = createWriteStream(this.tmpPath)
      this.spillPath = this.tmpPath
      const flush = Buffer.concat(this.chunks)
      this.chunks = []
      this.buffered = 0
      await this.streamWrite(flush)
    }
  }

  private streamWrite(buf: Buffer): Promise<void> {
    this.pending = this.pending.then(
      () => new Promise<void>((res, rej) => {
        this.writeStream.write(buf, (err: any) => (err ? rej(err) : res()))
      }),
    )
    return this.pending
  }

  /** Finalize: returns the in-memory buffer, or null if spilled to disk. */
  async finish(): Promise<{ buffer: Buffer | null; path: string | null }> {
    if (this.writeStream) {
      await this.pending
      await new Promise<void>((res) => this.writeStream.end(res))
      return { buffer: null, path: this.spillPath }
    }
    return { buffer: Buffer.concat(this.chunks), path: null }
  }

  async discard(): Promise<void> {
    if (this.writeStream) {
      try { await this.pending } catch {}
      await new Promise<void>((res) => this.writeStream.end(res))
      if (this.spillPath) {
        const { unlink } = await import('fs/promises')
        await unlink(this.spillPath).catch(() => {})
      }
    }
    this.chunks = []
  }
}


/**
 * Parse a `multipart/form-data` request into body fields and uploaded files.
 *
 * This is a streaming parser: it reads the request body stream and parses the
 * multipart boundaries incrementally rather than buffering the whole body via
 * the runtime's `request.formData()`. Size limits (`maxFileSize`, total
 * `limit`, `maxFiles`, `maxFields`, `maxParts`) are enforced *during* streaming and abort
 * early with {@link PayloadTooLargeError} so an oversized payload is never
 * fully buffered. Large file parts are spilled to a temp file on disk (see
 * `spillThreshold` + `tmpDir`) to keep memory bounded; partial spills are
 * cleaned up on error.
 *
 * Scope note: handles standard `multipart/form-data` (the universal browser /
 * HTTP-client shape). Legacy `multipart/mixed` nested sub-parts are not
 * expanded — extremely rare in practice and out of scope here.
 *
 * @param request - The incoming {@link Request} object containing the multipart body.
 * @param config - Optional multipart parser configuration.
 * @returns An object with `body` (non-file form fields) and `files` ({@link MultipartFiles} collection).
 *
 * @example
 * ```ts
 * const { body, files } = await parseMultipart(request, { maxFileSize: '5mb', maxFiles: 10 })
 * const avatar = files.file('avatar')
 * ```
 */
export async function parseMultipart(request: Request, config?: BodyParserConfig['multipart']): Promise<{ body: Record<string, any>; files: MultipartFiles }> {
  const maxFileSize = config?.maxFileSize ? parseSize(config.maxFileSize) : parseSize('8mb')
  const totalLimit = config?.limit ? parseSize(config.limit) : parseSize('20mb')
  const maxFiles = config?.maxFiles ?? 20
  const maxFields = config?.maxFields ?? 1000
  const maxParts = config?.maxParts ?? 1000
  const spillThreshold = config?.spillThreshold !== undefined ? parseSize(config.spillThreshold) : parseSize('1mb')

  // Cheap pre-check: a declared Content-Length already over the limit is
  // rejected before reading a byte. The streaming loop below enforces the
  // real limit regardless of whether this header is present/honest.
  const lengthHeader = request.headers.get('content-length')
  if (lengthHeader) {
    const declaredLength = Number(lengthHeader)
    if (Number.isFinite(declaredLength) && declaredLength > totalLimit) {
      throw new PayloadTooLargeError(
        `Multipart payload of ${formatSize(declaredLength)} exceeds maximum ${formatSize(totalLimit)}`,
      )
    }
  }

  const contentType = request.headers.get('content-type') || ''
  const boundary = getBoundary(contentType)
  const tmpDirAbs = config?.tmpDir ? resolve(config.tmpDir) : null

  // No usable stream or boundary: fall back to the runtime's buffering parser
  // so callers without a real body stream (some mocks) keep working. Limits
  // are still applied per-file below.
  const stream = (request as any).body
  if (!boundary || !stream || typeof stream.getReader !== 'function') {
    return fallbackFormData(request, { maxFileSize, totalLimit, maxFiles, maxFields, maxParts, tmpDirAbs, config })
  }

  const body: Record<string, any> = {}
  const files = new MultipartFiles()
  const created: UploadedFile[] = []
  let fileCount = 0
  let fieldCount = 0
  let partCount = 0
  let totalSize = 0

  const delimiter = Buffer.from(`\r\n--${boundary}`, 'utf-8')
  const headerSep = Buffer.from('\r\n\r\n', 'utf-8')

  const reader = stream.getReader()
  // Seed with a leading CRLF so the very first boundary (which has no leading
  // CRLF in the wire format) matches the same delimiter we use everywhere.
  let buf: Buffer = Buffer.from([CR, LF])
  let state: St = St.Preamble
  let cur: { name?: string; filename?: string; contentType: string; isFile: boolean } | null = null
  let sink: PartSink | null = null

  const cleanup = async () => {
    if (sink) await sink.discard().catch(() => {})
    for (const f of created) await f.cleanup().catch(() => {})
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value && value.byteLength) {
        totalSize += value.byteLength
        if (totalSize > totalLimit) {
          try { await reader.cancel() } catch {}
          await cleanup()
          throw new PayloadTooLargeError(
            `Multipart payload exceeds maximum ${formatSize(totalLimit)}`,
          )
        }
        buf = buf.length ? Buffer.concat([buf, Buffer.from(value)]) : Buffer.from(value)
      }

      let progressed = true
      while (progressed) {
        progressed = false

        if (state === St.Preamble) {
          // Find the first delimiter, then decide if it's the closing one.
          const idx = indexOfBytes(buf, delimiter, 0)
          if (idx === -1) break
          const after = idx + delimiter.length
          if (after + 2 > buf.length) break // need 2 more bytes to read `--` or CRLF
          if (buf[after] === DASH && buf[after + 1] === DASH) {
            buf = buf.subarray(after + 2)
            state = St.Headers
            // closing boundary right away -> done
            break
          }
          // skip the CRLF following the boundary
          buf = buf.subarray(after + 2)
          state = St.Headers
          progressed = true
        } else if (state === St.Headers) {
          const sep = indexOfBytes(buf, headerSep, 0)
          if (sep === -1) {
            // Guard against an unbounded header block (no CRLFCRLF ever).
            if (buf.length > 64 * 1024) {
              await cleanup()
              throw new PayloadTooLargeError('Multipart part headers too large')
            }
            break
          }
          partCount++
          if (partCount > maxParts) {
            try { await reader.cancel() } catch {}
            await cleanup()
            throw new PayloadTooLargeError(
              `Too many multipart parts: maximum ${maxParts} allowed`,
            )
          }
          const headerBlock = buf.subarray(0, sep).toString('utf-8')
          buf = buf.subarray(sep + headerSep.length)
          const headers = parseHeaders(headerBlock)
          const disp = parseDisposition(headers['content-disposition'] || '')
          const isFile = disp.filename !== undefined
          cur = {
            name: disp.name,
            filename: disp.filename,
            contentType: headers['content-type'] || 'application/octet-stream',
            isFile,
          }
          if (isFile) {
            fileCount++
            // maxFiles is now enforced mid-stream: exceeding it aborts the
            // whole request rather than silently dropping extra files.
            if (fileCount > maxFiles) {
              try { await reader.cancel() } catch {}
              await cleanup()
              throw new PayloadTooLargeError(
                `Too many files: maximum ${maxFiles} allowed`,
              )
            }
            const tmpPath = tmpDirAbs ? resolveTmpPath(tmpDirAbs, cur.filename || '', config) : null
            if (tmpDirAbs && tmpPath === null) {
              // invalid tmp filename hook -> treat as memory-only
              sink = new PartSink(Infinity, null)
            } else {
              const { mkdir } = await import('fs/promises')
              if (tmpPath) await mkdir(tmpDirAbs as string, { recursive: true }).catch(() => {})
              sink = new PartSink(spillThreshold, tmpPath)
            }
          } else {
            fieldCount++
            if (fieldCount > maxFields) {
              try { await reader.cancel() } catch {}
              await cleanup()
              throw new PayloadTooLargeError(
                `Too many form fields: maximum ${maxFields} allowed`,
              )
            }
            sink = new PartSink(Infinity, null)
          }
          state = St.Body
          progressed = true
        } else if (state === St.Body) {
          const idx = indexOfBytes(buf, delimiter, 0)
          if (idx === -1) {
            // No delimiter yet: flush everything except a tail that could be a
            // partial delimiter, so we never split across a boundary.
            const keep = delimiter.length
            if (buf.length > keep) {
              const flush = buf.subarray(0, buf.length - keep)
              await pushBody(sink as PartSink, flush, cur as any, maxFileSize, async () => {
                try { await reader.cancel() } catch {}
                await cleanup()
              })
              buf = buf.subarray(buf.length - keep)
            }
            break
          }
          // Found the closing delimiter for this part.
          const partBytes = buf.subarray(0, idx)
          await pushBody(sink as PartSink, partBytes, cur as any, maxFileSize, async () => {
            try { await reader.cancel() } catch {}
            await cleanup()
          })
          const after = idx + delimiter.length
          if (after + 2 > buf.length) {
            // Need the 2 bytes after the delimiter to know if we're done;
            // stash and wait for more. Rewind so the delimiter is re-found.
            buf = buf.subarray(idx)
            await finishPart(cur as any, sink as PartSink, body, files, created)
            cur = null
            sink = null
            state = St.Preamble
            break
          }
          await finishPart(cur as any, sink as PartSink, body, files, created)
          cur = null
          sink = null
          if (buf[after] === DASH && buf[after + 1] === DASH) {
            buf = buf.subarray(after + 2)
            state = St.Headers // effectively done; loop will find no more
            break
          }
          buf = buf.subarray(after + 2)
          state = St.Headers
          progressed = true
        }
      }

      if (done) break
    }
  } finally {
    try { reader.releaseLock?.() } catch {}
  }

  return { body, files }
}

/** Write part bytes through the sink, enforcing per-file maxFileSize. */
async function pushBody(
  sink: PartSink,
  bytes: Uint8Array,
  cur: { isFile: boolean; name?: string },
  maxFileSize: number,
  onAbort: () => Promise<void>,
) {
  await sink.write(bytes)
  if (cur.isFile && sink.size > maxFileSize) {
    await onAbort()
    throw new PayloadTooLargeError(
      `File size exceeds maximum ${formatSize(maxFileSize)}`,
    )
  }
}

/** Materialize a finished part into the body map or files collection. */
async function finishPart(
  cur: { name?: string; filename?: string; contentType: string; isFile: boolean },
  sink: PartSink,
  body: Record<string, any>,
  files: MultipartFiles,
  created: UploadedFile[],
) {
  const { buffer, path } = await sink.finish()
  if (cur.isFile) {
    const key = cur.name || cur.filename || 'file'
    const info = { filename: cur.filename || '', contentType: cur.contentType }
    let uploaded: UploadedFile
    if (path) {
      uploaded = UploadedFile.fromDisk(key, info, path, sink.size)
      uploaded.tmpPath = path
    } else {
      uploaded = UploadedFile.fromBuffer(key, info, buffer || Buffer.alloc(0))
    }
    created.push(uploaded)
    files.add(key, uploaded)
  } else {
    const key = cur.name || ''
    const val = (buffer || Buffer.alloc(0)).toString('utf-8')
    if (body[key] !== undefined) {
      if (Array.isArray(body[key])) body[key].push(val)
      else body[key] = [body[key], val]
    } else {
      body[key] = val
    }
  }
}

/**
 * Resolve and harden a temp file path for a spilled part. Returns null when a
 * user-supplied `tmpFileName()` hook produces a name that would escape
 * `tmpDirAbs` (path traversal / absolute path).
 */
function resolveTmpPath(tmpDirAbs: string, clientName: string, config?: BodyParserConfig['multipart']): string | null {
  const ext = clientName.includes('.') ? (clientName.split('.').pop() as string).toLowerCase() : 'bin'
  const raw = config?.tmpFileName ? config.tmpFileName() : `${crypto.randomUUID()}.${ext}`
  const safeName = basename(String(raw))
  if (!safeName || safeName === '.' || safeName === '..' || isAbsolute(safeName)) return null
  const tmpPath = join(tmpDirAbs, safeName)
  const rel = relative(tmpDirAbs, tmpPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return tmpPath
}


/**
 * Fallback for requests without a readable body stream (e.g. some test mocks).
 * Uses the runtime's buffering `formData()`. Limits are applied per-file as
 * before; `maxFiles` aborts with an error here too for consistency.
 */
async function fallbackFormData(
  request: Request,
  opts: {
    maxFileSize: number
    totalLimit: number
    maxFiles: number
    maxFields: number
    maxParts: number
    tmpDirAbs: string | null
    config?: BodyParserConfig['multipart']
  },
): Promise<{ body: Record<string, any>; files: MultipartFiles }> {
  const formData = await request.formData()
  const body: Record<string, any> = {}
  const files = new MultipartFiles()
  let fileCount = 0
  let fieldCount = 0
  let partCount = 0
  let totalSize = 0

  for (const [key, value] of formData.entries()) {
    partCount++
    if (partCount > opts.maxParts) {
      throw new PayloadTooLargeError(`Too many multipart parts: maximum ${opts.maxParts} allowed`)
    }
    if (typeof (value as any).arrayBuffer === 'function' && (value as any).name !== undefined) {
      fileCount++
      if (fileCount > opts.maxFiles) {
        throw new PayloadTooLargeError(`Too many files: maximum ${opts.maxFiles} allowed`)
      }

      const uploaded = new UploadedFile(key, value as unknown as File)
      await uploaded.init(value as unknown as File)
      totalSize += uploaded.size

      if (uploaded.size > opts.maxFileSize) {
        uploaded.errors.push({
          field: key,
          rule: 'size',
          message: `File size ${formatSize(uploaded.size)} exceeds maximum ${formatSize(opts.maxFileSize)}`,
        })
      }
      if (totalSize > opts.totalLimit) {
        uploaded.errors.push({
          field: key,
          rule: 'totalSize',
          message: `Total upload size exceeds maximum ${formatSize(opts.totalLimit)}`,
        })
      }

      if (opts.tmpDirAbs) {
        const tmpPath = resolveTmpPath(opts.tmpDirAbs, uploaded.clientName, opts.config)
        if (tmpPath === null) {
          uploaded.errors.push({ field: key, rule: 'tmpFileName', message: 'Invalid temp filename' })
          files.add(key, uploaded)
          continue
        }
        const { mkdir } = await import('fs/promises')
        const { writeFile } = await import('@tekir/runtime')
        await mkdir(opts.tmpDirAbs, { recursive: true }).catch(() => {})
        await writeFile(tmpPath, uploaded.toBuffer())
        uploaded.tmpPath = tmpPath
      }

      files.add(key, uploaded)
    } else {
      fieldCount++
      if (fieldCount > opts.maxFields) {
        throw new PayloadTooLargeError(`Too many form fields: maximum ${opts.maxFields} allowed`)
      }
      if (body[key] !== undefined) {
        if (Array.isArray(body[key])) body[key].push(value)
        else body[key] = [body[key], value]
      } else {
        body[key] = value
      }
    }
  }

  return { body, files }
}
