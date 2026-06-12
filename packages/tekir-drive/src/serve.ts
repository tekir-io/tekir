import { LocalDriver } from './drivers/local'

export interface ServeDriveOptions {
  /**
   * The driver whose files should be served. Must be a {@link LocalDriver}
   * (S3/R2 serve directly from their own signed endpoints).
   */
  driver: LocalDriver
  /**
   * URL path prefix the files live under (e.g. `'/uploads'`). Requests whose
   * pathname starts with this prefix are handled; everything else falls
   * through. Defaults to `'/uploads'`.
   */
  urlPrefix?: string
  /**
   * When `true` (the default), every request MUST carry a valid
   * `?token=...&expires=...` signature produced by
   * {@link LocalDriver.getSignedUrl}. This is the secure default: a leaked
   * direct path cannot be read without the signature.
   *
   * Set to `false` only for genuinely public buckets where unsigned access
   * is intended.
   */
  requireSignature?: boolean
}

/**
 * Build a `server.fallback`-compatible handler that serves files from a
 * {@link LocalDriver} and ENFORCES signed-URL verification.
 *
 * This closes the gap where `getSignedUrl()` issued a token but nothing on
 * the serving path ever checked it, so a "private" file was still readable
 * via its plain `/uploads/<key>` path. With `requireSignature` (default) the
 * handler rejects any request lacking a valid, unexpired token for the exact
 * key requested.
 *
 * @example
 * ```ts
 * const disk = drive.use('local') as LocalDriver
 * server.fallback(serveDrive({ driver: disk, urlPrefix: '/uploads' }))
 * ```
 */
export function serveDrive(options: ServeDriveOptions) {
  const driver = options.driver
  const prefix = (options.urlPrefix ?? '/uploads').replace(/\/+$/, '')
  const requireSignature = options.requireSignature !== false

  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Only handle requests under our prefix; otherwise fall through.
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) {
      return null
    }

    let key = pathname.slice(prefix.length).replace(/^\/+/, '')
    try {
      key = decodeURIComponent(key)
    } catch {
      return new Response('{"error":"Bad Request"}', { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (!key || key.includes('\0')) {
      return new Response('{"error":"Bad Request"}', { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (requireSignature) {
      const token = url.searchParams.get('token')
      const expires = url.searchParams.get('expires')
      if (!token || !expires || !driver.verifySignedUrl(key, token, expires)) {
        return new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // `driver.exists`/`get` run `resolve()`, which re-validates the key
    // against the root, so traversal is caught here too.
    try {
      if (!(await driver.exists(key))) {
        return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      const meta = await driver.getMetadata(key)
      const data = await driver.get(key)
      return new Response(data as any, {
        headers: {
          'Content-Type': meta.contentType || 'application/octet-stream',
          'Content-Length': String(meta.size),
        },
      })
    } catch {
      // Traversal or read error: never leak details, just deny.
      return new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
  }
}
