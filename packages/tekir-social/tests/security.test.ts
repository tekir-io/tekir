import { test, expect, describe, beforeEach } from 'bun:test'
import { Social, AppleProvider, GitHubProvider, hideSensitiveFields } from '../src/index'
import { verifyAppleIdToken, _seedAppleJwksCache, _clearAppleJwksCache } from '../src/apple_jwt'
import type { SocialConfig, SocialUser } from '../src/types'

process.env.APP_KEY = 'test-app-key-for-social-auth-signing'

// ── Helpers to mint a real RS256 JWT signed by a generated key ──────────────

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function strToB64Url(str: string): string {
  return bytesToB64Url(new TextEncoder().encode(str))
}

async function makeKeyAndJwks(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const appleJwk = { kty: jwk.kty!, kid, use: 'sig', alg: 'RS256', n: jwk.n!, e: jwk.e! }
  return { privateKey: pair.privateKey, jwk: appleJwk }
}

async function signJwt(payload: Record<string, unknown>, privateKey: CryptoKey, kid: string): Promise<string> {
  const header = strToB64Url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))
  const body = strToB64Url(JSON.stringify(payload))
  const data = new TextEncoder().encode(`${header}.${body}`)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data)
  return `${header}.${body}.${bytesToB64Url(new Uint8Array(sig))}`
}

const AUD = 'com.example.app'

describe('Apple id_token verification', () => {
  beforeEach(() => _clearAppleJwksCache())

  test('accepts a properly signed token with valid claims', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com',
      sub: 'apple-user-123',
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'user@privaterelay.appleid.com',
      email_verified: true,
    }, privateKey, 'k1')

    const payload = await verifyAppleIdToken(token, { audience: AUD })
    expect(payload.sub).toBe('apple-user-123')
  })

  test('rejects a token with a forged signature (the core bypass)', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com', sub: 'victim', aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
    }, privateKey, 'k1')
    // Tamper with the payload (escalate sub) but keep the original signature.
    const [h, , s] = token.split('.')
    const forgedBody = strToB64Url(JSON.stringify({
      iss: 'https://appleid.apple.com', sub: 'attacker-as-victim', aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
    }))
    await expect(verifyAppleIdToken(`${h}.${forgedBody}.${s}`, { audience: AUD })).rejects.toThrow(/signature/)
  })

  test('rejects an unsigned/none-alg token', async () => {
    const { jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const header = strToB64Url(JSON.stringify({ alg: 'none', kid: 'k1' }))
    const body = strToB64Url(JSON.stringify({ iss: 'https://appleid.apple.com', sub: 'x', aud: AUD, exp: 9999999999 }))
    await expect(verifyAppleIdToken(`${header}.${body}.`, { audience: AUD })).rejects.toThrow()
  })

  test('rejects wrong audience', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com', sub: 'x', aud: 'other.app',
      exp: Math.floor(Date.now() / 1000) + 600,
    }, privateKey, 'k1')
    await expect(verifyAppleIdToken(token, { audience: AUD })).rejects.toThrow(/audience/)
  })

  test('rejects expired token', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com', sub: 'x', aud: AUD,
      exp: Math.floor(Date.now() / 1000) - 600,
    }, privateKey, 'k1')
    await expect(verifyAppleIdToken(token, { audience: AUD })).rejects.toThrow(/expired/)
  })

  test('rejects nonce mismatch', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com', sub: 'x', aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600, nonce: 'real-nonce',
    }, privateKey, 'k1')
    await expect(verifyAppleIdToken(token, { audience: AUD, nonce: 'attacker-nonce' })).rejects.toThrow(/nonce/)
  })

  test('AppleProvider.getUser verifies the id_token from context', async () => {
    const { privateKey, jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    const token = await signJwt({
      iss: 'https://appleid.apple.com', sub: 'apple-1', aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600, email: 'a@b.com', email_verified: 'true',
    }, privateKey, 'k1')
    const provider = new AppleProvider({ clientId: AUD, clientSecret: 's', redirectUri: 'https://app/cb' })
    const user = await provider.getUser('access-tok', { idToken: token })
    expect(user.id).toBe('apple-1')
    expect(user.email).toBe('a@b.com')
  })

  test('AppleProvider.getUser rejects a decode-only forged token', async () => {
    const { jwk } = await makeKeyAndJwks('k1')
    _seedAppleJwksCache([jwk])
    // Hand-rolled unsigned token like the old bypass.
    const header = strToB64Url(JSON.stringify({ alg: 'RS256', kid: 'k1' }))
    const body = strToB64Url(JSON.stringify({ iss: 'https://appleid.apple.com', sub: 'forged', aud: AUD, exp: 9999999999 }))
    const provider = new AppleProvider({ clientId: AUD, clientSecret: 's', redirectUri: 'https://app/cb' })
    await expect(provider.getUser('x', { idToken: `${header}.${body}.AAAA` })).rejects.toThrow()
  })
})

describe('GitHub unverified email rejection', () => {
  test('only a primary+verified email is accepted; unverified falls back to null', async () => {
    const provider = new GitHubProvider({ clientId: 'id', clientSecret: 's', redirectUri: 'https://app/cb' })
    const origFetch = globalThis.fetch
    // @ts-expect-error override for test
    globalThis.fetch = async (url: string) => {
      if (String(url).endsWith('/user')) {
        return new Response(JSON.stringify({ id: 7, login: 'ghuser', name: 'GH User', email: null }), { status: 200 })
      }
      // emails endpoint: primary but NOT verified
      return new Response(JSON.stringify([
        { email: 'unverified@evil.com', primary: true, verified: false },
        { email: 'other@x.com', primary: false, verified: false },
      ]), { status: 200 })
    }
    try {
      const user = await provider.getUser('tok')
      expect(user.email).toBeNull()
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test('a primary+verified email is accepted', async () => {
    const provider = new GitHubProvider({ clientId: 'id', clientSecret: 's', redirectUri: 'https://app/cb' })
    const origFetch = globalThis.fetch
    // @ts-expect-error override for test
    globalThis.fetch = async (url: string) => {
      if (String(url).endsWith('/user')) {
        return new Response(JSON.stringify({ id: 7, login: 'ghuser', name: 'GH User', email: null }), { status: 200 })
      }
      return new Response(JSON.stringify([
        { email: 'verified@good.com', primary: true, verified: true },
      ]), { status: 200 })
    }
    try {
      const user = await provider.getUser('tok')
      expect(user.email).toBe('verified@good.com')
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('SocialUser token hiding', () => {
  test('tokens and raw are non-enumerable (not serialized)', () => {
    const user: SocialUser = {
      id: '1', email: 'a@b.com', name: 'X', firstName: 'X', lastName: null, avatar: null,
      provider: 'google', accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH', raw: { token: 'leak' },
    }
    hideSensitiveFields(user)
    const json = JSON.stringify(user)
    expect(json).not.toContain('SECRET-ACCESS')
    expect(json).not.toContain('SECRET-REFRESH')
    expect(json).not.toContain('leak')
    // Still readable via property access.
    expect(user.accessToken).toBe('SECRET-ACCESS')
    expect(user.id).toBe('1')
    // Enumerable profile fields survive.
    expect(JSON.parse(json).email).toBe('a@b.com')
  })
})

describe('OAuth state session binding (handleCallback)', () => {
  const config: SocialConfig = {
    providers: { google: { clientId: 'g', clientSecret: 's', redirectUri: 'https://app/cb' } },
    allowedRedirects: ['app.example.com'],
  }

  test('redirect() returns a PKCE verifier and a binding nonce', async () => {
    const social = new Social(config)
    const r = await social.redirect('google', { redirect: '/dash' })
    expect(r.codeVerifier.length).toBeGreaterThan(20)
    expect(r.nonce.length).toBeGreaterThan(0)
    expect(r.url).toContain('code_challenge=')
    expect(r.url).toContain('code_challenge_method=S256')
  })

  test('handleCallback rejects when storedState is missing (no session binding)', async () => {
    const social = new Social(config)
    const { state } = await social.redirect('google')
    await expect(social.handleCallback('google', 'code', state, undefined)).rejects.toThrow(/CSRF|session/)
  })

  test('handleCallback rejects a state not bound to the session nonce', async () => {
    const social = new Social(config)
    const { state } = await social.redirect('google')
    // Attacker presents a valid signed state but a stored nonce that does not match.
    await expect(social.handleCallback('google', 'code', state, 'unrelated-nonce')).rejects.toThrow(/not bound|CSRF/)
  })
})

describe('redirect URL validation hardening', () => {
  const social = new Social({
    providers: { google: { clientId: 'g', clientSecret: 's', redirectUri: 'https://app/cb' } },
    allowedRedirects: ['*.example.com'],
  })

  function validate(url: string) {
    // @ts-expect-error access private for focused testing
    return () => social.validateRedirect(url)
  }

  test('relative paths pass', () => {
    expect(validate('/dashboard')).not.toThrow()
  })

  test('protocol-relative off-site URL is rejected', () => {
    expect(validate('//evil.com/path')).toThrow()
  })

  test('javascript: scheme is rejected', () => {
    expect(validate('javascript:alert(1)')).toThrow()
  })

  test('http scheme downgrade against an https wildcard is rejected', () => {
    expect(validate('http://app.example.com/cb')).toThrow()
  })

  test('https subdomain within the wildcard passes', () => {
    expect(validate('https://app.example.com/cb')).not.toThrow()
  })

  test('lookalike domain (evilexample.com) is rejected against *.example.com', () => {
    expect(validate('https://evilexample.com')).toThrow()
  })
})
