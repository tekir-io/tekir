import type { UploadValidationOptions } from './validation'

export interface FileMetadata {
  size: number
  lastModified: Date
  contentType?: string
  etag?: string
}

export interface SignedUrlOptions {
  expiresIn: number // seconds
}

export interface PutOptions {
  contentType?: string
  visibility?: 'public' | 'private'
  metadata?: Record<string, string>
}

export interface DiskDriver {
  /** Read file contents as Buffer */
  get(key: string): Promise<Buffer>
  /** Read file contents as a readable stream */
  getStream(key: string): Promise<ReadableStream>
  /** Read file contents as string */
  getString(key: string): Promise<string>
  /** Write content to storage */
  put(key: string, content: Buffer | string | ReadableStream, options?: PutOptions): Promise<void>
  /** Delete a file */
  delete(key: string): Promise<void>
  /** Check if a file exists */
  exists(key: string): Promise<boolean>
  /** Copy a file */
  copy(source: string, destination: string): Promise<void>
  /** Move a file */
  move(source: string, destination: string): Promise<void>
  /** Get file metadata */
  getMetadata(key: string): Promise<FileMetadata>
  /** Get a public URL for the file */
  getUrl(key: string): string
  /** Get a signed URL with expiration */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>
  /** Verify a signed URL token. Returns true if the signature matches and the URL has not expired. */
  verifySignedUrl?(key: string, token: string, expires: number | string): boolean
  /** List files in a directory/prefix */
  list(prefix?: string): Promise<string[]>
}

export interface DriveConfig {
  default: string
  disks: Record<string, DiskConfig>
}

export type DiskConfig =
  | { driver: 'local'; root: string; urlPrefix?: string; secret?: string; upload?: UploadValidationOptions }
  | { driver: 's3'; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string; forcePathStyle?: boolean }
  | { driver: 'r2'; bucket: string; accountId: string; accessKeyId: string; secretAccessKey: string }
  | { driver: 'gcs'; bucket: string; projectId: string; keyFilename?: string }
  | { driver: 'memory' }
