import { join, dirname, resolve, relative, isAbsolute } from 'path'
import { mkdir, unlink, copyFile, rename, stat, readdir, realpath } from 'fs/promises'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile, readFileText, writeFile, fileExists } from '@tekir/runtime'
import type { DiskDriver, FileMetadata, SignedUrlOptions } from '../types'
import { assertValidUpload, contentByteLength, type UploadValidationOptions } from '../validation'



/**
 * Disk driver that stores files on the local filesystem.
 *
 * Files are written under the configured `root` directory. A URL prefix is used
 * to generate public URLs (e.g. for serving via a static file middleware).
 *
 * @example
 * ```ts
 * const local = new LocalDriver('/var/uploads', '/uploads')
 * await local.put('avatars/1.jpg', fileBuffer)
 * const url = local.getUrl('avatars/1.jpg') // '/uploads/avatars/1.jpg'
 * ```
 */
export class LocalDriver implements DiskDriver {
  private readonly signingSecret: string | null

  /**
   * Create a new LocalDriver.
   *
   * @param root - Absolute path to the root storage directory. Created automatically if it does not exist.
   * @param urlPrefix - URL path prefix used by {@link getUrl} and {@link getSignedUrl}. Defaults to `'/uploads'`.
   * @param secret - HMAC signing secret for {@link getSignedUrl}. Falls back to `process.env.APP_KEY` if omitted.
   *                 Required to issue or verify signed URLs.
   */
  private readonly upload?: UploadValidationOptions

  constructor(private root: string, private urlPrefix = '/uploads', secret?: string, upload?: UploadValidationOptions) {
    mkdir(root, { recursive: true }).catch(() => {})
    this.signingSecret = secret ?? (typeof process !== 'undefined' ? process.env?.APP_KEY ?? null : null)
    this.upload = upload
  }

  private sign(key: string, expires: number): string {
    if (!this.signingSecret) {
      throw new Error('LocalDriver: signed URLs require a secret. Pass one to the constructor or set APP_KEY.')
    }
    return createHmac('sha256', this.signingSecret).update(`${key}:${expires}`).digest('base64url')
  }

  private resolve(key: string): string {
    // Reject embedded NUL bytes up front. Modern fs calls throw on NUL, but
    // doing it here keeps the failure deterministic and defends against
    // legacy path-truncation tricks even where errors are swallowed (the
    // `.catch(() => {})` in put/delete).
    if (key.includes('\0')) {
      throw new Error(`Path traversal detected: "${key}"`)
    }
    const resolved = resolve(this.root, key)
    const rel = relative(this.root, resolved)
    // `isAbsolute(rel)` catches Windows cross-drive paths: when `key`
    // resolves to e.g. `D:\secret` while `root` is `C:\app`, `relative()`
    // returns `'D:\\secret'`, which does not start with `..` but is still
    // not contained under `root`.
    if (rel.startsWith('..') || isAbsolute(rel) || resolve(resolved) !== resolved) {
      throw new Error(`Path traversal detected: "${key}"`)
    }
    return resolved
  }

  // Resolve symlinks on `path` and confirm the real target is still contained
  // under `root`. The string-level `resolve()` above cannot see through a
  // symlink that points outside the root (e.g. a file or directory inside
  // `root` linking to `/etc`), so reads/writes run this extra check before
  // touching disk. A missing path resolves its existing ancestors instead, so
  // a normal not-found never turns into a false traversal positive.
  private async assertContained(key: string, path: string): Promise<string> {
    let realRoot: string
    try {
      realRoot = await realpath(this.root)
    } catch {
      realRoot = this.root
    }
    // Walk up to the nearest existing ancestor: for a write the leaf does not
    // exist yet, but a symlinked parent directory would still redirect it out
    // of the root, so the resolved ancestor is what must be contained.
    let target = path
    let real: string | null = null
    while (true) {
      try {
        real = await realpath(target)
        break
      } catch {
        const parent = dirname(target)
        if (parent === target) break
        target = parent
      }
    }
    if (real === null) return path
    const rel = relative(realRoot, real)
    if (rel === '..' || rel.startsWith('..') || rel.startsWith('/') || isAbsolute(rel)) {
      throw new Error(`Path traversal detected: "${key}"`)
    }
    return path
  }

  // Validate a key string-first (cheap, synchronous) then confirm the real
  // path stays under root once symlinks are resolved (async I/O).
  private async safePath(key: string): Promise<string> {
    const path = this.resolve(key)
    await this.assertContained(key, path)
    return path
  }

  // Encode each path segment of a storage key for safe embedding in a URL,
  // preserving `/` separators. Prevents `../`, spaces, and other characters
  // from altering the generated URL's structure.
  private encodeKey(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/')
  }

  /**
   * Read file contents as a Buffer.
   *
   * @param key - The storage key (relative path) of the file.
   * @returns The file contents as a Buffer.
   * @throws {Error} If the file does not exist or path traversal is detected.
   *
   * @example
   * ```ts
   * const buf = await local.get('avatars/1.jpg')
   * ```
   */
  async get(key: string): Promise<Buffer> {
    return Buffer.from(await readFile(await this.safePath(key)))
  }

  /**
   * Read file contents as a ReadableStream.
   *
   * @param key - The storage key (relative path) of the file.
   * @returns A ReadableStream of the file contents.
   * @throws {Error} If the file does not exist or path traversal is detected.
   *
   * @example
   * ```ts
   * const stream = await local.getStream('videos/intro.mp4')
   * ```
   */
  async getStream(key: string): Promise<ReadableStream> {
    const data = await readFile(await this.safePath(key))
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })
  }

  /**
   * Read file contents as a UTF-8 string.
   *
   * @param key - The storage key (relative path) of the file.
   * @returns The file contents as a string.
   * @throws {Error} If the file does not exist or path traversal is detected.
   *
   * @example
   * ```ts
   * const text = await local.getString('config.json')
   * ```
   */
  async getString(key: string): Promise<string> {
    return readFileText(await this.safePath(key))
  }

  /**
   * Write content to a file on the local filesystem.
   * Parent directories are created automatically.
   *
   * @param key - The storage key (relative path) to write to.
   * @param content - The data to store (Buffer, string, or ReadableStream).
   * @returns Resolves when the write is complete.
   *
   * @example
   * ```ts
   * await local.put('docs/readme.txt', 'Hello world')
   * ```
   */
  async put(key: string, content: Buffer | string | ReadableStream): Promise<void> {
    const path = this.resolve(key)
    // Check the nearest existing ancestor before mkdir: otherwise a symlinked
    // parent could cause recursive mkdir to create directories outside root
    // before the post-mkdir containment check rejects the write.
    await this.assertContained(key, path)
    await mkdir(dirname(path), { recursive: true }).catch(() => {})
    // Verify after mkdir so the parent directory exists and its real path
    // (resolving any symlinks) is confirmed under root before we write.
    await this.assertContained(key, path)

    if (content instanceof ReadableStream) {
      const chunks: Uint8Array[] = []
      const reader = content.getReader()
      let total = 0
      const maxSize = this.upload?.maxSize
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        // Enforce the size limit while streaming so an oversized upload
        // cannot fill memory/disk before we notice.
        if (maxSize !== undefined && total > maxSize) {
          reader.cancel().catch(() => {})
          this.assertUpload(key, total)
        }
        chunks.push(value)
      }
      const buf = Buffer.concat(chunks)
      this.assertUpload(key, buf.byteLength)
      await writeFile(path, buf)
    } else {
      this.assertUpload(key, contentByteLength(content))
      await writeFile(path, content)
    }
  }

  // Enforce the optional upload allowlist + size limit configured on this
  // driver. No-op when no `upload` options were supplied (backward compatible).
  private assertUpload(key: string, size: number): void {
    if (!this.upload) return
    assertValidUpload(key, size, this.upload)
  }

  /**
   * Delete a file from the local filesystem. Silently succeeds if the file does not exist.
   *
   * @param key - The storage key (relative path) of the file to delete.
   * @returns Resolves when the file has been deleted.
   *
   * @example
   * ```ts
   * await local.delete('temp/upload.tmp')
   * ```
   */
  async delete(key: string): Promise<void> {
    await unlink(await this.safePath(key)).catch(() => {})
  }

  /**
   * Check whether a file exists on the local filesystem.
   *
   * @param key - The storage key (relative path) to check.
   * @returns `true` if the file exists, `false` otherwise.
   *
   * @example
   * ```ts
   * if (await local.exists('avatars/1.jpg')) { ... }
   * ```
   */
  async exists(key: string): Promise<boolean> {
    return fileExists(await this.safePath(key))
  }

  /**
   * Copy a file within the local filesystem. Parent directories for the destination are created automatically.
   *
   * @param source - The storage key of the source file.
   * @param destination - The storage key for the copy.
   * @returns Resolves when the copy is complete.
   *
   * @example
   * ```ts
   * await local.copy('avatars/1.jpg', 'backups/avatars/1.jpg')
   * ```
   */
  async copy(source: string, destination: string): Promise<void> {
    const srcPath = await this.safePath(source)
    const destPath = this.resolve(destination)
    await this.assertContained(destination, destPath)
    await mkdir(dirname(destPath), { recursive: true }).catch(() => {})
    await this.assertContained(destination, destPath)
    await copyFile(srcPath, destPath)
  }

  /**
   * Move (rename) a file within the local filesystem. Parent directories for the destination are created automatically.
   *
   * @param source - The current storage key of the file.
   * @param destination - The new storage key for the file.
   * @returns Resolves when the move is complete.
   *
   * @example
   * ```ts
   * await local.move('temp/upload.jpg', 'avatars/1.jpg')
   * ```
   */
  async move(source: string, destination: string): Promise<void> {
    const srcPath = await this.safePath(source)
    const destPath = this.resolve(destination)
    await this.assertContained(destination, destPath)
    await mkdir(dirname(destPath), { recursive: true }).catch(() => {})
    await this.assertContained(destination, destPath)
    await rename(srcPath, destPath)
  }

  /**
   * Retrieve metadata for a file on the local filesystem.
   *
   * @param key - The storage key (relative path) of the file.
   * @returns A {@link FileMetadata} object with size, last modified date, and inferred content type.
   * @throws {Error} If the file does not exist.
   *
   * @example
   * ```ts
   * const meta = await local.getMetadata('avatars/1.jpg')
   * console.log(meta.size, meta.contentType) // 12345 'image/jpeg'
   * ```
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const s = await stat(await this.safePath(key))
    const ext = key.split('.').pop()?.toLowerCase() || ''
    const mimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', txt: 'text/plain', json: 'application/json' }
    return {
      size: s.size,
      lastModified: s.mtime,
      contentType: mimes[ext] || 'application/octet-stream',
    }
  }

  /**
   * Get a public URL for a file, using the configured URL prefix.
   *
   * @param key - The storage key (relative path) of the file.
   * @returns The public URL string.
   *
   * @example
   * ```ts
   * local.getUrl('avatars/1.jpg') // '/uploads/avatars/1.jpg'
   * ```
   */
  getUrl(key: string): string {
    // Validate containment (throws on traversal) then URL-encode each
    // segment so the generated URL cannot be steered by `../` or unsafe
    // characters in `key`.
    this.resolve(key)
    return `${this.urlPrefix}/${this.encodeKey(key)}`
  }

  /**
   * Generate a signed (time-limited) URL for a file.
   * The token is an HMAC-SHA256 signature over `key:expires` using the configured signing secret.
   *
   * @param key - The storage key (relative path) of the file.
   * @param options - {@link SignedUrlOptions} with `expiresIn` in seconds.
   * @returns The signed URL string with token and expiration query parameters.
   * @throws {Error} If no signing secret was configured (constructor argument or `APP_KEY`).
   *
   * @example
   * ```ts
   * const url = await local.getSignedUrl('private/report.pdf', { expiresIn: 3600 })
   * ```
   */
  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    // Validate containment before issuing a token. The signature still
    // covers the raw `key` (so verification compares apples to apples), but
    // the URL path is encoded so it round-trips safely to the client.
    this.resolve(key)
    const expires = Date.now() + options.expiresIn * 1000
    const token = this.sign(key, expires)
    return `${this.urlPrefix}/${this.encodeKey(key)}?token=${token}&expires=${expires}`
  }

  /**
   * Verify a previously generated signed URL.
   *
   * Checks the HMAC signature using constant-time comparison and enforces the
   * embedded expiration timestamp. Apps that serve private files should call
   * this before reading from disk.
   *
   * @param key - The storage key (must match the key used to generate the URL).
   * @param token - The `token` query parameter.
   * @param expires - The `expires` query parameter (millisecond timestamp).
   * @returns `true` if the signature matches and the URL has not expired.
   */
  verifySignedUrl(key: string, token: string, expires: number | string): boolean {
    if (!this.signingSecret) return false
    const expiresMs = typeof expires === 'string' ? Number(expires) : expires
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) return false
    let expected: Buffer
    let provided: Buffer
    try {
      expected = Buffer.from(this.sign(key, expiresMs), 'base64url')
      provided = Buffer.from(token, 'base64url')
    } catch {
      return false
    }
    if (expected.length !== provided.length) return false
    return timingSafeEqual(expected, provided)
  }

  /**
   * List all files under the given prefix by recursively walking the directory tree.
   *
   * @param prefix - Optional prefix (subdirectory) to filter results. Defaults to `''` (all files).
   * @returns An array of storage key strings relative to the root.
   *
   * @example
   * ```ts
   * const files = await local.list('avatars/')
   * // => ['avatars/1.jpg', 'avatars/2.png']
   * ```
   */
  async list(prefix = ''): Promise<string[]> {
    const dir = await this.safePath(prefix)
    if (!(await fileExists(dir))) return []
    const files: string[] = []
    const walk = async (d: string, rel: string) => {
      const entries = await readdir(d, { withFileTypes: true })
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(join(d, entry.name), entryRel)
        else files.push(entryRel)
      }
    }
    await walk(dir, prefix)
    return files
  }
}
