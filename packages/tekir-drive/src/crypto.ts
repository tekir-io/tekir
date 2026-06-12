
/**
 * Compute the SHA-256 hash of a string and return it as a lowercase hex string.
 *
 * @param data - The input string to hash.
 * @returns The hex-encoded SHA-256 digest.
 *
 * @example
 * ```ts
 * const hex = await sha256Hex('hello world')
 * // => 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
 * ```
 */
export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compute an HMAC-SHA256 signature using a string key.
 *
 * @param key - The HMAC key as a string.
 * @param data - The data to sign.
 * @returns The raw HMAC-SHA256 signature as an ArrayBuffer.
 *
 * @example
 * ```ts
 * const sig = await hmacSha256('my-secret', 'data-to-sign')
 * ```
 */
export async function hmacSha256(key: string, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

/**
 * Compute an HMAC-SHA256 signature using a raw ArrayBuffer key.
 *
 * @param key - The HMAC key as an ArrayBuffer (e.g. output of a previous HMAC).
 * @param data - The data to sign.
 * @returns The raw HMAC-SHA256 signature as an ArrayBuffer.
 *
 * @example
 * ```ts
 * const kDate = await hmacSha256('AWS4secret', '20240101')
 * const kRegion = await hmacSha256Raw(kDate, 'us-east-1')
 * ```
 */
export async function hmacSha256Raw(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

/**
 * Compute an HMAC-SHA256 signature and return it as a lowercase hex string.
 *
 * @param key - The HMAC key as an ArrayBuffer.
 * @param data - The data to sign.
 * @returns The hex-encoded HMAC-SHA256 signature.
 *
 * @example
 * ```ts
 * const hex = await hmacSha256Hex(signingKey, stringToSign)
 * ```
 */
export async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const buf = await hmacSha256Raw(key, data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
