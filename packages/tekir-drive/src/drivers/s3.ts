import type { DiskDriver, DiskConfig, FileMetadata, PutOptions, SignedUrlOptions } from '../types'
import { sha256Hex, hmacSha256, hmacSha256Raw, hmacSha256Hex } from '../crypto'

/** AWS SigV4's stricter RFC3986 encoding (encodeURIComponent leaves !'()*). */
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function encodeKey(key: string): string {
  return key.split('/').map(awsEncode).join('/')
}

function canonicalQuery(entries: Array<[string, string]>): string {
  return entries
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/**
 * Disk driver for Amazon S3 and S3-compatible storage (e.g. Cloudflare R2).
 * Handles request signing with AWS Signature V4 using the Web Crypto API.
 *
 * @example
 * ```ts
 * const s3 = new S3Driver({ driver: 's3', bucket: 'my-bucket', region: 'us-east-1', accessKeyId: '...', secretAccessKey: '...' })
 * await s3.put('uploads/file.txt', 'hello')
 * const url = await s3.getSignedUrl('uploads/file.txt', { expiresIn: 3600 })
 * ```
 */
export class S3Driver implements DiskDriver {
  private bucket: string
  private region: string
  private accessKeyId: string
  private secretAccessKey: string
  private endpoint: string
  private forcePathStyle: boolean

  /**
   * Create a new S3Driver.
   *
   * @param config - S3 or R2 disk configuration containing bucket, credentials, and endpoint details.
   */
  constructor(config: Extract<DiskConfig, { driver: 's3' }> | Extract<DiskConfig, { driver: 'r2' }>) {
    if (config.driver === 'r2') {
      this.bucket = config.bucket
      this.region = 'auto'
      this.accessKeyId = config.accessKeyId
      this.secretAccessKey = config.secretAccessKey
      this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`
      this.forcePathStyle = true
    } else {
      this.bucket = config.bucket
      this.region = config.region
      this.accessKeyId = config.accessKeyId
      this.secretAccessKey = config.secretAccessKey
      this.endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).replace(/\/+$/, '')
      this.forcePathStyle = config.forcePathStyle || false
    }
  }

  private getHost(): string {
    if (this.forcePathStyle) return new URL(this.endpoint).host
    return `${this.bucket}.${new URL(this.endpoint).host}`
  }

  private getPath(key: string): string {
    const encoded = encodeKey(key)
    if (this.forcePathStyle) return `/${awsEncode(this.bucket)}${encoded ? `/${encoded}` : ''}`
    return `/${encoded}`
  }

  private async sign(
    method: string,
    key: string,
    headers: Record<string, string> = {},
    query: Array<[string, string]> = [],
  ): Promise<Record<string, string>> {
    const now = new Date()
    const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8)
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const host = this.getHost()
    const path = this.getPath(key)

    const allHeaders: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      ...headers,
    }

    const signedHeaderKeys = Object.keys(allHeaders).sort().join(';')
    const canonicalHeaders = Object.keys(allHeaders).sort()
      .map(k => `${k}:${allHeaders[k]}\n`).join('')

    const canonicalRequest = [
      method, path, canonicalQuery(query), canonicalHeaders, signedHeaderKeys, 'UNSIGNED-PAYLOAD'
    ].join('\n')

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, scope,
      await sha256Hex(canonicalRequest),
    ].join('\n')

    const kDate = await hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp)
    const kRegion = await hmacSha256Raw(kDate, this.region)
    const kService = await hmacSha256Raw(kRegion, 's3')
    const kSigning = await hmacSha256Raw(kService, 'aws4_request')
    const signature = await hmacSha256Hex(kSigning, stringToSign)

    allHeaders['Authorization'] = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaderKeys}, Signature=${signature}`

    return allHeaders
  }

  private buildUrl(key: string): string {
    const path = encodeKey(key)
    if (this.forcePathStyle) return `${this.endpoint}/${awsEncode(this.bucket)}/${path}`
    return `${this.endpoint.replace('://', `://${this.bucket}.`)}/${path}`
  }

  /**
   * Read file contents as a Buffer from S3.
   *
   * @param key - The object key (path) in the bucket.
   * @returns The file contents as a Buffer.
   * @throws {Error} If the S3 GET request fails.
   */
  async get(key: string): Promise<Buffer> {
    const headers = await this.sign('GET', key)
    const res = await fetch(this.buildUrl(key), { headers })
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status} ${await res.text()}`)
    return Buffer.from(await res.arrayBuffer())
  }

  /**
   * Read file contents as a ReadableStream from S3.
   *
   * @param key - The object key (path) in the bucket.
   * @returns A ReadableStream of the file contents.
   * @throws {Error} If the S3 GET request fails.
   */
  async getStream(key: string): Promise<ReadableStream> {
    const headers = await this.sign('GET', key)
    const res = await fetch(this.buildUrl(key), { headers })
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status}`)
    return res.body as ReadableStream
  }

  /**
   * Read file contents as a UTF-8 string from S3.
   *
   * @param key - The object key (path) in the bucket.
   * @returns The file contents as a string.
   * @throws {Error} If the S3 GET request fails.
   */
  async getString(key: string): Promise<string> {
    const buf = await this.get(key)
    return buf.toString('utf-8')
  }

  /**
   * Write content to S3.
   *
   * @param key - The object key (path) to write to.
   * @param content - The data to store (Buffer, string, or ReadableStream).
   * @param options - Optional {@link PutOptions} such as content type and visibility.
   * @returns Resolves when the upload is complete.
   * @throws {Error} If the S3 PUT request fails.
   *
   * @example
   * ```ts
   * await s3.put('uploads/photo.jpg', fileBuffer, { contentType: 'image/jpeg', visibility: 'public' })
   * ```
   */
  async put(key: string, content: Buffer | string | ReadableStream, options?: PutOptions): Promise<void> {
    let body: string | Buffer
    if (content instanceof ReadableStream) {
      const chunks: Uint8Array[] = []
      const reader = content.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      body = Buffer.concat(chunks)
    } else {
      body = typeof content === 'string' ? content : content
    }

    const extraHeaders: Record<string, string> = {}
    if (options?.contentType) extraHeaders['content-type'] = options.contentType
    if (options?.visibility === 'public') extraHeaders['x-amz-acl'] = 'public-read'

    const headers = await this.sign('PUT', key, extraHeaders)
    const res = await fetch(this.buildUrl(key), { method: 'PUT', headers, body: body as any })
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${await res.text()}`)
  }

  /**
   * Delete a file from S3.
   *
   * @param key - The object key (path) to delete.
   * @returns Resolves when the deletion request is complete.
   */
  async delete(key: string): Promise<void> {
    const headers = await this.sign('DELETE', key)
    const res = await fetch(this.buildUrl(key), { method: 'DELETE', headers })
    if (!res.ok) throw new Error(`S3 DELETE failed: ${res.status} ${await res.text()}`)
  }

  /**
   * Check whether a file exists in S3 by issuing a HEAD request.
   *
   * @param key - The object key (path) to check.
   * @returns `true` if the object exists, `false` otherwise.
   */
  async exists(key: string): Promise<boolean> {
    const headers = await this.sign('HEAD', key)
    const res = await fetch(this.buildUrl(key), { method: 'HEAD', headers })
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`S3 HEAD failed while checking existence: ${res.status}`)
    return true
  }

  /**
   * Copy a file within the S3 bucket using a server-side copy.
   *
   * @param source - The object key of the source file.
   * @param destination - The object key for the copy.
   * @returns Resolves when the copy is complete.
   * @throws {Error} If the S3 COPY request fails.
   */
  async copy(source: string, destination: string): Promise<void> {
    const headers = await this.sign('PUT', destination, {
      'x-amz-copy-source': `/${awsEncode(this.bucket)}/${encodeKey(source)}`,
    })
    const res = await fetch(this.buildUrl(destination), { method: 'PUT', headers })
    if (!res.ok) throw new Error(`S3 COPY failed: ${res.status}`)
  }

  /**
   * Move (rename) a file within the S3 bucket by copying then deleting the source.
   *
   * @param source - The current object key of the file.
   * @param destination - The new object key for the file.
   * @returns Resolves when the move is complete.
   */
  async move(source: string, destination: string): Promise<void> {
    if (source === destination) return
    await this.copy(source, destination)
    await this.delete(source)
  }

  /**
   * Retrieve metadata for a file in S3 via a HEAD request.
   *
   * @param key - The object key (path) of the file.
   * @returns A {@link FileMetadata} object with size, last modified date, content type, and ETag.
   * @throws {Error} If the S3 HEAD request fails.
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const headers = await this.sign('HEAD', key)
    const res = await fetch(this.buildUrl(key), { method: 'HEAD', headers })
    if (!res.ok) throw new Error(`S3 HEAD failed: ${res.status}`)
    const lastModified = res.headers.get('last-modified')
    if (!lastModified) throw new Error('S3 HEAD response is missing Last-Modified')
    return {
      size: Number(res.headers.get('content-length') || 0),
      lastModified: new Date(lastModified),
      contentType: res.headers.get('content-type') || undefined,
      etag: res.headers.get('etag') || undefined,
    }
  }

  /**
   * Get a public URL for a file in S3.
   *
   * @param key - The object key (path) of the file.
   * @returns The public URL string.
   */
  getUrl(key: string): string {
    return this.buildUrl(key)
  }

  /**
   * Generate a pre-signed URL for temporary access to a file in S3.
   * Uses AWS Signature V4 query-string signing.
   *
   * @param key - The object key (path) of the file.
   * @param options - {@link SignedUrlOptions} with `expiresIn` in seconds.
   * @returns The pre-signed URL string.
   *
   * @example
   * ```ts
   * const url = await s3.getSignedUrl('private/report.pdf', { expiresIn: 3600 })
   * ```
   */
  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    if (!Number.isInteger(options.expiresIn) || options.expiresIn < 1 || options.expiresIn > 604800) {
      throw new Error('S3 signed URL expiresIn must be an integer between 1 and 604800 seconds')
    }
    const now = new Date()
    const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8)
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`
    const host = this.getHost()
    const path = this.getPath(key)

    const params: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.accessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(options.expiresIn)],
      ['X-Amz-SignedHeaders', 'host'],
    ]
    const query = canonicalQuery(params)

    const canonicalRequest = `GET\n${path}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`

    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`

    const kDate = await hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp)
    const kRegion = await hmacSha256Raw(kDate, this.region)
    const kService = await hmacSha256Raw(kRegion, 's3')
    const kSigning = await hmacSha256Raw(kService, 'aws4_request')
    const signature = await hmacSha256Hex(kSigning, stringToSign)

    return `${this.buildUrl(key)}?${query}&X-Amz-Signature=${signature}`
  }

  /**
   * List object keys in the S3 bucket, optionally filtered by prefix.
   *
   * @param prefix - Optional prefix to filter results (e.g. `'uploads/'`).
   * @returns An array of object key strings.
   */
  async list(prefix = ''): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined
    // ListObjectsV2 caps each response at 1000 keys, so follow
    // IsTruncated/NextContinuationToken until the listing is exhausted
    // instead of silently dropping everything past the first page.
    do {
      const params: Array<[string, string]> = [['list-type', '2']]
      if (prefix) params.push(['prefix', prefix])
      if (continuationToken) params.push(['continuation-token', continuationToken])
      const query = canonicalQuery(params)
      const url = this.forcePathStyle
        ? `${this.endpoint}/${awsEncode(this.bucket)}?${query}`
        : `${this.endpoint.replace('://', `://${this.bucket}.`)}?${query}`

      const headers = await this.sign('GET', '', {}, params)
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`S3 LIST failed: ${res.status} ${await res.text()}`)
      const text = await res.text()

      const regex = /<Key>([^<]*)<\/Key>/g
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) keys.push(decodeXmlEntities(match[1]))

      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(text)
      const tokenMatch = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(text)
      continuationToken = truncated && tokenMatch ? decodeXmlEntities(tokenMatch[1]) : undefined
    } while (continuationToken)
    return keys
  }
}

// Decode the five predefined XML entities that S3 may emit inside <Key>.
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
