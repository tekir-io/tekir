/**
 * Upload validation helpers for `@tekir/drive`.
 *
 * The storage drivers deliberately accept any key/content so the framework
 * stays storage-agnostic. These helpers give applications a secure-by-intent
 * way to validate untrusted uploads BEFORE handing them to `drive.put()`:
 * an extension allowlist, a max-size limit, and filename sanitization.
 */

export interface UploadValidationOptions {
  /**
   * Allowed file extensions (with or without a leading dot, case-insensitive).
   * When omitted, any extension is allowed. Example: `['jpg', 'png', '.pdf']`.
   */
  allowedExtensions?: readonly string[]
  /** Maximum allowed size in bytes. When omitted, size is not checked. */
  maxSize?: number
}

/** Thrown by {@link assertValidUpload} when an upload fails validation. */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase()
}

/**
 * Extract the lowercased extension of a filename (without the dot).
 * Returns `''` when there is no extension.
 */
export function getExtension(filename: string): string {
  const base = sanitizeFilename(filename)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Sanitize a user-supplied filename into a safe single path segment.
 *
 * Strips directory components (`/`, `\`), removes NUL bytes and control
 * characters, collapses leading dots (so `..` and dotfiles cannot result),
 * and replaces characters outside `[A-Za-z0-9._-]` with `_`. Always returns
 * a non-empty string (`'file'` for inputs that sanitize to nothing).
 *
 * @param filename - The raw, untrusted filename.
 * @returns A safe filename usable as a single storage-key segment.
 */
export function sanitizeFilename(filename: string): string {
  // Take only the final path component; drop any directory prefix an
  // attacker tried to smuggle in via `/` or `\`.
  let name = String(filename).split(/[\\/]/).pop() ?? ''
  // Drop NUL and other control characters.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f]/g, '')
  // Replace anything outside a conservative safe set.
  name = name.replace(/[^A-Za-z0-9._-]/g, '_')
  // Collapse leading dots so the result can never be `.`, `..`, or a dotfile.
  name = name.replace(/^\.+/, '')
  if (name === '' || name === '.' || name === '..') return 'file'
  return name
}

/**
 * Check whether an upload satisfies the given extension allowlist and size
 * limit without throwing. Use {@link assertValidUpload} when you want an
 * exception instead.
 *
 * @param filename - The filename (used for the extension check).
 * @param size - The content size in bytes.
 * @param options - {@link UploadValidationOptions}.
 * @returns `{ ok: true }` on success, or `{ ok: false, reason }` on failure.
 */
export function validateUpload(
  filename: string,
  size: number,
  options: UploadValidationOptions = {},
): { ok: true } | { ok: false; reason: string } {
  if (options.maxSize !== undefined && size > options.maxSize) {
    return { ok: false, reason: `File exceeds maximum size of ${options.maxSize} bytes` }
  }
  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    const ext = getExtension(filename)
    const allow = new Set(options.allowedExtensions.map(normalizeExt))
    if (!ext || !allow.has(ext)) {
      return { ok: false, reason: `File extension "${ext || '(none)'}" is not allowed` }
    }
  }
  return { ok: true }
}

/**
 * Assert that an upload satisfies the extension allowlist and size limit,
 * throwing {@link UploadValidationError} on failure.
 *
 * @param filename - The filename (used for the extension check).
 * @param size - The content size in bytes.
 * @param options - {@link UploadValidationOptions}.
 * @throws {UploadValidationError} If validation fails.
 */
export function assertValidUpload(
  filename: string,
  size: number,
  options: UploadValidationOptions = {},
): void {
  const result = validateUpload(filename, size, options)
  if (!result.ok) throw new UploadValidationError(result.reason)
}

/** Byte length of upload content of the common types accepted by `put()`. */
export function contentByteLength(content: Buffer | string | Uint8Array): number {
  if (typeof content === 'string') return Buffer.byteLength(content)
  return content.byteLength
}
