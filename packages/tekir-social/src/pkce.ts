/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers.
 *
 * The verifier is a high-entropy random string kept server-side (bound to the
 * OAuth state). The challenge is `BASE64URL(SHA256(verifier))` and is sent on
 * the authorization request. At token exchange the verifier is presented; the
 * provider rehashes it and compares, defeating authorization-code interception.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a cryptographically random PKCE code verifier (43-128 chars). */
export function createCodeVerifier(byteLength = 32): string {
  const buf = new Uint8Array(byteLength)
  crypto.getRandomValues(buf)
  return base64UrlEncode(buf)
}

/** Derive the S256 code challenge for a given verifier. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/** Create a verifier + matching S256 challenge pair. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string; method: 'S256' }> {
  const verifier = createCodeVerifier()
  const challenge = await createCodeChallenge(verifier)
  return { verifier, challenge, method: 'S256' }
}
