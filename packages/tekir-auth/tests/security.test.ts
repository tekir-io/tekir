import { test, expect, describe } from 'bun:test'
import { DatabaseTokenGuard } from '../src/guards/database_token_guard'
import { JwtGuard } from '../src/guards/jwt_guard'
import { SessionGuard } from '../src/guards/session_guard'

// DatabaseTokenGuard keys its stored-token HMAC from APP_KEY; provide one so
// the guard can be constructed across these tests.
const APP_KEY = 'test-app-key-32-bytes-minimum!!!'
process.env.APP_KEY = process.env.APP_KEY || APP_KEY

const baseConfig = {
  db: { exec: async () => {}, queryOne: async () => null, run: async () => {}, query: async () => [] },
  resolve: async () => null,
}

// ═══════════════════════════════════════════════════════════
// DatabaseTokenGuard — table name validation
// ═══════════════════════════════════════════════════════════

describe('DatabaseTokenGuard — table name validation', () => {
  test('accepts valid table names', () => {
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'auth_tokens' })).not.toThrow()
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tokens' })).not.toThrow()
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: '_tokens' })).not.toThrow()
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'Tokens2' })).not.toThrow()
  })

  test('accepts default table name', () => {
    expect(() => new DatabaseTokenGuard(baseConfig)).not.toThrow()
  })

  test('rejects SQL injection in table name', () => {
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tokens; DROP TABLE users' })).toThrow('Invalid table name')
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tokens" OR 1=1' })).toThrow('Invalid table name')
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: "tokens' --" })).toThrow('Invalid table name')
  })

  test('rejects special characters in table name', () => {
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tok-ens' })).toThrow('Invalid table name')
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tok ens' })).toThrow('Invalid table name')
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: 'tok.ens' })).toThrow('Invalid table name')
  })

  test('uses default when table not specified', () => {
    // Empty string won't be passed since config spreads default 'auth_tokens'
    expect(() => new DatabaseTokenGuard(baseConfig)).not.toThrow()
  })

  test('rejects table name starting with number', () => {
    expect(() => new DatabaseTokenGuard({ ...baseConfig, table: '1tokens' })).toThrow('Invalid table name')
  })
})

// ═══════════════════════════════════════════════════════════
// DatabaseTokenGuard — token generation entropy
// ═══════════════════════════════════════════════════════════

describe('DatabaseTokenGuard — token generation', () => {
  const guard = new DatabaseTokenGuard({
    db: { exec: async () => {}, queryOne: async () => ({ id: 1 }), run: async () => {}, query: async () => [] },
    resolve: async () => ({ id: '1' }),
  })

  test('generates hex-encoded tokens (full entropy)', () => {
    const token = (guard as any)._randomToken(40)
    expect(token.length).toBe(80) // 40 bytes * 2 hex chars
    expect(/^[0-9a-f]+$/.test(token)).toBe(true)
  })

  test('generates unique tokens every time', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) tokens.add((guard as any)._randomToken())
    expect(tokens.size).toBe(100)
  })

  test('token length scales with input', () => {
    expect((guard as any)._randomToken(16).length).toBe(32)
    expect((guard as any)._randomToken(32).length).toBe(64)
    expect((guard as any)._randomToken(64).length).toBe(128)
  })

  test('tokens contain only hex characters', () => {
    for (let i = 0; i < 50; i++) {
      const token = (guard as any)._randomToken()
      expect(/^[0-9a-f]+$/.test(token)).toBe(true)
    }
  })

  test('hash produces consistent HMAC output for same key', async () => {
    const h1 = await (guard as any)._hash('test')
    const h2 = await (guard as any)._hash('test')
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64) // HMAC-SHA256 = 32 bytes = 64 hex chars
  })

  test('hash produces different output for different input', async () => {
    const h1 = await (guard as any)._hash('value1')
    const h2 = await (guard as any)._hash('value2')
    expect(h1).not.toBe(h2)
  })
})

// ═══════════════════════════════════════════════════════════
// DatabaseTokenGuard — keyed-HMAC storage (APP_KEY pepper)
// ═══════════════════════════════════════════════════════════

describe('DatabaseTokenGuard — keyed-HMAC token storage', () => {
  function makeStore() {
    const rows: any[] = []
    let nextId = 1
    return {
      db: {
        exec: async () => {},
        run: async (sql: string, args: any[] = []) => {
          if (sql.trim().toUpperCase().startsWith('INSERT')) {
            rows.push({ id: nextId++, user_id: args[0], name: args[1], hash: args[2], metadata: args[3], created_at: args[4], expires_at: args[5] ?? null, last_used_at: null })
          }
          return {}
        },
        queryOne: async (sql: string, args: any[] = []) => {
          if (sql.includes('last_insert_rowid')) return { id: nextId - 1 }
          return rows.find(r => r.hash === args[0]) ?? null
        },
        query: async () => [],
      },
      rows,
    }
  }

  test('APP_KEY missing throws a clear error', () => {
    const saved = process.env.APP_KEY
    delete process.env.APP_KEY
    try {
      expect(() => new DatabaseTokenGuard({ ...baseConfig, appKey: undefined })).toThrow('requires APP_KEY')
    } finally {
      process.env.APP_KEY = saved
    }
  })

  test('weak (too short) APP_KEY is rejected', () => {
    expect(() => new DatabaseTokenGuard({ ...baseConfig, appKey: 'short' })).toThrow('too short')
  })

  test('persisted value is the HMAC, not the plaintext token', async () => {
    const store = makeStore()
    const guard = new DatabaseTokenGuard({ db: store.db, appKey: APP_KEY, resolve: async (id) => ({ id }) })
    const { token } = await guard.generate({ id: '1' } as any)

    expect(store.rows.length).toBe(1)
    const stored = store.rows[0].hash
    // The plaintext token (and its un-prefixed value) must never appear in storage.
    const value = token.replace(/^oat_/, '')
    expect(stored).not.toBe(token)
    expect(stored).not.toBe(value)
    expect(stored).not.toContain(value)
    expect(stored.length).toBe(64) // hex HMAC-SHA256
    // Stored value equals HMAC(value, APP_KEY).
    expect(stored).toBe(await (guard as any)._hash(value))
  })

  test('a freshly created token is accepted', async () => {
    const store = makeStore()
    const guard = new DatabaseTokenGuard({ db: store.db, appKey: APP_KEY, resolve: async (id) => ({ id }) })
    const { token } = await guard.generate({ id: '7' } as any)
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe('7')
  })

  test('token forged from a leaked HMAC without APP_KEY is rejected', async () => {
    const store = makeStore()
    const guard = new DatabaseTokenGuard({ db: store.db, appKey: APP_KEY, resolve: async (id) => ({ id }) })
    await guard.generate({ id: '1' } as any)

    // Attacker has the DB dump: they know the stored HMAC but not APP_KEY.
    // Presenting the stored HMAC as a token must not authenticate.
    const leakedHmac = store.rows[0].hash
    const ctx = { request: { header: () => `Bearer oat_${leakedHmac}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })

  test('different APP_KEY produces a different HMAC for the same token', async () => {
    const g1 = new DatabaseTokenGuard({ ...baseConfig, appKey: 'app-key-one-32-bytes-minimum!!!!' })
    const g2 = new DatabaseTokenGuard({ ...baseConfig, appKey: 'app-key-two-32-bytes-minimum!!!!' })
    const h1 = await (g1 as any)._hash('same-token-value')
    const h2 = await (g2 as any)._hash('same-token-value')
    expect(h1).not.toBe(h2)
  })

  test('constant-time compare: equal strings true, unequal/length-mismatch false', () => {
    const guard = new DatabaseTokenGuard({ ...baseConfig, appKey: APP_KEY })
    const eq = (guard as any)._constantTimeEqual.bind(guard)
    expect(eq('a'.repeat(64), 'a'.repeat(64))).toBe(true)
    expect(eq('a'.repeat(64), 'b'.repeat(64))).toBe(false)
    expect(eq('abc', 'abcd')).toBe(false) // length mismatch never throws
  })
})

// ═══════════════════════════════════════════════════════════
// DatabaseTokenGuard — authentication
// ═══════════════════════════════════════════════════════════

describe('DatabaseTokenGuard — authentication', () => {
  test('rejects missing token', async () => {
    const guard = new DatabaseTokenGuard(baseConfig)
    const ctx = { request: { header: () => '' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing token')
  })

  test('rejects invalid token', async () => {
    const guard = new DatabaseTokenGuard(baseConfig)
    const ctx = { request: { header: () => 'Bearer oat_invalidtoken' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })

  test('check returns false for invalid token', async () => {
    const guard = new DatabaseTokenGuard(baseConfig)
    const ctx = { request: { header: () => '' }, headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('strips Bearer prefix', async () => {
    const guard = new DatabaseTokenGuard(baseConfig)
    const ctx = { request: { header: () => 'Bearer oat_test' }, headers: {} }
    // Will fail at DB lookup, but should not fail at token extraction
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })

  test('strips custom prefix', async () => {
    const guard = new DatabaseTokenGuard({ ...baseConfig, prefix: 'myapp_' })
    const ctx = { request: { header: () => 'Bearer myapp_test' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })
})

// ═══════════════════════════════════════════════════════════
// JwtGuard — max expiration
// ═══════════════════════════════════════════════════════════

describe('JwtGuard — expiration cap', () => {
  test('caps at default 7 days', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: 3600, resolve: async () => ({ id: '1' }) })
    const result = await guard.generate({ id: '1' } as any, { expiresIn: 30 * 86400 })
    const diff = Math.floor(result.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000)
    expect(diff).toBeLessThanOrEqual(604805)
    expect(diff).toBeGreaterThan(604790)
  })

  test('does not alter within cap', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: 3600, resolve: async () => ({ id: '1' }) })
    const result = await guard.generate({ id: '1' } as any, { expiresIn: 1800 })
    const diff = Math.floor(result.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000)
    expect(diff).toBeLessThanOrEqual(1805)
    expect(diff).toBeGreaterThan(1795)
  })

  test('custom maxExpiresIn 1 day', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: 3600, maxExpiresIn: 86400, resolve: async () => ({ id: '1' }) })
    const result = await guard.generate({ id: '1' } as any, { expiresIn: 7 * 86400 })
    const diff = Math.floor(result.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000)
    expect(diff).toBeLessThanOrEqual(86405)
    expect(diff).toBeGreaterThan(86390)
  })

  test('custom maxExpiresIn 30 days allows longer', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: 3600, maxExpiresIn: 30 * 86400, resolve: async () => ({ id: '1' }) })
    const result = await guard.generate({ id: '1' } as any, { expiresIn: 15 * 86400 })
    const diff = Math.floor(result.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000)
    expect(diff).toBeGreaterThan(15 * 86400 - 10)
  })

  test('uses default expiresIn when not specified', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: 7200, resolve: async () => ({ id: '1' }) })
    const result = await guard.generate({ id: '1' } as any)
    const diff = Math.floor(result.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000)
    expect(diff).toBeLessThanOrEqual(7205)
    expect(diff).toBeGreaterThan(7195)
  })
})

// ═══════════════════════════════════════════════════════════
// JwtGuard — sign + verify roundtrip
// ═══════════════════════════════════════════════════════════

describe('JwtGuard — sign/verify', () => {
  test('generated token is valid', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async (id) => ({ id }) })
    const { token } = await guard.generate({ id: '42' } as any)
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe('42')
  })

  test('tampered token is rejected', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async () => ({ id: '1' }) })
    const { token } = await guard.generate({ id: '1' } as any)
    const tampered = token.slice(0, -5) + 'xxxxx'
    const ctx = { request: { header: () => `Bearer ${tampered}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('wrong secret rejects token', async () => {
    const guard1 = new JwtGuard({ secret: 'secret-one-32chars-minimum!!!!!', resolve: async () => ({ id: '1' }) })
    const guard2 = new JwtGuard({ secret: 'secret-two-32chars-minimum!!!!!', resolve: async () => ({ id: '1' }) })
    const { token } = await guard1.generate({ id: '1' } as any)
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard2.authenticate(ctx)).rejects.toThrow()
  })

  test('expired token is rejected', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', expiresIn: -1, resolve: async () => ({ id: '1' }) })
    const { token } = await guard.generate({ id: '1' } as any, { expiresIn: -1 })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Token expired')
  })

  test('invalid format rejected', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async () => ({ id: '1' }) })
    const ctx = { request: { header: () => 'Bearer not.a.valid.jwt.token' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('missing header rejected', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async () => ({ id: '1' }) })
    const ctx = { request: { header: () => '' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing authorization header')
  })

  test('custom claims are included', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async () => ({ id: '1' }) })
    const { token } = await guard.generate({ id: '1' } as any, { claims: { role: 'admin' } })
    expect(token.split('.').length).toBe(3)
  })

  test('check returns true for valid token', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async (id) => ({ id }) })
    const { token } = await guard.generate({ id: '1' } as any)
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check returns false for invalid token', async () => {
    const guard = new JwtGuard({ secret: 'test-secret-key-32chars-minimum!', resolve: async () => ({ id: '1' }) })
    const ctx = { request: { header: () => 'Bearer invalid' }, headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// JwtGuard — algorithm confusion / header validation
// ═══════════════════════════════════════════════════════════

const SECRET = 'test-secret-key-32chars-minimum!'

function b64url(obj: any): string {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj)
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacSign(data: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Builds a token with an arbitrary header and a valid HMAC signature over it,
// so only header validation (not the signature) can reject it.
async function signedToken(header: any, payload: any): Promise<string> {
  const data = `${b64url(header)}.${b64url(payload)}`
  return `${data}.${await hmacSign(data)}`
}

describe('JwtGuard — algorithm confusion', () => {
  const future = Math.floor(Date.now() / 1000) + 3600

  test('rejects alg:none even with empty signature', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: '1', exp: future })}.`
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Unexpected token algorithm')
  })

  test('rejects mismatched alg even when signature is valid HMAC', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    // Attacker keeps a valid HMAC but claims RS256 (classic confusion setup)
    const token = await signedToken({ alg: 'RS256', typ: 'JWT' }, { sub: '1', exp: future })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Unexpected token algorithm')
  })

  test('rejects unexpected typ header', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'evil' }, { sub: '1', exp: future })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Unexpected token type')
  })

  test('accepts well-formed HS256 token', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'JWT' }, { sub: '7', iat: 1, exp: future })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe('7')
  })
})

describe('JwtGuard — claim validation', () => {
  const future = Math.floor(Date.now() / 1000) + 3600

  test('rejects token without exp claim (not immortal)', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'JWT' }, { sub: '1' })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('no valid expiry')
  })

  test('rejects token with malformed exp', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'JWT' }, { sub: '1', exp: 'soon' })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('no valid expiry')
  })

  test('rejects token missing sub', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'JWT' }, { exp: future })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('missing subject')
  })

  test('rejects not-yet-valid token (nbf in future)', async () => {
    const guard = new JwtGuard({ secret: SECRET, resolve: async (id) => ({ id }) })
    const token = await signedToken({ alg: 'HS256', typ: 'JWT' }, { sub: '1', exp: future, nbf: future })
    const ctx = { request: { header: () => `Bearer ${token}` }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('not yet valid')
  })
})

// ═══════════════════════════════════════════════════════════
// DatabaseTokenGuard — expiry parsing
// ═══════════════════════════════════════════════════════════

describe('DatabaseTokenGuard — malformed expiry', () => {
  test('rejects token whose expires_at is unparseable (no immortal token)', async () => {
    const guard = new DatabaseTokenGuard({
      db: {
        exec: async () => {},
        queryOne: async (_sql: string, args: any[] = []) => ({ id: 1, user_id: '1', hash: args[0], expires_at: 'not-a-date', metadata: '{}' }),
        run: async () => {},
        query: async () => [],
      },
      resolve: async (id) => ({ id }),
    })
    const ctx = { request: { header: () => 'Bearer oat_whatever' }, headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })

  test('accepts token whose expires_at is in the future', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const guard = new DatabaseTokenGuard({
      db: {
        exec: async () => {},
        queryOne: async (_sql: string, args: any[] = []) => ({ id: 1, user_id: '1', hash: args[0], expires_at: future, metadata: '{}' }),
        run: async () => {},
        query: async () => [],
      },
      resolve: async (id) => ({ id }),
    })
    const ctx = { request: { header: () => 'Bearer oat_whatever' }, headers: {} }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe('1')
  })
})

// ═══════════════════════════════════════════════════════════
// SessionGuard — session fixation
// ═══════════════════════════════════════════════════════════

describe('SessionGuard — session fixation prevention', () => {
  test('calls regenerate on login', async () => {
    let regenerated = false
    const guard = new SessionGuard({ resolve: async () => ({ id: '1' }) })
    const ctx = { session: { get: () => null, put: () => {}, forget: () => {}, regenerate: async () => { regenerated = true } } }
    await guard.login({ id: '1' } as any, ctx)
    expect(regenerated).toBe(true)
  })

  test('falls back to destroy when no regenerate', async () => {
    let destroyed = false
    const guard = new SessionGuard({ resolve: async () => ({ id: '1' }) })
    const ctx = { session: { get: () => null, put: () => {}, forget: () => {}, destroy: async () => { destroyed = true } } }
    await guard.login({ id: '1' } as any, ctx)
    expect(destroyed).toBe(true)
  })

  test('logout regenerates session', async () => {
    let regenerated = false
    const guard = new SessionGuard({ resolve: async () => ({ id: '1' }) })
    const ctx = { session: { get: () => '1', put: () => {}, forget: () => {}, regenerate: async () => { regenerated = true } } }
    await guard.logout(ctx)
    expect(regenerated).toBe(true)
  })

  test('authenticate throws when no session', async () => {
    const guard = new SessionGuard({ resolve: async () => ({ id: '1' }) })
    await expect(guard.authenticate({ session: null })).rejects.toThrow('Session not available')
  })

  test('authenticate throws when not logged in', async () => {
    const guard = new SessionGuard({ resolve: async () => ({ id: '1' }) })
    await expect(guard.authenticate({ session: { get: () => null } })).rejects.toThrow('Not authenticated')
  })

  test('authenticate throws when user not found', async () => {
    const guard = new SessionGuard({ resolve: async () => null })
    await expect(guard.authenticate({ session: { get: () => '999', forget: () => {} } })).rejects.toThrow('User not found')
  })

  test('authenticate returns user when valid', async () => {
    const guard = new SessionGuard({ resolve: async (id) => ({ id, name: 'Ali' }) })
    const user = await guard.authenticate({ session: { get: () => '1' } })
    expect(user.id).toBe('1')
  })

  test('check returns true when authenticated', async () => {
    const guard = new SessionGuard({ resolve: async (id) => ({ id }) })
    expect(await guard.check({ session: { get: () => '1' } })).toBe(true)
  })

  test('check returns false when not authenticated', async () => {
    const guard = new SessionGuard({ resolve: async () => null })
    expect(await guard.check({ session: { get: () => null } })).toBe(false)
  })
})
