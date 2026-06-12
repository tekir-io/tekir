/**
 * HMAC-signed state token for OAuth CSRF protection.
 * Format: base64(payload).hmac_signature
 */

const encoder = new TextEncoder()

/** UTF-8 safe base64 encode (handles non-Latin1 payloads, e.g. unicode paths). */
function b64encode(str: string): string {
  const bytes = encoder.encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** UTF-8 safe base64 decode. */
function b64decode(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/**
 * Constant-time string comparison. Iterates over the full input on every
 * call so an attacker cannot use response timing to learn how many leading
 * bytes of their guess matched. We bail early only on length mismatch,
 * which is already encoded into the signature format and not user-derived.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret)
  return constantTimeEqual(expected, signature)
}

/** Decoded payload from an OAuth state token. */
export interface StatePayload {
  redirect?: string
  isApp?: boolean
  timestamp: number
  nonce: string
  [key: string]: unknown
}

/**
 * Create an HMAC-signed state token for OAuth CSRF protection.
 *
 * @param payload - The state payload (e.g. redirect URL, isApp flag). Timestamp and nonce are added automatically.
 * @param secret - The HMAC secret key (typically `APP_KEY`).
 * @returns A signed token string in the format `base64(payload).hmac_signature`.
 *
 * @example
 * ```ts
 * const state = await createState({ redirect: '/dashboard' }, process.env.APP_KEY)
 * ```
 */
export async function createState(payload: Omit<StatePayload, 'timestamp' | 'nonce'>, secret: string): Promise<string> {
  const full: StatePayload = {
    ...payload,
    timestamp: Date.now(),
    nonce: crypto.randomUUID().slice(0, 8),
  }
  const data = b64encode(JSON.stringify(full))
  const sig = await hmacSign(data, secret)
  return `${data}.${sig}`
}

/**
 * Verify and decode a signed state token.
 *
 * @param token - The signed state token to verify.
 * @param secret - The HMAC secret key used to sign the token.
 * @param maxAgeMs - Maximum age in milliseconds before the token is considered expired (default: `600000` / 10 minutes).
 * @returns The decoded {@link StatePayload}, or `null` if the token is invalid or expired.
 *
 * @example
 * ```ts
 * const payload = await verifyState(stateParam, process.env.APP_KEY)
 * if (!payload) throw new Error('Invalid state')
 * ```
 */
export async function verifyState(token: string, secret: string, maxAgeMs = 600_000): Promise<StatePayload | null> {
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) return null

  const data = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)

  if (!await hmacVerify(data, sig, secret)) return null

  try {
    const payload: StatePayload = JSON.parse(b64decode(data))

    // Check expiry
    if (Date.now() - payload.timestamp > maxAgeMs) return null

    return payload
  } catch {
    return null
  }
}
