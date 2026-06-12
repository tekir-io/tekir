import { join } from 'path'
import { mkdir, unlink } from 'fs/promises'
import { writeFile } from '@tekir/runtime'
import type { FileValidationOptions, FileError } from './types'


/**
 * Parse a human-readable size string into bytes.
 *
 * @param size - A numeric byte count or a string with a unit suffix (`b`, `kb`, `mb`, `gb`).
 * @returns The size in bytes.
 * @throws {Error} If the string format is invalid.
 *
 * @example
 * ```ts
 * parseSize('2mb')   // 2097152
 * parseSize('500kb') // 512000
 * parseSize(1024)    // 1024
 * ```
 */
export function parseSize(size: string | number): number {
  if (typeof size === 'number') return size
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i)
  if (!match) throw new Error(`Invalid size format: ${size}`)
  const num = parseFloat(match[1])
  switch (match[2].toLowerCase()) {
    case 'b': return num
    case 'kb': return num * 1024
    case 'mb': return num * 1024 * 1024
    case 'gb': return num * 1024 * 1024 * 1024
    default: return num
  }
}

/**
 * Format a byte count into a human-readable size string.
 *
 * @param bytes - The number of bytes to format.
 * @returns A human-readable string such as `'1.5mb'` or `'300kb'`.
 *
 * @example
 * ```ts
 * formatSize(2097152)  // '2.0mb'
 * formatSize(512000)   // '500.0kb'
 * formatSize(100)      // '100b'
 * ```
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}mb`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}gb`
}


/**
 * Represents a file uploaded via multipart form.
 *
 * @example
 * const avatar = ctx.file('avatar', { size: '2mb', extnames: ['jpg', 'png'] })
 * if (avatar.hasErrors) return ctx.response.unprocessableEntity({ errors: avatar.errors })
 * await avatar.moveToDisk('avatars')  // uses @tekir/drive
 * await avatar.move('/path/to/dir', 'custom-name.jpg')
 */
export class UploadedFile {
  fieldName: string
  clientName: string
  size: number
  type: string
  subtype: string
  extname: string
  headers: Record<string, string>
  errors: FileError[] = []
  tmpPath: string | null = null
  filePath: string | null = null
  fileName: string | null = null

  // When a streamed part is large it is spilled to a temp file on disk
  // instead of being held in memory. `data` then stays null and the buffer
  // accessors read lazily from `tmpPath`. This keeps memory bounded for the
  // streaming multipart parser while preserving the in-memory fast path that
  // the `init(File)` constructor flow (and most tests) rely on.
  private spilled = false

  private data: Buffer

  constructor(
    fieldName: string,
    file: File,
    private validationOptions?: FileValidationOptions,
  ) {
    this.fieldName = fieldName
    this.clientName = file.name
    this.size = file.size
    const [type, subtype] = (file.type || 'application/octet-stream').split('/')
    this.type = type
    this.subtype = subtype || ''
    this.extname = file.name.includes('.') ? (file.name.split('.').pop() as string).toLowerCase() : ''
    this.headers = {}
    this.data = null as any // will be set in init()

    if (validationOptions) this.validate(validationOptions)
  }

  // Must be called after constructor since File.arrayBuffer() is async
  async init(file: File): Promise<this> {
    this.data = Buffer.from(await file.arrayBuffer())
    this.validateContent()
    return this
  }

  /**
   * Build an {@link UploadedFile} from raw streamed metadata and an in-memory
   * buffer. Used by the streaming multipart parser for parts that stayed under
   * the disk-spill threshold.
   */
  static fromBuffer(
    fieldName: string,
    info: { filename: string; contentType: string },
    data: Buffer,
  ): UploadedFile {
    const file = { name: info.filename, type: info.contentType, size: data.length } as File
    const u = new UploadedFile(fieldName, file)
    u.data = data
    return u
  }

  /**
   * Build an {@link UploadedFile} backed by a temp file on disk. The content
   * never lives fully in memory; buffer accessors read it back lazily. Used by
   * the streaming multipart parser once a part crosses the spill threshold.
   */
  static fromDisk(
    fieldName: string,
    info: { filename: string; contentType: string },
    tmpPath: string,
    size: number,
  ): UploadedFile {
    const file = { name: info.filename, type: info.contentType, size } as File
    const u = new UploadedFile(fieldName, file)
    u.spilled = true
    u.tmpPath = tmpPath
    u.data = null as any
    return u
  }

  /** True when the file content lives on disk (spilled) rather than in memory. */
  get isSpilled(): boolean {
    return this.spilled
  }

  get hasErrors(): boolean {
    return this.errors.length > 0
  }

  get isValid(): boolean {
    return this.errors.length === 0
  }

  /**
   * Get the file content as a raw Buffer.
   *
   * @returns The file data as a {@link Buffer}.
   *
   * @example
   * ```ts
   * const buf = file.toBuffer()
   * console.log(buf.length) // byte size
   * ```
   */
  toBuffer(): Buffer {
    // Spilled files live on disk to keep memory bounded; pull the bytes back
    // synchronously on demand. Most callers go through the in-memory fast path
    // and never touch the filesystem here.
    if (this.spilled && !this.data) {
      const { readFileSync } = require('fs')
      this.data = readFileSync(this.tmpPath as string)
    }
    return this.data
  }

  /**
   * Get the file content decoded as a string.
   *
   * @param encoding - The character encoding to use. Defaults to `'utf-8'`.
   * @returns The file data as a string.
   *
   * @example
   * ```ts
   * const text = file.toString('utf-8')
   * ```
   */
  toString(encoding: BufferEncoding = 'utf-8'): string {
    return this.toBuffer().toString(encoding)
  }

  /**
   * Get the file content as a web {@link ReadableStream}.
   *
   * @returns A ReadableStream that emits the file buffer in a single chunk.
   *
   * @example
   * ```ts
   * const stream = file.toStream()
   * const response = new Response(stream)
   * ```
   */
  toStream(): ReadableStream {
    const buf = this.toBuffer()
    return new ReadableStream({
      start(controller) { controller.enqueue(buf); controller.close() }
    })
  }

  /**
   * Move the uploaded file to a directory on the local filesystem.
   * Creates the target directory recursively if it does not exist.
   * When no name is provided a random UUID-based filename is generated.
   *
   * @param directory - Absolute or relative path to the target directory.
   * @param name - Optional custom filename (path separators are replaced with `_`).
   * @returns Resolves when the file has been written.
   *
   * @example
   * ```ts
   * await file.move('/uploads/avatars')
   * await file.move('/uploads/avatars', 'custom-name.jpg')
   * ```
   */
  async move(directory: string, name?: string): Promise<void> {
    await mkdir(directory, { recursive: true }).catch(() => {})
    const safeName = (name || `${crypto.randomUUID()}.${this.extname}`).replace(/[/\\]/g, '_')
    this.fileName = safeName
    this.filePath = join(directory, this.fileName)
    await writeFile(this.filePath, this.toBuffer())
  }

  /**
   * Move the uploaded file to a Drive disk (requires `@tekir/drive`).
   * The file is stored under `directory/name` using the configured disk driver.
   *
   * @param directory - The directory (prefix) inside the disk, e.g. `'avatars'`.
   * @param options - Optional settings.
   * @param options.disk - Name of the disk to use (defaults to the Drive default disk).
   * @param options.name - Custom filename. Defaults to a random UUID with the original extension.
   * @returns The full storage key (e.g. `'avatars/abc.jpg'`).
   * @throws {Error} If `@tekir/drive` is not configured.
   *
   * @example
   * ```ts
   * const key = await file.moveToDisk('avatars')
   * const key = await file.moveToDisk('avatars', { disk: 's3' })
   * const key = await file.moveToDisk('avatars', { name: 'custom.jpg' })
   * ```
   */
  async moveToDisk(directory: string, options?: { disk?: string; name?: string }): Promise<string> {
    try {

      const { getApp } = require('@tekir/core')
      const drive = getApp().use('drive')
      const disk = options?.disk ? drive.use(options.disk) : drive
      const rawName = options?.name || `${crypto.randomUUID()}.${this.extname}`
      const name = rawName.replace(/[/\\]/g, '_')
      const key = directory ? `${directory}/${name}` : name
      await disk.put(key, this.toBuffer(), { contentType: `${this.type}/${this.subtype}` })
      this.fileName = name
      this.filePath = key
      return key
    } catch (e: any) {
      throw new Error(`moveToDisk failed: ${e.message}. Is @tekir/drive configured?`)
    }
  }

  /**
   * Delete the file from the local filesystem.
   * Only effective if the file was previously moved via {@link move}.
   * Silently ignores errors (e.g. file already deleted).
   *
   * @returns Resolves when the file has been removed (or was not present).
   *
   * @example
   * ```ts
   * await file.move('/uploads/avatars')
   * await file.delete() // removes the file written by move()
   * ```
   */
  async delete(): Promise<void> {
    if (this.filePath) {
      await unlink(this.filePath).catch(() => {})
    }
  }

  /**
   * Remove the spilled temp file backing this upload, if any. Called by the
   * streaming parser when a request is aborted so partial uploads don't leak
   * onto disk. No-op for in-memory files.
   */
  async cleanup(): Promise<void> {
    if (this.spilled && this.tmpPath) {
      await unlink(this.tmpPath).catch(() => {})
      this.tmpPath = null
    }
  }

  /**
   * Detect the real file extension by inspecting magic bytes in the buffer.
   * Supports PNG, JPEG, GIF, WebP, PDF, ZIP, and SVG.
   *
   * @param buffer - The file content buffer (at least the first 256 bytes for SVG detection).
   * @returns The detected extension (e.g. `'png'`, `'jpg'`) or `null` if unrecognised.
   *
   * @example
   * ```ts
   * const ext = file.detectExtname(file.toBuffer())
   * // 'png' | 'jpg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'svg' | null
   * ```
   */
  detectExtname(buffer: Buffer): string | null {
    if (buffer.length < 4) return null
    const head = buffer.slice(0, 12)
    // PNG
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'png'
    // JPEG
    if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'jpg'
    // GIF
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'gif'
    // WebP
    if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'webp'
    // PDF
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'
    // ZIP
    if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) return 'zip'
    // SVG (text-based). SVG has no binary magic number, so detection sniffs
    // the leading markup. The previous check only matched a buffer that
    // *started* with `<?xml`/`<svg`, missing valid SVGs that open with a BOM,
    // whitespace, an XML comment, or a `<!DOCTYPE svg ...>` — and false-matching
    // arbitrary XML as SVG. We strip a leading BOM, skip insignificant prefix
    // (whitespace + comments), then require an actual `<svg` root element.
    //
    // SECURITY: SVG is an active document — it can embed `<script>` and event
    // handlers, so a stored SVG served inline is a stored-XSS vector. Do NOT
    // add `svg` to an `extnames` whitelist for user-uploaded avatars/images
    // unless you sanitize (e.g. DOMPurify) or always serve it with
    // `Content-Disposition: attachment` / a restrictive CSP. Detection here is
    // only so SVG can be *recognized and rejected*, not implicitly trusted.
    if (this.looksLikeSvg(buffer)) return 'svg'
    return null
  }

  /** Robust SVG sniff: tolerant of BOM, whitespace, comments and DOCTYPE. */
  private looksLikeSvg(buffer: Buffer): boolean {
    let text = buffer.slice(0, 1024).toString('utf-8')
    // Strip UTF-8 BOM.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    let i = 0
    // Skip leading whitespace, XML declarations, comments and the DOCTYPE so a
    // real SVG that doesn't open with the root element is still recognized.
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text.startsWith('<?xml', i)) {
        const end = text.indexOf('?>', i)
        if (end === -1) return false
        i = end + 2
        continue
      }
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i)
        if (end === -1) return false
        i = end + 3
        continue
      }
      if (/^<!doctype\s+svg/i.test(text.slice(i))) return true
      break
    }
    return /^<svg[\s/>]/i.test(text.slice(i))
  }

  /**
   * Validate the file content against the configured `extnames` whitelist
   * by inspecting magic bytes. Called automatically from {@link init} when
   * `extnames` validation is configured.
   *
   * Strict whitelist semantics — any of the following pushes an error:
   *   1. The buffer is empty (`Empty file`).
   *   2. Magic bytes are unrecognized (`Unrecognized file content`).
   *      A renamed `malware.exe` → `malware.jpg` upload falls through here:
   *      `detectExtname` returns `null`, and "unrecognized" is treated as
   *      "outside the whitelist" rather than silently allowed.
   *   3. The detected format is not in `extnames` (`File content (.X) is
   *      not in allowed types: ...`).
   *   4. The declared extension does not match the detected format
   *      (`File extension .X does not match detected type .Y`).
   *
   * `jpg` and `jpeg` are treated as the same format on both sides.
   *
   * When `extnames` is not provided this validator is a no-op — call sites
   * that only care about size limits remain unaffected.
   *
   * @example
   * ```ts
   * file.validateContent()
   * if (file.hasErrors) console.log(file.errors)
   * ```
   */
  validateContent() {
    if (!this.validationOptions?.extnames?.length) return
    if (!this.data || this.data.length === 0) {
      this.errors.push({
        field: this.fieldName,
        rule: 'content',
        message: 'Empty file',
      })
      return
    }

    const detected = this.detectExtname(this.data)

    // Whitelist mode: when `extnames` is set, anything we can't identify
    // by magic bytes is treated as outside the whitelist. Without this,
    // a renamed binary (e.g. `malware.exe` → `malware.jpg`) would slip
    // through because `detectExtname` returns `null` on unknown content.
    if (!detected) {
      this.errors.push({
        field: this.fieldName,
        rule: 'content',
        message: 'Unrecognized file content',
      })
      return
    }

    const normalize = (e: string) => (e === 'jpg' ? 'jpeg' : e)
    const normalizedDetected = normalize(detected)
    const normalizedAllowed = this.validationOptions.extnames.map(normalize)

    if (!normalizedAllowed.includes(normalizedDetected)) {
      this.errors.push({
        field: this.fieldName,
        rule: 'content',
        message: `File content (.${detected}) is not in allowed types: ${this.validationOptions.extnames.map(e => `.${e}`).join(', ')}`,
      })
      return
    }

    // Detected content is in the whitelist; final check is that the
    // declared extension matches what the magic bytes say. Catches the
    // less-malicious "user uploaded a `.png` named `.jpg`" case where
    // both formats are allowed but the declared extension is misleading.
    if (normalize(this.extname) !== normalizedDetected) {
      this.errors.push({
        field: this.fieldName,
        rule: 'extname',
        message: `File extension .${this.extname} does not match detected type .${detected}`,
      })
    }
  }

  private validate(options: FileValidationOptions) {
    if (options.size) {
      const maxBytes = parseSize(options.size)
      if (this.size > maxBytes) {
        this.errors.push({
          field: this.fieldName,
          rule: 'size',
          message: `File size ${formatSize(this.size)} exceeds maximum ${formatSize(maxBytes)}`,
        })
      }
    }

    if (options.extnames && options.extnames.length > 0) {
      if (!options.extnames.includes(this.extname)) {
        this.errors.push({
          field: this.fieldName,
          rule: 'extname',
          message: `File extension .${this.extname} is not allowed. Allowed: ${options.extnames.map(e => `.${e}`).join(', ')}`,
        })
      }
    }
  }
}
