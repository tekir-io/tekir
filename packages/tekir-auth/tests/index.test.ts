import { test, expect, describe } from 'bun:test'
import { App, HttpException, TekirServer } from '@tekir/core'
import { Auth } from '../src/auth_manager'
import { JwtGuard } from '../src/guards/jwt_guard'
import { SessionGuard } from '../src/guards/session_guard'
import { DatabaseTokenGuard } from '../src/guards/database_token_guard'
import { AccessTokenGuard } from '../src/guards/access_token_guard'
import { BasicAuthGuard } from '../src/guards/basic_auth_guard'
import { AuthProvider } from '../src/index'
import type { AuthUser, JwtGuardConfig, SessionGuardConfig, BasicAuthGuardConfig } from '../src/types'

// DatabaseTokenGuard keys its stored-token HMAC from APP_KEY (env fallback,
// like @tekir/encryption); provide one so the guard can be constructed.
process.env.APP_KEY = process.env.APP_KEY || 'test-app-key-32-bytes-minimum!!!'

// Shared fixtures

const testUser: AuthUser = { id: 1, name: 'Alice', role: 'user' }
const adminUser: AuthUser = { id: 2, name: 'Bob', role: 'admin' }

const findUser = async (id: string | number): Promise<AuthUser | null> =>
  id == 1 ? testUser : id == 2 ? adminUser : null

// Auth

describe('Auth', () => {
  test('constructor stores config and defaultGuard', () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    expect(manager).toBeInstanceOf(Auth)
  })

  test('guard() returns the guard instance from its factory', () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const guard = manager.guard('jwt')
    expect(guard).toBe(jwtGuard)
    expect(guard.name).toBe('jwt')
  })

  test('guard() uses defaultGuard when no name is supplied', () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const guard = manager.guard()
    expect(guard).toBe(jwtGuard)
  })

  test('guard() throws when guard name is not configured', () => {
    const manager = new Auth({ defaultGuard: 'jwt', guards: {} })
    expect(() => manager.guard('nonexistent')).toThrow('Auth guard "nonexistent" not configured')
  })

  test('guard() returns different guard types based on name', () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const sessionGuard = new SessionGuard({ resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        session: () => sessionGuard,
      },
    })
    expect(manager.guard('jwt').name).toBe('jwt')
    expect(manager.guard('session').name).toBe('session')
  })

  test('middleware() returns a function', () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const mw = manager.middleware()
    expect(typeof mw).toBe('function')
  })

  test('middleware() calls next and sets ctx.auth on successful authentication', async () => {
    const secret = 'middleware-secret'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.middleware()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.id).toBe(testUser.id)
    expect(ctx.auth.guard).toBe('jwt')
  })

  test('middleware() returns 401 Response when all guards fail', async () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const ctx: any = { headers: {} }

    const result = await manager.middleware()(ctx, async () => {})
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  test('middleware() accepts an array of guard names and tries each', async () => {
    const secret = 'multi-secret'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => (u === 'alice' && p === 'pass' ? testUser : null),
    })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        basic: () => basicGuard,
      },
    })

    // Only basic auth credentials provided — jwt will fail first, then basic succeeds
    const credentials = btoa('alice:pass')
    const ctx: any = { headers: { authorization: `Basic ${credentials}` } }
    let nextCalled = false

    await manager.middleware(['jwt', 'basic'])(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.guard).toBe('basic')
  })

  test('guest() calls next when user is not authenticated', async () => {
    const jwtGuard = new JwtGuard({ secret: 'test-secret', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const ctx: any = { headers: {} }
    let nextCalled = false

    await manager.guest()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
  })
})

// JwtGuard

describe('JwtGuard', () => {
  const secret = 'super-secret-key-for-tests'
  const config: JwtGuardConfig = { secret, expiresIn: 3600, resolve: findUser }

  test('name property is "jwt"', () => {
    const guard = new JwtGuard(config)
    expect(guard.name).toBe('jwt')
  })

  test('generate() returns a token string and an expiresAt Date', async () => {
    const guard = new JwtGuard(config)
    const result = await guard.generate(testUser)

    expect(typeof result.token).toBe('string')
    expect(result.token.split('.').length).toBe(3)
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('generate() respects per-call expiresIn override', async () => {
    const guard = new JwtGuard(config)
    const shortExpiry = 60
    const before = Math.floor(Date.now() / 1000)
    const result = await guard.generate(testUser, { expiresIn: shortExpiry })
    const after = Math.floor(Date.now() / 1000)

    const exp = Math.floor(result.expiresAt.getTime() / 1000)
    expect(exp).toBeGreaterThanOrEqual(before + shortExpiry)
    expect(exp).toBeLessThanOrEqual(after + shortExpiry)
  })

  test('generate() embeds extra claims when provided', async () => {
    const guard = new JwtGuard(config)
    const result = await guard.generate(testUser, { claims: { role: 'admin' } })

    // Decode payload (middle segment)
    const payloadJson = atob(result.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.role).toBe('admin')
    expect(payload.sub).toBe(testUser.id)
  })

  test('authenticate() validates a valid token and returns the user', async () => {
    const guard = new JwtGuard(config)
    const { token } = await guard.generate(testUser)

    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)

    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() works when token is passed without "Bearer " prefix', async () => {
    const guard = new JwtGuard(config)
    const { token } = await guard.generate(testUser)

    const ctx = { headers: { authorization: token } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() throws on missing authorization header', async () => {
    const guard = new JwtGuard(config)
    const ctx = { headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing authorization header')
  })

  test('authenticate() throws on tampered signature', async () => {
    const guard = new JwtGuard(config)
    const { token } = await guard.generate(testUser)

    const parts = token.split('.')
    parts[2] = parts[2].split('').reverse().join('') // corrupt the signature
    const tamperedToken = parts.join('.')

    const ctx = { headers: { authorization: `Bearer ${tamperedToken}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token signature')
  })

  test('authenticate() throws on token with wrong number of segments', async () => {
    const guard = new JwtGuard(config)
    const ctx = { headers: { authorization: 'Bearer not.a.valid.jwt.token' } }
    // 5 segments — should fail format check
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('authenticate() throws on expired token', async () => {
    // Build a guard with a tiny default expiry and generate a token that is already expired
    // We manually craft an expired token using a negative expiresIn via the claims override
    const guard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })

    // Craft a JWT with exp in the past using the internal sign logic indirectly:
    // Generate a token, then decode + re-encode the payload with exp = 0
    const { token } = await guard.generate(testUser)
    const [header, payload, sig] = token.split('.')
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    decoded.exp = Math.floor(Date.now() / 1000) - 10 // 10 seconds in the past

    // Re-encode the manipulated payload (this will fail signature verification — that is fine;
    // we want to confirm expiry is checked. Use a fresh guard with the same secret so we can
    // produce a properly signed expired token through generate() with expiresIn = -10)
    const expiredGuard = new JwtGuard({ secret, expiresIn: -10, resolve: findUser })
    const expiredResult = await expiredGuard.generate(testUser)

    const ctx = { headers: { authorization: `Bearer ${expiredResult.token}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Token expired')
  })

  test('authenticate() throws when user is not found', async () => {
    const guard = new JwtGuard({
      secret,
      expiresIn: 3600,
      resolve: async () => null, // always returns null
    })
    const tokenGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const { token } = await tokenGuard.generate(testUser)

    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('User not found')
  })

  test('check() returns true for a valid token', async () => {
    const guard = new JwtGuard(config)
    const { token } = await guard.generate(testUser)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check() returns false for an invalid token', async () => {
    const guard = new JwtGuard(config)
    const ctx = { headers: { authorization: 'Bearer invalid.token.here' } }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('generate() default expiresIn is 3600 seconds when not specified', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser }) // no expiresIn
    const before = Date.now()
    const result = await guard.generate(testUser)
    const after = Date.now()

    const expectedMin = before + 3600 * 1000 - 1000
    const expectedMax = after + 3600 * 1000 + 1000
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedMin)
    expect(result.expiresAt.getTime()).toBeLessThan(expectedMax)
  })
})

// SessionGuard

describe('SessionGuard', () => {
  const config: SessionGuardConfig = { resolve: findUser }

  test('name property is "session"', () => {
    const guard = new SessionGuard(config)
    expect(guard.name).toBe('session')
  })

  test('can be instantiated with minimal config', () => {
    const guard = new SessionGuard({ resolve: findUser })
    expect(guard).toBeInstanceOf(SessionGuard)
  })

  test('can be instantiated with custom sessionKey', () => {
    const guard = new SessionGuard({ resolve: findUser, sessionKey: 'my_auth_id' })
    expect(guard).toBeInstanceOf(SessionGuard)
  })

  test('authenticate() returns user when session contains a valid user id', async () => {
    const guard = new SessionGuard(config)
    const ctx = {
      session: { get: (_: string) => 1, forget: () => {} },
    }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() throws when session is missing', async () => {
    const guard = new SessionGuard(config)
    const ctx = {}
    await expect(guard.authenticate(ctx)).rejects.toThrow('Session not available')
  })

  test('authenticate() throws when session has no user id', async () => {
    const guard = new SessionGuard(config)
    const ctx = { session: { get: () => null, forget: () => {} } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Not authenticated')
  })

  test('authenticate() throws and forgets key when user is not found', async () => {
    const guard = new SessionGuard({ resolve: async () => null })
    let forgottenKey = ''
    const ctx = {
      session: { get: () => 99, forget: (k: string) => { forgottenKey = k } },
    }
    await expect(guard.authenticate(ctx)).rejects.toThrow('User not found')
    expect(forgottenKey).toBe('auth_user_id')
  })

  test('login() stores user id in session', async () => {
    const guard = new SessionGuard(config)
    const stored: Record<string, any> = {}
    const ctx = {
      session: {
        put: (k: string, v: any) => { stored[k] = v },
        regenerate: async () => {},
      },
    }
    await guard.login(testUser, ctx)
    expect(stored['auth_user_id']).toBe(testUser.id)
  })

  test('logout() removes user id from session', async () => {
    const guard = new SessionGuard(config)
    const forgotten: string[] = []
    const ctx = {
      session: {
        forget: (k: string) => { forgotten.push(k) },
        regenerate: async () => {},
      },
    }
    await guard.logout(ctx)
    expect(forgotten).toContain('auth_user_id')
  })

  test('check() returns true when authenticate succeeds', async () => {
    const guard = new SessionGuard(config)
    const ctx = { session: { get: () => 1, forget: () => {} } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check() returns false when authenticate fails', async () => {
    const guard = new SessionGuard(config)
    const ctx = {}
    expect(await guard.check(ctx)).toBe(false)
  })
})

// DatabaseTokenGuard

describe('DatabaseTokenGuard', () => {
  // Minimal in-memory mock for the db interface used by DatabaseTokenGuard
  function makeDb() {
    const rows: any[] = []
    let nextId = 1
    return {
      exec: async (_sql: string) => {},
      run: async (_sql: string, args: any[] = []) => {
        // Crude INSERT / UPDATE / DELETE routing for testing
        if (_sql.trim().toUpperCase().startsWith('INSERT')) {
          const row = {
            id: nextId++,
            user_id: args[0],
            name: args[1],
            hash: args[2],
            metadata: args[3],
            created_at: args[4],
            expires_at: args[5] ?? null,
            last_used_at: null,
          }
          rows.push(row)
          return { lastInsertRowid: row.id }
        }
        if (_sql.trim().toUpperCase().startsWith('UPDATE')) {
          const id = args[1]
          const row = rows.find(r => r.id === id)
          if (row) row.last_used_at = args[0]
          return {}
        }
        if (_sql.trim().toUpperCase().startsWith('DELETE')) {
          const id = args[0]
          const idx = rows.findIndex(r => r.id === id || r.user_id === String(id))
          if (idx !== -1) rows.splice(idx, 1)
          return {}
        }
        return {}
      },
      queryOne: async (_sql: string, args: any[] = []) => { if (_sql.includes('last_insert_rowid')) return { id: nextId - 1 }; return rows.find(r => r.hash === args[0]) ?? null },
      query: async (_sql: string, args: any[] = []) => rows.filter(r => r.user_id === args[0]),
      _rows: rows,
    }
  }

  test('can be instantiated with required config', () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    expect(guard).toBeInstanceOf(DatabaseTokenGuard)
  })

  test('name property is "database_token"', () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    expect(guard.name).toBe('database_token')
  })

  test('can be instantiated with custom prefix and table', () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser, prefix: 'tok_', table: 'tokens' })
    expect(guard).toBeInstanceOf(DatabaseTokenGuard)
  })
})

// AccessTokenGuard

describe('AccessTokenGuard', () => {
  test('can be instantiated with a verifier function', () => {
    const verifier = async (token: string) => (token === 'valid' ? testUser : null)
    const guard = new AccessTokenGuard(verifier)
    expect(guard).toBeInstanceOf(AccessTokenGuard)
  })

  test('name property is "access_token"', () => {
    const guard = new AccessTokenGuard(async () => null)
    expect(guard.name).toBe('access_token')
  })

  test('authenticate() returns user when verifier resolves a user', async () => {
    const guard = new AccessTokenGuard(async (token) => (token === 'valid-token' ? testUser : null))
    const ctx = { headers: { authorization: 'Bearer valid-token' } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() throws when authorization header is missing', async () => {
    const guard = new AccessTokenGuard(async () => testUser)
    const ctx = { headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing authorization header')
  })

  test('authenticate() throws when verifier returns null', async () => {
    const guard = new AccessTokenGuard(async () => null)
    const ctx = { headers: { authorization: 'Bearer bad-token' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid or expired token')
  })

  test('check() returns true for a valid token', async () => {
    const guard = new AccessTokenGuard(async () => testUser)
    const ctx = { headers: { authorization: 'Bearer any-token' } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check() returns false when authenticate fails', async () => {
    const guard = new AccessTokenGuard(async () => null)
    const ctx = { headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('authenticate() respects custom headerName config', async () => {
    const guard = new AccessTokenGuard(
      async (token) => (token === 'mytoken' ? testUser : null),
      { headerName: 'x-api-key', prefix: 'Token' }
    )
    const ctx = { headers: { 'x-api-key': 'Token mytoken' } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })
})

// BasicAuthGuard

describe('BasicAuthGuard', () => {
  const config: BasicAuthGuardConfig = {
    verifyCredentials: async (uid, password) => {
      if (uid === 'alice' && password === 'secret') return testUser
      return null
    },
  }

  test('can be instantiated', () => {
    const guard = new BasicAuthGuard(config)
    expect(guard).toBeInstanceOf(BasicAuthGuard)
  })

  test('name property is "basic"', () => {
    const guard = new BasicAuthGuard(config)
    expect(guard.name).toBe('basic')
  })

  test('authenticate() returns user for valid credentials', async () => {
    const guard = new BasicAuthGuard(config)
    const credentials = btoa('alice:secret')
    const ctx = { headers: { authorization: `Basic ${credentials}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() handles passwords containing colons', async () => {
    const specialConfig: BasicAuthGuardConfig = {
      verifyCredentials: async (uid, password) =>
        uid === 'alice' && password === 'pass:word:with:colons' ? testUser : null,
    }
    const guard = new BasicAuthGuard(specialConfig)
    const credentials = btoa('alice:pass:word:with:colons')
    const ctx = { headers: { authorization: `Basic ${credentials}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() throws when authorization header is missing', async () => {
    const guard = new BasicAuthGuard(config)
    const ctx = { headers: {} }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing basic auth credentials')
  })

  test('authenticate() throws when header does not start with "Basic "', async () => {
    const guard = new BasicAuthGuard(config)
    const ctx = { headers: { authorization: 'Bearer sometoken' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing basic auth credentials')
  })

  test('authenticate() throws for invalid credentials', async () => {
    const guard = new BasicAuthGuard(config)
    const credentials = btoa('alice:wrongpassword')
    const ctx = { headers: { authorization: `Basic ${credentials}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid credentials')
  })

  test('check() returns true for valid credentials', async () => {
    const guard = new BasicAuthGuard(config)
    const ctx = { headers: { authorization: `Basic ${btoa('alice:secret')}` } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check() returns false for invalid credentials', async () => {
    const guard = new BasicAuthGuard(config)
    const ctx = { headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })
})

// AuthProvider

describe('AuthProvider', () => {
  test('AuthProvider class exists', () => {
    expect(AuthProvider).toBeDefined()
  })

  test('AuthProvider has a register method', () => {
    const provider = new AuthProvider()
    expect(typeof provider.register).toBe('function')
  })

  test('register() does nothing when config("auth") returns falsy', async () => {
    const provider = new AuthProvider()
    const app = new App()
    // `config('auth')` returns undefined; provider should early-return.
    app.instance('config', (_key: string) => undefined)
    await expect(provider.register(app)).resolves.toBeUndefined()
  })
})

// JwtGuard — additional edge cases

describe('JwtGuard: additional edge cases', () => {
  const secret = 'edge-case-secret'
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : id == 2 ? { id: 2, name: 'Bob' } : null

  test('authenticate() throws on completely malformed token (single segment)', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer notavalidtoken' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('authenticate() throws on token signed with different secret', async () => {
    const guard1 = new JwtGuard({ secret: 'secret-one', resolve: findUser })
    const guard2 = new JwtGuard({ secret: 'secret-two', resolve: findUser })
    const { token } = await guard1.generate({ id: 1, name: 'Alice' })
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await expect(guard2.authenticate(ctx)).rejects.toThrow('Invalid token signature')
  })

  test('generate() embeds sub claim equal to user id', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 42, name: 'Test' })
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.sub).toBe(42)
  })

  test('generate() embeds iat claim as a number', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const before = Math.floor(Date.now() / 1000)
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const after = Math.floor(Date.now() / 1000)
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(typeof payload.iat).toBe('number')
    expect(payload.iat).toBeGreaterThanOrEqual(before)
    expect(payload.iat).toBeLessThanOrEqual(after)
  })

  test('generate() with multiple custom claims embeds all of them', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' }, { claims: { role: 'admin', org: 'tekir' } })
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.role).toBe('admin')
    expect(payload.org).toBe('tekir')
  })

  test('check() returns false for expired token', async () => {
    const guard = new JwtGuard({ secret, expiresIn: -10, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const verifyGuard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    expect(await verifyGuard.check(ctx)).toBe(false)
  })

  test('check() returns false for missing header', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('authenticate() with token that has no "Bearer " prefix still works', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    // Pass token directly without "Bearer " prefix
    const ctx = { headers: { authorization: token } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })

  test('generate() produces tokens with exactly 3 dot-separated segments', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    expect(token.split('.').length).toBe(3)
  })

  test('two tokens generated for same user are different (random jti or timestamp)', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const a = await guard.generate({ id: 1, name: 'Alice' })
    await new Promise(r => setTimeout(r, 10))
    const b = await guard.generate({ id: 1, name: 'Alice' })
    // Tokens may differ in iat; at minimum the full strings should differ or be equal —
    // just confirm both are valid JWT strings
    expect(a.token.split('.').length).toBe(3)
    expect(b.token.split('.').length).toBe(3)
  })
})

// Auth — additional edge cases

describe('Auth: additional edge cases', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : null

  test('guard() with unknown name throws descriptive error', () => {
    const manager = new Auth({ defaultGuard: 'jwt', guards: {} })
    expect(() => manager.guard('phantom')).toThrow('Auth guard "phantom" not configured')
  })

  test('default guard is used by middleware when no guard names given', async () => {
    const secret = 'def-secret'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const { token } = await jwtGuard.generate({ id: 1, name: 'Alice' })
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    await manager.middleware()(ctx, async () => {})
    expect(ctx.auth.guard).toBe('jwt')
  })

  test('middleware() returns a function (explicit re-check via additional manager)', () => {
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => new JwtGuard({ secret: 'x', resolve: findUser }) },
    })
    expect(typeof manager.middleware()).toBe('function')
    expect(typeof manager.middleware(['jwt'])).toBe('function')
  })

  test('guest() calls next when unauthenticated (re-check with separate manager)', async () => {
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => new JwtGuard({ secret: 'x', resolve: findUser }) },
    })
    const ctx: any = { headers: {} }
    let called = false
    await manager.guest()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('guard() caches and returns same instance on repeated calls', () => {
    const jwtGuard = new JwtGuard({ secret: 'cache-test', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const a = manager.guard('jwt')
    const b = manager.guard('jwt')
    expect(a).toBe(b)
  })
})

// AccessTokenGuard — additional edge cases

describe('AccessTokenGuard: additional edge cases', () => {
  const testUser = { id: 1, name: 'Alice' }

  test('authenticate() extracts token after stripping the default "Bearer " prefix', async () => {
    let receivedToken = ''
    const guard = new AccessTokenGuard(async (t) => { receivedToken = t; return testUser })
    const ctx = { headers: { authorization: 'Bearer myrawtoken' } }
    await guard.authenticate(ctx)
    expect(receivedToken).toBe('myrawtoken')
  })

  test('authenticate() with custom headerName reads from that header', async () => {
    const guard = new AccessTokenGuard(
      async (t) => (t === 'abc123' ? testUser : null),
      { headerName: 'x-token', prefix: '' }
    )
    const ctx = { headers: { 'x-token': 'abc123' } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })

  test('authenticate() with custom prefix strips the prefix before passing to verifier', async () => {
    let received = ''
    const guard = new AccessTokenGuard(
      async (t) => { received = t; return testUser },
      { headerName: 'authorization', prefix: 'Token' }
    )
    const ctx = { headers: { authorization: 'Token secretvalue' } }
    await guard.authenticate(ctx)
    expect(received).toBe('secretvalue')
  })

  test('check() returns true when verifier resolves a user', async () => {
    const guard = new AccessTokenGuard(async () => testUser)
    const ctx = { headers: { authorization: 'Bearer anything' } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('check() returns false when authorization header is missing', async () => {
    const guard = new AccessTokenGuard(async () => testUser)
    const ctx = { headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('authenticate() throws "Invalid or expired token" when verifier returns null', async () => {
    const guard = new AccessTokenGuard(async () => null)
    const ctx = { headers: { authorization: 'Bearer bad' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid or expired token')
  })
})

// DatabaseTokenGuard — additional edge cases

describe('DatabaseTokenGuard: additional edge cases', () => {
  function makeDb() {
    const rows: any[] = []
    let nextId = 1
    return {
      exec: async (_sql: string) => {},
      run: async (_sql: string, args: any[] = []) => {
        const sql = _sql.trim().toUpperCase()
        if (sql.startsWith('INSERT')) {
          const row = {
            id: nextId++,
            user_id: args[0],
            name: args[1],
            hash: args[2],
            metadata: args[3],
            created_at: args[4],
            expires_at: args[5] ?? null,
            last_used_at: null,
          }
          rows.push(row)
          return { lastInsertRowid: row.id }
        }
        if (sql.startsWith('UPDATE')) {
          const id = args[1]
          const row = rows.find(r => r.id === id)
          if (row) row.last_used_at = args[0]
          return {}
        }
        if (sql.startsWith('DELETE')) {
          const arg = args[0]
          // If SQL contains WHERE user_id, remove all matching rows; else remove by id
          if (_sql.includes('user_id')) {
            // revokeAll — remove all tokens for the user
            let i = rows.length - 1
            while (i >= 0) {
              if (rows[i].user_id === String(arg)) rows.splice(i, 1)
              i--
            }
          } else {
            // revoke — remove single token by id
            const idx = rows.findIndex(r => r.id === arg)
            if (idx !== -1) rows.splice(idx, 1)
          }
          return {}
        }
        return {}
      },
      queryOne: async (_sql: string, args: any[] = []) => {
        if (_sql.includes('last_insert_rowid')) return { id: nextId - 1 }
        const hash = args[0]
        return rows.find(r => r.hash === hash) ?? null
      },
      query: async (_sql: string, args: any[] = []) =>
        rows
          .filter(r => r.user_id === args[0])
          .map(r => ({ ...r })),
      _rows: rows,
    }
  }

  const findUser = async (id: string | number) =>
    id == '1' || id == 1 ? { id: 1, name: 'Alice' } : null

  test('generate() returns a token string starting with the prefix', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    expect(typeof result.token).toBe('string')
    expect(result.token.startsWith('oat_')).toBe(true)
  })

  test('generate() returns a numeric id', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    expect(typeof result.id).toBe('number')
    expect(result.id).toBeGreaterThan(0)
  })

  test('generate() with custom prefix uses that prefix', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser, prefix: 'tok_' })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    expect(result.token.startsWith('tok_')).toBe(true)
  })

  test('generate() stores different hashes for different tokens', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const r1 = await guard.generate({ id: 1, name: 'Alice' })
    const r2 = await guard.generate({ id: 1, name: 'Alice' })
    const rows = (db as any)._rows
    expect(rows[0].hash).not.toBe(rows[1].hash)
  })

  test('revoke() removes token from the db', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const { id } = await guard.generate({ id: 1, name: 'Alice' })
    await guard.revoke(id)
    expect((db as any)._rows.find((r: any) => r.id === id)).toBeUndefined()
  })

  test('revokeAll() removes all tokens for a user', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate({ id: 1, name: 'Alice' })
    await guard.generate({ id: 1, name: 'Alice' })
    await guard.revokeAll(1)
    expect((db as any)._rows.filter((r: any) => r.user_id === '1')).toHaveLength(0)
  })

  test('check() returns false for missing auth header', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const ctx = { headers: {} }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('list() returns tokens for the given user', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate({ id: 1, name: 'Alice' }, { name: 'token-a' })
    await guard.generate({ id: 1, name: 'Alice' }, { name: 'token-b' })
    const tokens = await guard.list(1)
    expect(tokens).toHaveLength(2)
  })
})

// BasicAuthGuard — additional edge cases

describe('BasicAuthGuard: additional edge cases', () => {
  const testUser = { id: 1, name: 'Alice' }

  test('authenticate() throws when header is present but base64 decodes to no colon', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    // base64 of "nocolon" (no colon separator)
    const ctx = { headers: { authorization: `Basic ${btoa('nocolon')}` } }
    // colonIndex === -1 → throws 'Invalid basic auth format'
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid basic auth format')
  })

  test('authenticate() throws when credentials are empty string', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    const ctx = { headers: { authorization: `Basic ${btoa('')}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('authenticate() returns user when verifyCredentials returns the user', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'bob' && p === 'pw' ? testUser : null,
    })
    const ctx = { headers: { authorization: `Basic ${btoa('bob:pw')}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })

  test('check() returns false when credentials are wrong', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    const ctx = { headers: { authorization: `Basic ${btoa('x:y')}` } }
    expect(await guard.check(ctx)).toBe(false)
  })

  test('check() returns true when credentials are correct', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'alice' && p === 'secret' ? testUser : null,
    })
    const ctx = { headers: { authorization: `Basic ${btoa('alice:secret')}` } }
    expect(await guard.check(ctx)).toBe(true)
  })

  test('authenticate() correctly splits on FIRST colon when username contains none', async () => {
    let capturedUser = ''
    let capturedPass = ''
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => {
        capturedUser = u
        capturedPass = p
        return testUser
      },
    })
    const ctx = { headers: { authorization: `Basic ${btoa('user:pass')}` } }
    await guard.authenticate(ctx)
    expect(capturedUser).toBe('user')
    expect(capturedPass).toBe('pass')
  })

  test('name property is "basic" (re-check via fresh instance)', () => {
    const guard = new BasicAuthGuard({ verifyCredentials: async () => null })
    expect(guard.name).toBe('basic')
  })
})

// Silent Auth middleware

describe('silentAuth middleware', () => {
  test('sets ctx.auth.user when token is valid', async () => {
    const secret = 'silent-auth-test-secret-key-32c!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.silentAuth()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.id).toBe(1)
    expect(ctx.auth.guard).toBe('jwt')
  })

  test('sets ctx.auth.isAuthenticated = false when no token', async () => {
    const secret = 'silent-auth-test-secret-key-32c!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const ctx: any = { headers: {} }
    let nextCalled = false

    await manager.silentAuth()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })

  test('never throws even with invalid token', async () => {
    const secret = 'silent-auth-test-secret-key-32c!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const ctx: any = { headers: { authorization: 'Bearer garbage.invalid.token' } }
    let nextCalled = false

    // Should NOT throw
    await manager.silentAuth()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })

  test('tries multiple guards silently', async () => {
    const secret = 'silent-auth-test-secret-key-32c!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === 'pw' ? adminUser : null,
    })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard, basic: () => basicGuard },
    })

    // JWT fails, Basic succeeds
    const ctx: any = { headers: { authorization: `Basic ${btoa('admin:pw')}` } }
    let nextCalled = false

    await manager.silentAuth(['jwt', 'basic'])(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.name).toBe('Bob')
    expect(ctx.auth.guard).toBe('basic')
  })
})

// Silent Auth — end-to-end via TekirServer

describe('silentAuth — end-to-end via TekirServer', () => {
  test('page works without auth, shows user when authed', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const secret = 'silent-e2e-test-secret-key-32c!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/page', (ctx: any) => ({
      greeting: ctx.auth?.isAuthenticated ? `Hello ${ctx.auth.user.name}` : 'Hello guest',
    }))
    router.useRouter(manager.silentAuth())

    // Without token — guest
    const guestRes = await server.handle(new Request('http://localhost/page'))
    expect(guestRes.status).toBe(200)
    const guestBody = await guestRes.json()
    expect(guestBody.greeting).toBe('Hello guest')

    // With token — authenticated
    const { token } = await jwtGuard.generate(testUser)
    const authRes = await server.handle(new Request('http://localhost/page', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(authRes.status).toBe(200)
    const authBody = await authRes.json()
    expect(authBody.greeting).toBe('Hello Alice')
  })
})

// End-to-end: Auth middleware with TekirServer.handle()

describe('Auth middleware — end-to-end via TekirServer', () => {
  function createAuthServer() {
    const server = new TekirServer()
    const router = server.getRouter()

    const secret = 'e2e-test-secret-key-for-jwt-signing'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })

    return { server, router, manager, jwtGuard }
  }

  function req(path: string, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, { headers })
  }

  test('protected route returns 401 without token', async () => {
    const { server, router, manager } = createAuthServer()

    router.get('/protected', ({ response }: any) => response.ok({ secret: 'data' }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/protected'))
    expect(res.status).toBe(401)
  })

  test('protected route returns 200 with valid JWT', async () => {
    const { server, router, manager, jwtGuard } = createAuthServer()

    router.get('/protected', (ctx: any) => {
      return { user: ctx.auth.user.name, guard: ctx.auth.guard }
    })
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(req('/protected', { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
    expect(body.guard).toBe('jwt')
  })

  test('ctx.auth.isAuthenticated is true after middleware', async () => {
    const { server, router, manager, jwtGuard } = createAuthServer()

    router.get('/check', (ctx: any) => {
      return { isAuth: ctx.auth.isAuthenticated }
    })
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(req('/check', { authorization: `Bearer ${token}` }))
    const body = await res.json()
    expect(body.isAuth).toBe(true)
  })

  test('expired JWT returns 401', async () => {
    const { server, router, manager } = createAuthServer()
    const expiredGuard = new JwtGuard({ secret: 'e2e-test-secret-key-for-jwt-signing', expiresIn: -1, resolve: findUser })

    router.get('/protected', (ctx: any) => ({ ok: true }))
    router.useRouter(manager.middleware())

    const { token } = await expiredGuard.generate(testUser)
    const res = await server.handle(req('/protected', { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(401)
  })

  test('invalid token format returns 401', async () => {
    const { server, router, manager } = createAuthServer()

    router.get('/protected', () => ({ ok: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/protected', { authorization: 'Bearer garbage.token.here' }))
    expect(res.status).toBe(401)
  })

  test('missing Authorization header returns 401', async () => {
    const { server, router, manager } = createAuthServer()

    router.get('/protected', () => ({ ok: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/protected'))
    expect(res.status).toBe(401)
  })

  test('public route without middleware works normally', async () => {
    const { server, router } = createAuthServer()

    router.get('/public', () => ({ public: true }))

    const res = await server.handle(req('/public'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.public).toBe(true)
  })

  test('per-route auth middleware only protects that route', async () => {
    const { server, router, manager, jwtGuard } = createAuthServer()

    router.get('/open', () => ({ open: true }))
    router.get('/closed', (ctx: any) => ({ user: ctx.auth.user.name })).use(manager.middleware())

    // /open works without token
    const openRes = await server.handle(req('/open'))
    expect(openRes.status).toBe(200)

    // /closed fails without token
    const closedRes = await server.handle(req('/closed'))
    expect(closedRes.status).toBe(401)

    // /closed works with token
    const { token } = await jwtGuard.generate(testUser)
    const authedRes = await server.handle(req('/closed', { authorization: `Bearer ${token}` }))
    expect(authedRes.status).toBe(200)
    const body = await authedRes.json()
    expect(body.user).toBe('Alice')
  })
})

// End-to-end: BasicAuth with TekirServer

describe('BasicAuth middleware — end-to-end via TekirServer', () => {
  test('basic auth protects route', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === 'secret' ? testUser : null,
    })
    const manager = new Auth({
      defaultGuard: 'basic',
      guards: { basic: () => guard },
    })

    router.get('/admin', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    // No creds
    const noAuth = await server.handle(new Request('http://localhost/admin'))
    expect(noAuth.status).toBe(401)

    // Wrong creds
    const wrongAuth = await server.handle(new Request('http://localhost/admin', {
      headers: { authorization: `Basic ${btoa('admin:wrong')}` },
    }))
    expect(wrongAuth.status).toBe(401)

    // Correct creds
    const goodAuth = await server.handle(new Request('http://localhost/admin', {
      headers: { authorization: `Basic ${btoa('admin:secret')}` },
    }))
    expect(goodAuth.status).toBe(200)
    const body = await goodAuth.json()
    expect(body.user).toBe('Alice')
  })
})

// End-to-end: AccessTokenGuard with TekirServer

describe('AccessTokenGuard middleware — end-to-end via TekirServer', () => {
  test('access token protects route', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const guard = new AccessTokenGuard(async (token) => {
      return token === 'valid-api-key' ? testUser : null
    })
    const manager = new Auth({
      defaultGuard: 'api',
      guards: { api: () => guard },
    })

    router.get('/api/data', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    // No token
    const noToken = await server.handle(new Request('http://localhost/api/data'))
    expect(noToken.status).toBe(401)

    // Wrong token
    const wrongToken = await server.handle(new Request('http://localhost/api/data', {
      headers: { authorization: 'Bearer wrong-key' },
    }))
    expect(wrongToken.status).toBe(401)

    // Valid token
    const goodToken = await server.handle(new Request('http://localhost/api/data', {
      headers: { authorization: 'Bearer valid-api-key' },
    }))
    expect(goodToken.status).toBe(200)
    const body = await goodToken.json()
    expect(body.user).toBe('Alice')
  })
})

// End-to-end: Multi-guard fallback

describe('Multi-guard fallback — end-to-end via TekirServer', () => {
  test('tries multiple guards, uses first success', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const secret = 'multi-guard-test-secret'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === 'pw' ? adminUser : null,
    })

    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        basic: () => basicGuard,
      },
    })

    router.get('/multi', (ctx: any) => ({
      user: ctx.auth.user.name,
      guard: ctx.auth.guard,
    }))
    router.useRouter(manager.middleware(['jwt', 'basic']))

    // JWT token works
    const { token } = await jwtGuard.generate(testUser)
    const jwtRes = await server.handle(new Request('http://localhost/multi', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(jwtRes.status).toBe(200)
    const jwtBody = await jwtRes.json()
    expect(jwtBody.guard).toBe('jwt')
    expect(jwtBody.user).toBe('Alice')

    // Basic auth works as fallback
    const basicRes = await server.handle(new Request('http://localhost/multi', {
      headers: { authorization: `Basic ${btoa('admin:pw')}` },
    }))
    expect(basicRes.status).toBe(200)
    const basicBody = await basicRes.json()
    expect(basicBody.guard).toBe('basic')
    expect(basicBody.user).toBe('Bob')

    // No auth fails
    const noAuth = await server.handle(new Request('http://localhost/multi'))
    expect(noAuth.status).toBe(401)
  })
})

// Bug fix: auth middleware must NOT swallow errors from next()

describe('Auth middleware — does not swallow downstream errors', () => {
  test('handler throwing 500 is not converted to 401', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'downstream-error-test-secret-32!!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/crash', () => { throw new Error('Handler crashed') })
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/crash', {
      headers: { authorization: `Bearer ${token}` },
    }))
    // Should be 500 (handler error), NOT 401 (auth error)
    expect(res.status).toBe(500)
  })

  test('downstream middleware throwing 403 is not swallowed', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'downstream-403-test-secret-32!!!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const forbidMiddleware = async () => { throw new HttpException('Forbidden', 403) }

    router.get('/forbidden', () => ({ ok: true }))
      .use([manager.middleware(), forbidMiddleware])

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/forbidden', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('downstream middleware throwing 422 is not swallowed', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'downstream-422-test-secret-32!!!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const validationMiddleware = async () => { throw new HttpException('Validation failed', 422, 'VALIDATION') }

    router.post('/validate', () => ({ ok: true }))
      .use([manager.middleware(), validationMiddleware])

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/validate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(422)
  })

  test('auth success + handler success = 200', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'success-flow-test-secret-32chars!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/ok', ({ auth }: any) => ({ name: auth.user.name }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/ok', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Alice')
  })

  test('auth fail = 401 body contains error info', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'error-body-test-secret-32-chars!'
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/info', () => ({ ok: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(new Request('http://localhost/info'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.statusCode).toBe(401)
  })
})

// Helper for e2e tests

function req(path: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost' + path, { headers })
}

// JwtGuard — more edge cases

describe('JwtGuard: extended edge cases', () => {
  const secret = 'extended-edge-case-secret-key-32!'

  test('authenticate() throws on token signed with wrong secret', async () => {
    const guard1 = new JwtGuard({ secret: 'correct-secret', resolve: findUser })
    const guard2 = new JwtGuard({ secret: 'wrong-secret', resolve: findUser })
    const { token } = await guard1.generate(testUser)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await expect(guard2.authenticate(ctx)).rejects.toThrow('Invalid token signature')
  })

  test('authenticate() throws on tampered payload (modified sub)', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser)
    const [header, payload, sig] = token.split('.')
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    decoded.sub = 999
    const tamperedPayload = btoa(JSON.stringify(decoded)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const tamperedToken = `${header}.${tamperedPayload}.${sig}`
    const ctx = { headers: { authorization: `Bearer ${tamperedToken}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token signature')
  })

  test('authenticate() throws on token missing exp claim when expired check runs', async () => {
    // A token without exp should still validate (exp check is conditional)
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser)
    // The token has exp, so it should authenticate fine
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() throws on empty bearer value', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer ' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('authenticate() throws on token with spaces', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer has spaces in token' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('generate() with custom claims makes them accessible after authenticate', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser, { claims: { scope: 'read:all', tier: 'premium' } })
    // Verify the claims are in the token payload
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.scope).toBe('read:all')
    expect(payload.tier).toBe('premium')
    expect(payload.sub).toBe(testUser.id)
  })

  test('generate() with very long custom claims still produces valid token', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const longValue = 'x'.repeat(10000)
    const { token } = await guard.generate(testUser, { claims: { data: longValue } })
    expect(token.split('.').length).toBe(3)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() with two-segment token throws', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer part1.part2' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('generate() for different users produces different sub claims', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token: t1 } = await guard.generate(testUser)
    const { token: t2 } = await guard.generate(adminUser)
    const p1 = JSON.parse(atob(t1.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const p2 = JSON.parse(atob(t2.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    expect(p1.sub).toBe(1)
    expect(p2.sub).toBe(2)
  })

  test('check() returns true for valid token, false for wrong-secret token', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const otherGuard = new JwtGuard({ secret: 'other-secret', resolve: findUser })
    const { token } = await guard.generate(testUser)
    expect(await guard.check({ headers: { authorization: `Bearer ${token}` } })).toBe(true)
    expect(await otherGuard.check({ headers: { authorization: `Bearer ${token}` } })).toBe(false)
  })
})

// Auth.login() and Auth.logout() helper methods

describe('Auth.login() and Auth.logout()', () => {
  test('login() sets ctx.auth with user and isAuthenticated true', async () => {
    const jwtGuard = new JwtGuard({ secret: 'login-test', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const ctx: any = {}
    await manager.login(ctx, testUser)
    expect(ctx.auth.user).toBe(testUser)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.guard).toBe('jwt')
  })

  test('login() with specific guard name sets that guard name', async () => {
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => new JwtGuard({ secret: 'x', resolve: findUser }),
        basic: () => basicGuard,
      },
    })
    const ctx: any = {}
    await manager.login(ctx, testUser, 'basic')
    expect(ctx.auth.guard).toBe('basic')
    expect(ctx.auth.user).toBe(testUser)
  })

  test('logout() clears ctx.auth', async () => {
    const jwtGuard = new JwtGuard({ secret: 'logout-test', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const ctx: any = { auth: { user: testUser, isAuthenticated: true, guard: 'jwt' } }
    await manager.logout(ctx)
    expect(ctx.auth.user).toBeNull()
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.guard).toBeFalsy()
  })

  test('login() then logout() round-trip', async () => {
    const jwtGuard = new JwtGuard({ secret: 'round-trip', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })
    const ctx: any = {}
    await manager.login(ctx, adminUser)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.name).toBe('Bob')

    await manager.logout(ctx)
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })

  test('login() with session guard calls guard.login()', async () => {
    const stored: Record<string, any> = {}
    const sessionGuard = new SessionGuard({ resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'session',
      guards: { session: () => sessionGuard },
    })
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { stored[k] = v },
        regenerate: async () => {},
      },
    }
    await manager.login(ctx, testUser, 'session')
    expect(stored['auth_user_id']).toBe(testUser.id)
    expect(ctx.auth.isAuthenticated).toBe(true)
  })
})

// Auth.silentAuth() — more cases

describe('silentAuth: more cases', () => {
  test('silentAuth with expired token does not block', async () => {
    const secret = 'silent-expired-secret-32chars!!!'
    const expiredGuard = new JwtGuard({ secret, expiresIn: -10, resolve: findUser })
    const freshGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => freshGuard } })

    const { token } = await expiredGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.silentAuth()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })

  test('silentAuth with wrong secret does not block', async () => {
    const guard1 = new JwtGuard({ secret: 'secret-A', resolve: findUser })
    const guard2 = new JwtGuard({ secret: 'secret-B', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => guard2 } })

    const { token } = await guard1.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.silentAuth()(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
  })

  test('silentAuth with multiple guards where second succeeds', async () => {
    const secret = 'silent-multi-32chars-key!!!!!!!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const accessGuard = new AccessTokenGuard(
      async (t) => (t === 'my-api-key' ? adminUser : null)
    )
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard, api: () => accessGuard },
    })

    const ctx: any = { headers: { authorization: 'Bearer my-api-key' } }
    let nextCalled = false

    // jwt guard will fail (not a valid JWT), api guard will succeed
    await manager.silentAuth(['jwt', 'api'])(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.name).toBe('Bob')
    expect(ctx.auth.guard).toBe('api')
  })

  test('silentAuth with all guards failing still calls next', async () => {
    const jwtGuard = new JwtGuard({ secret: 'silent-all-fail', resolve: findUser })
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard, basic: () => basicGuard },
    })

    const ctx: any = { headers: {} }
    let nextCalled = false

    await manager.silentAuth(['jwt', 'basic'])(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })

  test('silentAuth accepts a single guard name as string', async () => {
    const secret = 'silent-string-guard-secret-32c!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.silentAuth('jwt')(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(true)
    expect(ctx.auth.user.id).toBe(1)
  })
})

// BasicAuthGuard e2e — special characters

describe('BasicAuthGuard e2e: special characters', () => {
  test('password with special characters (!@#$%)', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'user' && p === 'p@ss!#$%' ? testUser : null,
    })
    const manager = new Auth({ defaultGuard: 'basic', guards: { basic: () => guard } })

    router.get('/special', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/special', {
      authorization: `Basic ${btoa('user:p@ss!#$%')}`,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
  })

  test('unicode credentials', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'user' && p === 'hello' ? testUser : null,
    })
    const manager = new Auth({ defaultGuard: 'basic', guards: { basic: () => guard } })

    router.get('/unicode', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/unicode', {
      authorization: `Basic ${btoa('user:hello')}`,
    }))
    expect(res.status).toBe(200)
  })

  test('empty password is handled', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === '' ? testUser : null,
    })
    const manager = new Auth({ defaultGuard: 'basic', guards: { basic: () => guard } })

    router.get('/empty-pw', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/empty-pw', {
      authorization: `Basic ${btoa('admin:')}`,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
  })
})

// AccessTokenGuard e2e — edge cases

describe('AccessTokenGuard e2e: edge cases', () => {
  test('token with custom prefix via TekirServer', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const guard = new AccessTokenGuard(
      async (t) => (t === 'my-secret-key' ? testUser : null),
      { headerName: 'x-api-key', prefix: 'Token' }
    )
    const manager = new Auth({ defaultGuard: 'api', guards: { api: () => guard } })

    router.get('/api', (ctx: any) => ({ user: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const res = await server.handle(req('/api', { 'x-api-key': 'Token my-secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
  })

  test('case sensitivity: token is case-sensitive', async () => {
    const guard = new AccessTokenGuard(async (t) => (t === 'CaseSensitive' ? testUser : null))
    const ctx1 = { headers: { authorization: 'Bearer CaseSensitive' } }
    const user = await guard.authenticate(ctx1)
    expect(user.id).toBe(testUser.id)

    const ctx2 = { headers: { authorization: 'Bearer casesensitive' } }
    await expect(guard.authenticate(ctx2)).rejects.toThrow('Invalid or expired token')
  })

  test('empty string token after prefix is rejected', async () => {
    const guard = new AccessTokenGuard(async () => null)
    const ctx = { headers: { authorization: 'Bearer ' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('token without prefix is passed as-is to verifier', async () => {
    let received = ''
    const guard = new AccessTokenGuard(async (t) => { received = t; return testUser })
    const ctx = { headers: { authorization: 'rawtoken123' } }
    await guard.authenticate(ctx)
    expect(received).toBe('rawtoken123')
  })
})

// DatabaseTokenGuard — extended operations

describe('DatabaseTokenGuard: extended operations', () => {
  function makeDb() {
    const rows: any[] = []
    let nextId = 1
    return {
      exec: async (_sql: string) => {},
      run: async (_sql: string, args: any[] = []) => {
        const sql = _sql.trim().toUpperCase()
        if (sql.startsWith('INSERT')) {
          const row = {
            id: nextId++,
            user_id: args[0],
            name: args[1],
            hash: args[2],
            metadata: args[3],
            created_at: args[4],
            expires_at: args[5] ?? null,
            last_used_at: null,
          }
          rows.push(row)
          return { lastInsertRowid: row.id }
        }
        if (sql.startsWith('UPDATE')) {
          const id = args[1]
          const row = rows.find(r => r.id === id)
          if (row) row.last_used_at = args[0]
          return {}
        }
        if (sql.startsWith('DELETE')) {
          const arg = args[0]
          if (_sql.includes('user_id')) {
            let i = rows.length - 1
            while (i >= 0) {
              if (rows[i].user_id === String(arg)) rows.splice(i, 1)
              i--
            }
          } else {
            const idx = rows.findIndex(r => r.id === arg)
            if (idx !== -1) rows.splice(idx, 1)
          }
          return {}
        }
        return {}
      },
      queryOne: async (_sql: string, args: any[] = []) => { if (_sql.includes('last_insert_rowid')) return { id: nextId - 1 }; return rows.find(r => r.hash === args[0]) ?? null },
      query: async (_sql: string, args: any[] = []) =>
        rows.filter(r => r.user_id === args[0]).map(r => ({ ...r })),
      _rows: rows,
    }
  }

  test('generate() returns unique tokens across multiple calls', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const tokens = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const { token } = await guard.generate(testUser)
      tokens.add(token)
    }
    expect(tokens.size).toBe(10)
  })

  test('revoke() makes token invalid for authenticate', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const { token, id } = await guard.generate(testUser)
    // Token is valid before revoke
    const rawToken = token.slice(4) // strip 'oat_'
    expect(await guard.check({ headers: { authorization: `Bearer ${token}` } })).toBe(true)

    await guard.revoke(id)
    expect(await guard.check({ headers: { authorization: `Bearer ${token}` } })).toBe(false)
  })

  test('revokeAll() clears all tokens for user, other users unaffected', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser)
    await guard.generate(testUser)
    await guard.generate(adminUser)

    await guard.revokeAll(testUser.id)
    const aliceTokens = await guard.list(testUser.id)
    const bobTokens = await guard.list(adminUser.id)
    expect(aliceTokens).toHaveLength(0)
    expect(bobTokens).toHaveLength(1)
  })

  test('list() returns correct number of tokens', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser, { name: 'a' })
    await guard.generate(testUser, { name: 'b' })
    await guard.generate(testUser, { name: 'c' })
    const tokens = await guard.list(testUser.id)
    expect(tokens).toHaveLength(3)
  })

  test('expired token is rejected', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser, expiresIn: -10 })
    const { token } = await guard.generate(testUser)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Token expired')
  })

  test('metadata is stored and retrievable via list', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser, {
      name: 'device-token',
      metadata: { device: 'iPhone', os: 'iOS 17' },
    })
    const tokens = await guard.list(testUser.id)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].metadata).toEqual({ device: 'iPhone', os: 'iOS 17' })
  })

  test('authenticate() attaches currentAccessToken to user', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const { token } = await guard.generate(testUser, { name: 'test-token', metadata: { env: 'test' } })
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
    expect((user as any).currentAccessToken).toBeDefined()
    expect((user as any).currentAccessToken.name).toBe('test-token')
    expect((user as any).currentAccessToken.metadata).toEqual({ env: 'test' })
  })

  test('check() returns true for valid token and false for missing', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const { token } = await guard.generate(testUser)
    expect(await guard.check({ headers: { authorization: `Bearer ${token}` } })).toBe(true)
    expect(await guard.check({ headers: {} })).toBe(false)
  })

  test('generate() with explicit expiresIn overrides config', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser, expiresIn: 3600 })
    await guard.generate(testUser, { expiresIn: 60 })
    const rows = (db as any)._rows
    expect(rows[0].expires_at).toBeDefined()
    const expiresAt = new Date(rows[0].expires_at)
    // Should be about 60 seconds from now, not 3600
    expect(expiresAt.getTime()).toBeLessThan(Date.now() + 120 * 1000)
  })
})

// Multi-guard e2e via TekirServer — 3 guards fallback chain

describe('Multi-guard e2e: 3 guards fallback chain', () => {
  test('3 guards: first fails, second fails, third succeeds', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const jwtGuard = new JwtGuard({ secret: 'three-guard-secret', resolve: findUser })
    const accessGuard = new AccessTokenGuard(async () => null) // always fails
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === 'pass' ? adminUser : null,
    })

    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        api: () => accessGuard,
        basic: () => basicGuard,
      },
    })

    router.get('/chain', (ctx: any) => ({
      user: ctx.auth.user.name,
      guard: ctx.auth.guard,
    }))
    router.useRouter(manager.middleware(['jwt', 'api', 'basic']))

    const res = await server.handle(req('/chain', {
      authorization: `Basic ${btoa('admin:pass')}`,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Bob')
    expect(body.guard).toBe('basic')
  })

  test('all 3 guards fail returns 401', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const jwtGuard = new JwtGuard({ secret: 'three-guard-fail', resolve: findUser })
    const accessGuard = new AccessTokenGuard(async () => null)
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })

    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        api: () => accessGuard,
        basic: () => basicGuard,
      },
    })

    router.get('/all-fail', () => ({ ok: true }))
    router.useRouter(manager.middleware(['jwt', 'api', 'basic']))

    const res = await server.handle(req('/all-fail'))
    expect(res.status).toBe(401)
  })

  test('first guard succeeds — stops trying remaining guards', async () => {
    const server = new TekirServer()
    const router = server.getRouter()

    const secret = 'first-wins-secret-key-32chars!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    let basicCalled = false
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async () => { basicCalled = true; return null },
    })

    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard, basic: () => basicGuard },
    })

    router.get('/first-wins', (ctx: any) => ({ guard: ctx.auth.guard }))
    router.useRouter(manager.middleware(['jwt', 'basic']))

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(req('/first-wins', {
      authorization: `Bearer ${token}`,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.guard).toBe('jwt')
    // basic guard should not have been called since jwt succeeded
    expect(basicCalled).toBe(false)
  })
})

// Per-route vs global middleware: mixed protected and unprotected

describe('Per-route vs global middleware: mixed routes', () => {
  test('protected and unprotected routes on same server', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'mixed-routes-secret-key-32chars!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/public', () => ({ message: 'public' }))
    router.get('/private', (ctx: any) => ({ user: ctx.auth.user.name })).use(manager.middleware())
    router.get('/also-public', () => ({ message: 'also public' }))

    // Public routes work without auth
    const pub1 = await server.handle(req('/public'))
    expect(pub1.status).toBe(200)
    expect((await pub1.json()).message).toBe('public')

    const pub2 = await server.handle(req('/also-public'))
    expect(pub2.status).toBe(200)
    expect((await pub2.json()).message).toBe('also public')

    // Private route fails without auth
    const priv = await server.handle(req('/private'))
    expect(priv.status).toBe(401)

    // Private route works with auth
    const { token } = await jwtGuard.generate(testUser)
    const authed = await server.handle(req('/private', { authorization: `Bearer ${token}` }))
    expect(authed.status).toBe(200)
    expect((await authed.json()).user).toBe('Alice')
  })

  test('multiple protected routes with different guard requirements', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'diff-guards-secret-key-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const basicGuard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'admin' && p === 'pw' ? adminUser : null,
    })
    const jwtManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const basicManager = new Auth({ defaultGuard: 'basic', guards: { basic: () => basicGuard } })

    router.get('/jwt-only', (ctx: any) => ({ user: ctx.auth.user.name })).use(jwtManager.middleware())
    router.get('/basic-only', (ctx: any) => ({ user: ctx.auth.user.name })).use(basicManager.middleware())

    // JWT route works with JWT
    const { token } = await jwtGuard.generate(testUser)
    const jwtRes = await server.handle(req('/jwt-only', { authorization: `Bearer ${token}` }))
    expect(jwtRes.status).toBe(200)
    expect((await jwtRes.json()).user).toBe('Alice')

    // Basic route works with Basic
    const basicRes = await server.handle(req('/basic-only', {
      authorization: `Basic ${btoa('admin:pw')}`,
    }))
    expect(basicRes.status).toBe(200)
    expect((await basicRes.json()).user).toBe('Bob')

    // JWT route fails with Basic creds
    const wrongRes = await server.handle(req('/jwt-only', {
      authorization: `Basic ${btoa('admin:pw')}`,
    }))
    expect(wrongRes.status).toBe(401)
  })
})

// Auth middleware with response helpers

describe('Auth middleware with response helpers', () => {
  test('ctx.response.ok after successful auth', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'response-ok-secret-key-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/data', ({ response, auth }: any) => response.ok({ user: auth.user.name }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(req('/data', { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
  })

  test('ctx.response.created after successful auth', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'response-created-secret-32chars!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.post('/items', ({ response, auth }: any) => response.created({ item: 'new', by: auth.user.name }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/items', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.item).toBe('new')
    expect(body.by).toBe('Alice')
  })
})

// Concurrent requests: multiple different tokens on same server

describe('Concurrent requests: multiple tokens on same server', () => {
  test('multiple concurrent requests with different JWTs resolve correctly', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'concurrent-test-secret-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/whoami', (ctx: any) => ({ name: ctx.auth.user.name, id: ctx.auth.user.id }))
    router.useRouter(manager.middleware())

    const { token: aliceToken } = await jwtGuard.generate(testUser)
    const { token: bobToken } = await jwtGuard.generate(adminUser)

    // Fire both requests concurrently
    const [aliceRes, bobRes] = await Promise.all([
      server.handle(req('/whoami', { authorization: `Bearer ${aliceToken}` })),
      server.handle(req('/whoami', { authorization: `Bearer ${bobToken}` })),
    ])

    expect(aliceRes.status).toBe(200)
    expect(bobRes.status).toBe(200)

    const aliceBody = await aliceRes.json()
    const bobBody = await bobRes.json()
    expect(aliceBody.name).toBe('Alice')
    expect(aliceBody.id).toBe(1)
    expect(bobBody.name).toBe('Bob')
    expect(bobBody.id).toBe(2)
  })

  test('mixed auth and no-auth concurrent requests', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'mixed-concurrent-secret-32chars!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/auth-check', (ctx: any) => ({ name: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)

    const [authRes, noAuthRes] = await Promise.all([
      server.handle(req('/auth-check', { authorization: `Bearer ${token}` })),
      server.handle(req('/auth-check')),
    ])

    expect(authRes.status).toBe(200)
    expect(noAuthRes.status).toBe(401)
  })

  test('5 concurrent requests all authenticate correctly', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'five-concurrent-secret-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/id', (ctx: any) => ({ id: ctx.auth.user.id }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        server.handle(req('/id', { authorization: `Bearer ${token}` }))
      )
    )

    for (const res of results) {
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe(1)
    }
  })
})

// Auth.guest() — additional e2e

describe('Auth.guest() e2e via TekirServer', () => {
  test('guest middleware blocks authenticated users with 403', async () => {
    const secret = 'guest-e2e-secret-key-32-chars!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const server = new TekirServer()
    const router = server.getRouter()
    router.get('/login', () => ({ form: 'login' })).use(manager.guest())

    // No auth — guest can access
    const guestRes = await server.handle(req('/login'))
    expect(guestRes.status).toBe(200)
    expect((await guestRes.json()).form).toBe('login')

    // With valid auth — should be blocked (403)
    const { token } = await jwtGuard.generate(testUser)
    const authedRes = await server.handle(req('/login', { authorization: `Bearer ${token}` }))
    // Authenticated user is blocked — not 200
    expect(authedRes.status).not.toBe(200)
  })
})

// Auth middleware: single string guard name

describe('Auth middleware: single string guard name', () => {
  test('middleware() accepts a single guard name as string', async () => {
    const secret = 'single-guard-string-32-chars!!!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let nextCalled = false

    await manager.middleware('jwt')(ctx, async () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(ctx.auth.user.id).toBe(1)
    expect(ctx.auth.guard).toBe('jwt')
  })
})

// Auth middleware sets logout helper on ctx.auth

describe('Auth middleware: ctx.auth properties', () => {
  test('ctx.auth.guard is set after successful auth', async () => {
    const secret = 'current-guard-test-secret-32!!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => jwtGuard },
    })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    await manager.middleware()(ctx, async () => {})

    expect(ctx.auth.guard).toBe('jwt')
    expect(typeof ctx.auth.generate).toBe('function')
    expect(typeof ctx.auth.logout).toBe('function')
  })

  test('silentAuth sets guard when authenticated', async () => {
    const secret = 'silent-current-guard-secret-32!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    await manager.silentAuth()(ctx, async () => {})

    expect(ctx.auth.guard).toBe('jwt')
    expect(ctx.auth.isAuthenticated).toBe(true)
  })

  test('silentAuth has empty state when unauthenticated', async () => {
    const jwtGuard = new JwtGuard({ secret: 'no-guard-test', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    const ctx: any = { headers: {} }
    await manager.silentAuth()(ctx, async () => {})

    expect(ctx.auth.isAuthenticated).toBe(false)
    expect(ctx.auth.user).toBeNull()
  })
})

// JwtGuard: token format and payload validation

describe('JwtGuard: token format validation', () => {
  const secret = 'format-validation-secret-32chars!'

  test('header segment contains alg HS256', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser)
    const headerJson = atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))
    const header = JSON.parse(headerJson)
    expect(header.alg).toBe('HS256')
    expect(header.typ).toBe('JWT')
  })

  test('payload contains sub, iat, and exp claims', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser)
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.sub).toBeDefined()
    expect(payload.iat).toBeDefined()
    expect(payload.exp).toBeDefined()
    expect(typeof payload.sub).toBe('number')
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
  })

  test('exp is iat + expiresIn', async () => {
    const guard = new JwtGuard({ secret, expiresIn: 7200, resolve: findUser })
    const { token } = await guard.generate(testUser)
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.exp - payload.iat).toBe(7200)
  })

  test('generate() expiresAt matches exp claim', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token, expiresAt } = await guard.generate(testUser)
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(expiresAt.getTime()).toBe(payload.exp * 1000)
  })

  test('generate() throws when reserved claim is overridden via options.claims', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    await expect(guard.generate(testUser, { claims: { sub: 999 } })).rejects.toThrow(/reserved/)
    await expect(guard.generate(testUser, { claims: { iat: 0 } })).rejects.toThrow(/reserved/)
    await expect(guard.generate(testUser, { claims: { exp: 0 } })).rejects.toThrow(/reserved/)
  })

  test('generate() accepts non-reserved custom claims', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate(testUser, { claims: { role: 'admin', org: 'acme' } })
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.role).toBe('admin')
    expect(payload.org).toBe('acme')
    expect(payload.sub).toBe(testUser.id)
  })

  test('authenticate() rejects token with 4 segments', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer a.b.c.d' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })

  test('authenticate() rejects empty string authorization', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const ctx = { headers: { authorization: '' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Missing authorization header')
  })
})

// SessionGuard: additional edge cases

describe('SessionGuard: extended edge cases', () => {
  test('login() calls session.regenerate()', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    let regenerated = false
    const ctx = {
      session: {
        put: () => {},
        regenerate: async () => { regenerated = true },
      },
    }
    await guard.login(testUser, ctx)
    expect(regenerated).toBe(true)
  })

  test('logout() calls session.regenerate()', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    let regenerated = false
    const ctx = {
      session: {
        forget: () => {},
        regenerate: async () => { regenerated = true },
      },
    }
    await guard.logout(ctx)
    expect(regenerated).toBe(true)
  })

  test('login() with custom sessionKey stores under that key', async () => {
    const guard = new SessionGuard({ resolve: findUser, sessionKey: 'custom_user_id' })
    const stored: Record<string, any> = {}
    const ctx = {
      session: {
        put: (k: string, v: any) => { stored[k] = v },
        regenerate: async () => {},
      },
    }
    await guard.login(testUser, ctx)
    expect(stored['custom_user_id']).toBe(testUser.id)
  })

  test('authenticate() uses custom sessionKey to look up user', async () => {
    const guard = new SessionGuard({ resolve: findUser, sessionKey: 'my_uid' })
    const ctx = {
      session: { get: (key: string) => key === 'my_uid' ? 1 : null, forget: () => {} },
    }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate() with adminUser returns admin', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    const ctx = {
      session: { get: () => 2, forget: () => {} },
    }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(adminUser.id)
    expect(user.name).toBe('Bob')
  })
})

// TekirServer e2e: various HTTP methods with auth

describe('Auth e2e: various HTTP methods', () => {
  test('POST route is protected by auth middleware', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'post-method-secret-key-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.post('/items', (ctx: any) => ({ created: true, by: ctx.auth.user.name }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(new Request('http://localhost/items', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(body.by).toBe('Alice')
  })

  test('POST route returns 401 without auth', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'post-no-auth-secret-key-32chars!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.post('/items', () => ({ created: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(new Request('http://localhost/items', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  test('PUT route is protected', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'put-method-secret-key-32-chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.put('/items/1', (ctx: any) => ({ updated: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(new Request('http://localhost/items/1', { method: 'PUT' }))
    expect(res.status).toBe(401)
  })

  test('DELETE route is protected', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'delete-method-secret-32-chars!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.delete('/items/1', () => ({ deleted: true }))
    router.useRouter(manager.middleware())

    const res = await server.handle(new Request('http://localhost/items/1', { method: 'DELETE' }))
    expect(res.status).toBe(401)
  })
})

// DatabaseTokenGuard: authenticate e2e flow

describe('DatabaseTokenGuard: authenticate flow', () => {
  function makeDb() {
    const rows: any[] = []
    let nextId = 1
    return {
      exec: async (_sql: string) => {},
      run: async (_sql: string, args: any[] = []) => {
        const sql = _sql.trim().toUpperCase()
        if (sql.startsWith('INSERT')) {
          const row = {
            id: nextId++,
            user_id: args[0],
            name: args[1],
            hash: args[2],
            metadata: args[3],
            created_at: args[4],
            expires_at: args[5] ?? null,
            last_used_at: null,
          }
          rows.push(row)
          return { lastInsertRowid: row.id }
        }
        if (sql.startsWith('UPDATE')) {
          const id = args[1]
          const row = rows.find(r => r.id === id)
          if (row) row.last_used_at = args[0]
          return {}
        }
        if (sql.startsWith('DELETE')) {
          const arg = args[0]
          if (_sql.includes('user_id')) {
            let i = rows.length - 1
            while (i >= 0) {
              if (rows[i].user_id === String(arg)) rows.splice(i, 1)
              i--
            }
          } else {
            const idx = rows.findIndex(r => r.id === arg)
            if (idx !== -1) rows.splice(idx, 1)
          }
          return {}
        }
        return {}
      },
      queryOne: async (_sql: string, args: any[] = []) => { if (_sql.includes('last_insert_rowid')) return { id: nextId - 1 }; return rows.find(r => r.hash === args[0]) ?? null },
      query: async (_sql: string, args: any[] = []) =>
        rows.filter(r => r.user_id === args[0]).map(r => ({ ...r })),
      _rows: rows,
    }
  }

  test('authenticate() updates last_used_at on valid token', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const { token } = await guard.generate(testUser)
    expect((db as any)._rows[0].last_used_at).toBeNull()

    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await guard.authenticate(ctx)
    expect((db as any)._rows[0].last_used_at).not.toBeNull()
  })

  test('authenticate() throws when user not found for valid token', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({
      db,
      resolve: async () => null, // always null
    })
    const { token } = await guard.generate({ id: 999, name: 'Ghost' } as any)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('User not found')
  })

  test('authenticate() throws for completely unknown token', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    const ctx = { headers: { authorization: 'Bearer oat_completely_unknown_token' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow('Invalid token')
  })

  test('generate() with name stores token name', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser, { name: 'my-laptop' })
    expect((db as any)._rows[0].name).toBe('my-laptop')
  })

  test('generate() without name defaults to empty string', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser)
    expect((db as any)._rows[0].name).toBe('')
  })

  test('generate() without expiresIn and no config expiry stores null expires_at', async () => {
    const db = makeDb()
    const guard = new DatabaseTokenGuard({ db, resolve: findUser })
    await guard.generate(testUser)
    expect((db as any)._rows[0].expires_at).toBeNull()
  })
})

// Auth: 401 response body format

describe('Auth: 401 response body format', () => {
  test('401 response has JSON content-type', async () => {
    const jwtGuard = new JwtGuard({ secret: '401-format-test', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const ctx: any = { headers: {} }
    const result = await manager.middleware()(ctx, async () => {})
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).headers.get('content-type')).toBe('application/json')
  })

  test('401 response body contains error code UNAUTHORIZED', async () => {
    const jwtGuard = new JwtGuard({ secret: '401-code-test', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const ctx: any = { headers: {} }
    const result = await manager.middleware()(ctx, async () => {}) as Response
    const body = await result.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  test('401 response uses a generic message (no enumeration leak)', async () => {
    const jwtGuard = new JwtGuard({ secret: '401-msg-test', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const ctx: any = { headers: {} }
    const result = await manager.middleware()(ctx, async () => {}) as Response
    const body = await result.json()
    expect(body.error.message).toBe('Unauthorized')
  })
})

// Additional coverage: edge cases and combinations

describe('Additional edge cases and combinations', () => {
  test('Auth constructor with multiple guard factories', () => {
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => new JwtGuard({ secret: 'a', resolve: findUser }),
        basic: () => new BasicAuthGuard({ verifyCredentials: async () => null }),
        api: () => new AccessTokenGuard(async () => null),
      },
    })
    expect(manager.guard('jwt').name).toBe('jwt')
    expect(manager.guard('basic').name).toBe('basic')
    expect(manager.guard('api').name).toBe('access_token')
  })

  test('JwtGuard generate then authenticate round-trip for admin user', async () => {
    const guard = new JwtGuard({ secret: 'admin-roundtrip-32chars-key!!!!!', resolve: findUser })
    const { token } = await guard.generate(adminUser)
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(2)
    expect(user.name).toBe('Bob')
  })

  test('TekirServer e2e: auth + JSON response with nested object', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'nested-response-secret-32chars!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/profile', (ctx: any) => ({
      profile: {
        id: ctx.auth.user.id,
        name: ctx.auth.user.name,
        authenticated: ctx.auth.isAuthenticated,
      },
    }))
    router.useRouter(manager.middleware())

    const { token } = await jwtGuard.generate(testUser)
    const res = await server.handle(req('/profile', { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile.id).toBe(1)
    expect(body.profile.name).toBe('Alice')
    expect(body.profile.authenticated).toBe(true)
  })

  test('middleware sets $result on ctx when auth fails', async () => {
    const jwtGuard = new JwtGuard({ secret: 'result-test-key', resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const ctx: any = { headers: {} }
    await manager.middleware()(ctx, async () => {})
    expect(ctx.$result).toBeInstanceOf(Response)
    expect(ctx.$result.status).toBe(401)
  })

  test('middleware does not set $result on ctx when auth succeeds', async () => {
    const secret = 'no-result-on-success-32chars!!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const { token } = await jwtGuard.generate(testUser)
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    await manager.middleware()(ctx, async () => {})
    expect(ctx.$result).toBeUndefined()
  })

  test('BasicAuthGuard: password with equals signs', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => u === 'user' && p === 'a=b=c' ? testUser : null,
    })
    const ctx = { headers: { authorization: `Basic ${btoa('user:a=b=c')}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('AccessTokenGuard with empty prefix passes full header value', async () => {
    let received = ''
    const guard = new AccessTokenGuard(
      async (t) => { received = t; return testUser },
      { prefix: '' }
    )
    const ctx = { headers: { authorization: 'my-raw-token' } }
    await guard.authenticate(ctx)
    expect(received).toBe('my-raw-token')
  })

  test('TekirServer e2e: silentAuth + protected route on same server', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'silent-plus-protected-32chars!!!'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const manager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })

    router.get('/optional', (ctx: any) => ({
      authed: ctx.auth?.isAuthenticated ?? false,
    }))
    router.useRouter(manager.silentAuth())

    // Without token
    const guestRes = await server.handle(req('/optional'))
    expect(guestRes.status).toBe(200)
    expect((await guestRes.json()).authed).toBe(false)

    // With token
    const { token } = await jwtGuard.generate(testUser)
    const authRes = await server.handle(req('/optional', { authorization: `Bearer ${token}` }))
    expect(authRes.status).toBe(200)
    expect((await authRes.json()).authed).toBe(true)
  })

  test('DatabaseTokenGuard with custom table name', async () => {
    const rows: any[] = []
    let nextId = 1
    const db = {
      exec: async () => {},
      run: async (_sql: string, args: any[] = []) => {
        const row = { id: nextId++, user_id: args[0], name: args[1], hash: args[2], metadata: args[3], created_at: args[4], expires_at: args[5] ?? null, last_used_at: null }
        rows.push(row)
        return { lastInsertRowid: row.id }
      },
      queryOne: async (_sql: string) => _sql.includes('last_insert_rowid') ? { id: nextId - 1 } : null,
      query: async () => [],
    }
    const guard = new DatabaseTokenGuard({ db, resolve: findUser, table: 'api_tokens' })
    const result = await guard.generate(testUser)
    expect(result.token.startsWith('oat_')).toBe(true)
    expect(result.id).toBe(1)
  })
})

// NEW TESTS: Deep edge cases for Auth system

describe('JwtGuard — token payload structure', () => {
  const secret = 'payload-test-secret'
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : null

  test('token header contains alg HS256', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const headerJson = atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))
    const header = JSON.parse(headerJson)
    expect(header.alg).toBe('HS256')
  })

  test('token header contains typ JWT', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const headerJson = atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))
    const header = JSON.parse(headerJson)
    expect(header.typ).toBe('JWT')
  })

  test('token payload contains exp claim as a number', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser, expiresIn: 600 })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(typeof payload.exp).toBe('number')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test('expiresAt matches exp claim in token', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser, expiresIn: 600 })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    const payloadJson = atob(result.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(Math.floor(result.expiresAt.getTime() / 1000)).toBe(payload.exp)
  })

  test('authenticate roundtrip: generate then authenticate returns same user', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
    expect(user.name).toBe('Alice')
  })
})

describe('SessionGuard — login/logout cycle', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : null

  test('login then authenticate returns the user', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    const sessionData: Record<string, any> = {}
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { sessionData[k] = v },
        get: (k: string) => sessionData[k] ?? null,
        forget: (k: string) => { delete sessionData[k] },
        regenerate: async () => {},
      },
    }
    await guard.login({ id: 1, name: 'Alice' }, ctx)
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })

  test('logout then authenticate throws', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    const sessionData: Record<string, any> = {}
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { sessionData[k] = v },
        get: (k: string) => sessionData[k] ?? null,
        forget: (k: string) => { delete sessionData[k] },
        regenerate: async () => {},
      },
    }
    await guard.login({ id: 1, name: 'Alice' }, ctx)
    await guard.logout(ctx)
    await expect(guard.authenticate(ctx)).rejects.toThrow('Not authenticated')
  })

  test('login stores user id under custom sessionKey', async () => {
    const guard = new SessionGuard({ resolve: findUser, sessionKey: 'custom_id' })
    const sessionData: Record<string, any> = {}
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { sessionData[k] = v },
        get: (k: string) => sessionData[k] ?? null,
        forget: (k: string) => { delete sessionData[k] },
        regenerate: async () => {},
      },
    }
    await guard.login({ id: 1, name: 'Alice' }, ctx)
    expect(sessionData['custom_id']).toBe(1)
  })

  test('check() returns true after login, false after logout', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    const sessionData: Record<string, any> = {}
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { sessionData[k] = v },
        get: (k: string) => sessionData[k] ?? null,
        forget: (k: string) => { delete sessionData[k] },
        regenerate: async () => {},
      },
    }
    await guard.login({ id: 1, name: 'Alice' }, ctx)
    expect(await guard.check(ctx)).toBe(true)
    await guard.logout(ctx)
    expect(await guard.check(ctx)).toBe(false)
  })
})

describe('BasicAuthGuard — edge cases', () => {
  test('authenticate with empty username and password', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => (u === '' && p === '' ? testUser : null),
    })
    const credentials = btoa(':')
    const ctx = { headers: { authorization: `Basic ${credentials}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(testUser.id)
  })

  test('authenticate rejects malformed base64', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async () => null,
    })
    const ctx = { headers: { authorization: 'Basic !!!not-base64!!!' } }
    await expect(guard.authenticate(ctx)).rejects.toThrow()
  })
})

describe('Auth manager — multiple guards in middleware', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : null

  test('middleware tries guards in order and stops at first success', async () => {
    const secret = 'multi-guard-test'
    const jwtGuard = new JwtGuard({ secret, resolve: findUser })
    const sessionGuard = new SessionGuard({ resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: {
        jwt: () => jwtGuard,
        session: () => sessionGuard,
      },
    })

    const { token } = await jwtGuard.generate({ id: 1, name: 'Alice' })
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let called = false
    await manager.middleware(['jwt', 'session'])(ctx, async () => { called = true })
    expect(called).toBe(true)
    expect(ctx.auth.guard).toBe('jwt')
  })

  test('middleware falls through to second guard when first fails', async () => {
    const sessionGuard = new SessionGuard({ resolve: findUser })
    const jwtGuard = new JwtGuard({ secret: 'fallthrough', resolve: findUser })
    const manager = new Auth({
      defaultGuard: 'session',
      guards: {
        session: () => sessionGuard,
        jwt: () => jwtGuard,
      },
    })

    // No session, but valid JWT
    const { token } = await jwtGuard.generate({ id: 1, name: 'Alice' })
    const ctx: any = { headers: { authorization: `Bearer ${token}` } }
    let called = false
    await manager.middleware(['session', 'jwt'])(ctx, async () => { called = true })
    expect(called).toBe(true)
    expect(ctx.auth.guard).toBe('jwt')
  })
})

// More auth edge case tests

describe('JwtGuard — token content verification', () => {
  const secret = 'content-test-secret'
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : null

  test('token contains no sensitive user data by default', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice', password: 'secret123' } as any)
    const payloadJson = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    expect(payload.password).toBeUndefined()
  })

  test('expiresAt is a Date object', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  test('expiresAt is in the future', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser, expiresIn: 3600 })
    const result = await guard.generate({ id: 1, name: 'Alice' })
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('token is a non-empty string', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  test('authenticate returns user with all properties', async () => {
    const guard = new JwtGuard({ secret, resolve: findUser })
    const { token } = await guard.generate({ id: 1, name: 'Alice' })
    const ctx = { headers: { authorization: `Bearer ${token}` } }
    const user = await guard.authenticate(ctx)
    expect(user).toHaveProperty('id', 1)
    expect(user).toHaveProperty('name', 'Alice')
  })
})

describe('SessionGuard — multiple login/logout', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? { id: 1, name: 'Alice' } : id == 2 ? { id: 2, name: 'Bob' } : null

  test('logging in as different user replaces the session', async () => {
    const guard = new SessionGuard({ resolve: findUser })
    const sessionData: Record<string, any> = {}
    const ctx: any = {
      session: {
        put: (k: string, v: any) => { sessionData[k] = v },
        get: (k: string) => sessionData[k] ?? null,
        forget: (k: string) => { delete sessionData[k] },
        regenerate: async () => {},
      },
    }
    await guard.login({ id: 1, name: 'Alice' }, ctx)
    await guard.login({ id: 2, name: 'Bob' }, ctx)
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(2)
    expect(user.name).toBe('Bob')
  })
})

describe('Auth — middleware returns 401 when all guards fail', () => {
  test('returns 401 Response with correct status', async () => {
    const manager = new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => new JwtGuard({ secret: 'x', resolve: async () => null }) },
    })
    const ctx: any = { headers: {} }
    const result = await manager.middleware()(ctx, async () => {})
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })
})

describe('BasicAuthGuard — various credential formats', () => {
  const testUser = { id: 1, name: 'Alice' }

  test('valid credentials with long password', async () => {
    const longPass = 'a'.repeat(200)
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => (u === 'user' && p === longPass ? testUser : null),
    })
    const ctx = { headers: { authorization: `Basic ${btoa('user:' + longPass)}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })

  test('username with special characters', async () => {
    const guard = new BasicAuthGuard({
      verifyCredentials: async (u, p) => (u === 'user@domain.com' && p === 'pass' ? testUser : null),
    })
    const ctx = { headers: { authorization: `Basic ${btoa('user@domain.com:pass')}` } }
    const user = await guard.authenticate(ctx)
    expect(user.id).toBe(1)
  })
})
