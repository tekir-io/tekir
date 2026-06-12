/**
 * Apple Sign In `id_token` verification.
 *
 * Verifies the JWT signature against Apple's published JWKS (RS256) and checks
 * the issuer, audience, and expiry (plus an optional nonce). Decode-only trust
 * is an authentication bypass: anyone can mint a JWT with an arbitrary `sub`
 * and `email`, so the signature MUST be verified.
 */

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'

interface AppleJwk {
  kty: string
  kid: string
  use?: string
  alg?: string
  n: string
  e: string
}

interface JwksCache {
  keys: AppleJwk[]
  fetchedAt: number
}

let jwksCache: JwksCache | null = null
const JWKS_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Base64url -> Uint8Array. */
function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  const bin = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Base64url -> UTF-8 string (for JSON segments). */
function base64UrlToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url))
}

/** Fetch (and cache) Apple's JWKS. Injectable fetcher for testing. */
async function getAppleKeys(fetcher: typeof fetch = fetch): Promise<AppleJwk[]> {
  const now = Date.now()
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const res = await fetcher(APPLE_JWKS_URL)
  if (!res.ok) throw new Error(`Failed to fetch Apple JWKS: ${res.status}`)
  const data = await res.json() as { keys: AppleJwk[] }
  jwksCache = { keys: data.keys || [], fetchedAt: now }
  return jwksCache.keys
}

/** Clear the cached JWKS (primarily for tests). */
export function _clearAppleJwksCache(): void {
  jwksCache = null
}

/** Seed the JWKS cache directly (primarily for tests). */
export function _seedAppleJwksCache(keys: AppleJwk[]): void {
  jwksCache = { keys, fetchedAt: Date.now() }
}

export interface AppleIdTokenPayload {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean | string
  is_private_email?: boolean | string
  [key: string]: unknown
}

export interface VerifyOptions {
  /** Expected audience (your Apple client_id). */
  audience: string
  /** Expected nonce, if one was sent on the authorize request. */
  nonce?: string
  /** Clock-skew tolerance in seconds. Default 60. */
  clockToleranceSec?: number
  /** Injectable fetch (tests). */
  fetcher?: typeof fetch
}

/**
 * Verify an Apple `id_token` and return its decoded payload.
 *
 * @throws If the signature, issuer, audience, expiry, or nonce is invalid.
 */
export async function verifyAppleIdToken(token: string, options: VerifyOptions): Promise<AppleIdTokenPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid Apple id_token: malformed JWT')

  const [headerB64, payloadB64, sigB64] = parts

  let header: { alg: string; kid: string }
  let payload: AppleIdTokenPayload
  try {
    header = JSON.parse(base64UrlToString(headerB64))
    payload = JSON.parse(base64UrlToString(payloadB64))
  } catch {
    throw new Error('Invalid Apple id_token: undecodable segments')
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Invalid Apple id_token: unexpected alg "${header.alg}"`)
  }

  // Find the signing key by `kid`.
  const keys = await getAppleKeys(options.fetcher)
  const jwk = keys.find(k => k.kid === header.kid)
  if (!jwk) throw new Error('Invalid Apple id_token: signing key not found in JWKS')

  // Import the RSA public key and verify the RS256 signature.
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  // Build an ArrayBuffer-backed view so the value satisfies `BufferSource`
  // (Uint8Array<ArrayBufferLike> excludes SharedArrayBuffer-backed buffers).
  const encoded = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const signedData = new Uint8Array(encoded.length)
  signedData.set(encoded)
  const signature = base64UrlToBytes(sigB64)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData)
  if (!valid) throw new Error('Invalid Apple id_token: signature verification failed')

  // Claim checks.
  if (payload.iss !== APPLE_ISSUER) {
    throw new Error(`Invalid Apple id_token: issuer "${payload.iss}"`)
  }

  const audOk = Array.isArray(payload.aud)
    ? payload.aud.includes(options.audience)
    : payload.aud === options.audience
  if (!audOk) throw new Error('Invalid Apple id_token: audience mismatch')

  const tolerance = options.clockToleranceSec ?? 60
  const nowSec = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp + tolerance < nowSec) {
    throw new Error('Invalid Apple id_token: token expired')
  }

  if (options.nonce !== undefined && payload.nonce !== options.nonce) {
    throw new Error('Invalid Apple id_token: nonce mismatch')
  }

  return payload
}
