import type { DiskDriver, FileMetadata, PutOptions } from '../types'


/**
 * In-memory disk driver for testing and development.
 * All files are stored in a Map and lost when the process exits.
 *
 * @example
 * ```ts
 * const mem = new MemoryDriver()
 * await mem.put('test.txt', 'hello')
 * const text = await mem.getString('test.txt') // 'hello'
 * ```
 */
export class MemoryDriver implements DiskDriver {
  private store = new Map<string, { content: Buffer; metadata: PutOptions; createdAt: Date }>()

  /**
   * Read file contents as a Buffer.
   *
   * @param key - The storage key of the file.
   * @returns The file contents as a Buffer.
   * @throws {Error} If the file does not exist in the memory store.
   *
   * @example
   * ```ts
   * const buf = await mem.get('test.bin')
   * ```
   */
  async get(key: string): Promise<Buffer> {
    const entry = this.store.get(key)
    if (!entry) throw new Error(`File not found: ${key}`)
    return entry.content
  }

  /**
   * Read file contents as a ReadableStream.
   *
   * @param key - The storage key of the file.
   * @returns A ReadableStream of the file contents.
   * @throws {Error} If the file does not exist in the memory store.
   *
   * @example
   * ```ts
   * const stream = await mem.getStream('test.bin')
   * ```
   */
  async getStream(key: string): Promise<ReadableStream> {
    const buf = await this.get(key)
    return new ReadableStream({
      start(controller) { controller.enqueue(buf); controller.close() }
    })
  }

  /**
   * Read file contents as a UTF-8 string.
   *
   * @param key - The storage key of the file.
   * @returns The file contents decoded as a UTF-8 string.
   * @throws {Error} If the file does not exist in the memory store.
   *
   * @example
   * ```ts
   * const text = await mem.getString('config.json')
   * ```
   */
  async getString(key: string): Promise<string> {
    return (await this.get(key)).toString('utf-8')
  }

  /**
   * Write content to the in-memory store.
   *
   * @param key - The storage key to write to.
   * @param content - The data to store (Buffer, string, or ReadableStream).
   * @param options - Optional {@link PutOptions} such as content type and visibility.
   * @returns Resolves when the write is complete.
   *
   * @example
   * ```ts
   * await mem.put('notes.txt', 'hello world', { contentType: 'text/plain' })
   * ```
   */
  async put(key: string, content: Buffer | string | ReadableStream, options?: PutOptions): Promise<void> {
    let buf: Buffer
    if (content instanceof ReadableStream) {
      const chunks: Uint8Array[] = []
      const reader = content.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      buf = Buffer.concat(chunks)
    } else {
      buf = Buffer.from(content)
    }
    this.store.set(key, { content: buf, metadata: options || {}, createdAt: new Date() })
  }

  /**
   * Delete a file from the in-memory store. Silently succeeds if the file does not exist.
   *
   * @param key - The storage key of the file to delete.
   * @returns Resolves when the deletion is complete.
   */
  async delete(key: string): Promise<void> { this.store.delete(key) }

  /**
   * Check whether a file exists in the in-memory store.
   *
   * @param key - The storage key to check.
   * @returns `true` if the file exists, `false` otherwise.
   */
  async exists(key: string): Promise<boolean> { return this.store.has(key) }

  /**
   * Copy a file within the in-memory store.
   *
   * @param source - The storage key of the source file.
   * @param destination - The storage key for the copy.
   * @returns Resolves when the copy is complete.
   * @throws {Error} If the source file does not exist.
   */
  async copy(source: string, destination: string): Promise<void> {
    const entry = this.store.get(source)
    if (!entry) throw new Error(`File not found: ${source}`)
    this.store.set(destination, { ...entry })
  }

  /**
   * Move (rename) a file within the in-memory store.
   *
   * @param source - The current storage key of the file.
   * @param destination - The new storage key for the file.
   * @returns Resolves when the move is complete.
   * @throws {Error} If the source file does not exist.
   */
  async move(source: string, destination: string): Promise<void> {
    await this.copy(source, destination)
    this.store.delete(source)
  }

  /**
   * Retrieve metadata for a file in the in-memory store.
   *
   * @param key - The storage key of the file.
   * @returns A {@link FileMetadata} object with size, creation date, and content type.
   * @throws {Error} If the file does not exist.
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const entry = this.store.get(key)
    if (!entry) throw new Error(`File not found: ${key}`)
    return { size: entry.content.length, lastModified: entry.createdAt, contentType: entry.metadata.contentType }
  }

  /**
   * Get a public URL for a file. Returns a synthetic `/memory/` path.
   *
   * @param key - The storage key of the file.
   * @returns The URL string.
   */
  getUrl(key: string): string { return `/memory/${key}` }

  /**
   * Generate a signed URL for a file. Returns a synthetic URL with `?signed=true`.
   *
   * @param key - The storage key of the file.
   * @returns The signed URL string.
   */
  async getSignedUrl(key: string): Promise<string> { return `/memory/${key}?signed=true` }

  /**
   * List all files in the in-memory store, optionally filtered by a key prefix.
   *
   * @param prefix - Optional prefix to filter results.
   * @returns An array of storage key strings.
   *
   * @example
   * ```ts
   * const files = await mem.list('avatars/')
   * ```
   */
  async list(prefix = ''): Promise<string[]> {
    const keys: string[] = []
    for (const key of this.store.keys()) {
      if (!prefix || key.startsWith(prefix)) keys.push(key)
    }
    return keys
  }
}
