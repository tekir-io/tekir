import type { DiskDriver, DiskConfig, DriveConfig, PutOptions, SignedUrlOptions } from './types'
import { LocalDriver } from './drivers/local'
import { S3Driver } from './drivers/s3'
import { MemoryDriver } from './drivers/memory'


/**
 * Create a disk driver instance from a disk configuration object.
 *
 * @param config - The disk configuration specifying the driver type and its options.
 * @returns A {@link DiskDriver} instance matching the configured driver.
 * @throws {Error} If the driver type is unknown or unsupported.
 */
function createDriver(config: DiskConfig): DiskDriver {
  switch (config.driver) {
    case 'local': return new LocalDriver(config.root, config.urlPrefix, config.secret, config.upload)
    case 's3': return new S3Driver(config)
    case 'r2': return new S3Driver(config as any)
    case 'gcs': throw new Error('GCS driver requires @google-cloud/storage. Use S3-compatible endpoint instead.')
    case 'memory': return new MemoryDriver()
    default: throw new Error(`Unknown drive driver: ${(config as any).driver}`)
  }
}


/**
 * Drive manager — manages multiple disk instances.
 *
 * @example
 * ```ts
 * import drive from '@tekir/drive'
 *
 * // Use default disk
 * await drive.put('avatars/1.jpg', fileBuffer)
 * const url = drive.getUrl('avatars/1.jpg')
 *
 * // Use specific disk
 * await drive.use('s3').put('backups/db.sql', dump)
 *
 * // Signed URL (S3/R2)
 * const signed = await drive.use('s3').getSignedUrl('private/report.pdf', { expiresIn: 3600 })
 * ```
 */
export class Drive {
  private disks = new Map<string, DiskDriver>()
  private defaultDisk: string
  private config: DriveConfig

  /**
   * Create a new Drive manager.
   *
   * @param config - The {@link DriveConfig} specifying the default disk and all disk configurations.
   */
  constructor(config: DriveConfig) {
    this.config = config
    this.defaultDisk = config.default
  }

  /**
   * Get a disk driver by name. Drivers are lazy-initialized on first access
   * and cached for subsequent calls.
   *
   * @param name - The disk name from config. Defaults to the configured default disk.
   * @returns The {@link DiskDriver} instance for the requested disk.
   * @throws {Error} If the disk name is not found in the configuration.
   *
   * @example
   * ```ts
   * const s3 = drive.use('s3')
   * await s3.put('file.txt', 'hello')
   * ```
   */
  use(name?: string): DiskDriver {
    const diskName = name || this.defaultDisk
    if (!this.disks.has(diskName)) {
      const cfg = this.config.disks[diskName]
      if (!cfg) throw new Error(`Disk "${diskName}" not configured`)
      this.disks.set(diskName, createDriver(cfg))
    }
    return this.disks.get(diskName) as DiskDriver
  }

  /**
   * Register a custom disk driver under the given name.
   * This replaces any existing driver for that name.
   *
   * @param name - The disk name to register.
   * @param driver - A {@link DiskDriver} implementation.
   * @returns The Drive instance for chaining.
   *
   * @example
   * ```ts
   * drive.extend('custom', new MyCustomDriver())
   * await drive.use('custom').put('key', data)
   * ```
   */
  extend(name: string, driver: DiskDriver): this {
    this.disks.set(name, driver)
    return this
  }

  /**
   * Read file contents as a Buffer from the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @returns The file contents as a Buffer.
   */
  get(key: string) { return this.use().get(key) }

  /**
   * Read file contents as a ReadableStream from the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @returns A ReadableStream of the file contents.
   */
  getStream(key: string) { return this.use().getStream(key) }

  /**
   * Read file contents as a UTF-8 string from the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @returns The file contents as a string.
   */
  getString(key: string) { return this.use().getString(key) }

  /**
   * Write content to the default disk.
   *
   * @param key - The storage key (path) to write to.
   * @param content - The data to store (Buffer, string, or ReadableStream).
   * @param options - Optional {@link PutOptions} such as content type and visibility.
   * @returns Resolves when the write is complete.
   *
   * @example
   * ```ts
   * await drive.put('avatars/1.jpg', fileBuffer, { contentType: 'image/jpeg' })
   * ```
   */
  put(key: string, content: Buffer | string | ReadableStream, options?: PutOptions) { return this.use().put(key, content, options) }

  /**
   * Delete a file from the default disk.
   *
   * @param key - The storage key (path) of the file to delete.
   * @returns Resolves when the file has been deleted.
   */
  delete(key: string) { return this.use().delete(key) }

  /**
   * Check if a file exists on the default disk.
   *
   * @param key - The storage key (path) to check.
   * @returns `true` if the file exists, `false` otherwise.
   */
  exists(key: string) { return this.use().exists(key) }

  /**
   * Copy a file within the default disk.
   *
   * @param source - The storage key of the source file.
   * @param destination - The storage key for the copy.
   * @returns Resolves when the copy is complete.
   */
  copy(source: string, destination: string) { return this.use().copy(source, destination) }

  /**
   * Move (rename) a file within the default disk.
   *
   * @param source - The current storage key of the file.
   * @param destination - The new storage key for the file.
   * @returns Resolves when the move is complete.
   */
  move(source: string, destination: string) { return this.use().move(source, destination) }

  /**
   * Retrieve metadata for a file on the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @returns A {@link FileMetadata} object with size, last modified date, and content type.
   */
  getMetadata(key: string) { return this.use().getMetadata(key) }

  /**
   * Get a public URL for a file on the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @returns The public URL string.
   */
  getUrl(key: string) { return this.use().getUrl(key) }

  /**
   * Generate a signed (time-limited) URL for a file on the default disk.
   *
   * @param key - The storage key (path) of the file.
   * @param options - {@link SignedUrlOptions} with `expiresIn` (seconds).
   * @returns The signed URL string.
   *
   * @example
   * ```ts
   * const url = await drive.getSignedUrl('private/report.pdf', { expiresIn: 3600 })
   * ```
   */
  getSignedUrl(key: string, options: SignedUrlOptions) { return this.use().getSignedUrl(key, options) }

  /**
   * List all files on the default disk, optionally filtered by a key prefix.
   *
   * @param prefix - Optional prefix to filter results (e.g. `'avatars/'`).
   * @returns An array of storage key strings.
   */
  list(prefix?: string) { return this.use().list(prefix) }

  /**
   * Switch to a fake (memory) disk for testing.
   * Returns a cleanup function to restore the original driver.
   *
   * @param diskName - The disk name to replace. Defaults to the configured default disk.
   * @returns A cleanup function that restores the original driver when called.
   *
   * @example
   * ```ts
   * const restore = drive.fake()
   * await drive.put('test.txt', 'data')
   * restore() // original driver is back
   * ```
   */
  fake(diskName?: string): () => void {
    const name = diskName || this.defaultDisk
    const original = this.disks.get(name)
    this.disks.set(name, new MemoryDriver())
    return () => {
      if (original) this.disks.set(name, original)
      else this.disks.delete(name)
    }
  }
}
