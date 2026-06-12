import { test, expect, describe } from 'bun:test'
import { App, setContainer } from '@tekir/core'
import { Authorize, AuthorizationResponse, BasePolicy, ForbiddenException, can } from '../src/index'

// Minimal DI container so can() middleware can resolve 'authorize'.
const containerAuthorize = new Authorize()
const app = new App()
app.instance('authorize', containerAuthorize)
setContainer(app, { getRouter: () => ({}) } as any, { info: () => {} } as any)

const admin = { id: 1, role: 'admin' }
const member = { id: 2, role: 'member' }

// ═══════════════════════════════════════════════════════════
// before-hook is per-ability, never global
// ═══════════════════════════════════════════════════════════

describe('before-hook — per-ability semantics', () => {
  test('hook denying one ability does not deny others', async () => {
    const auth = new Authorize()
    auth.define('read', () => true)
    auth.define('delete', () => true)
    // Only deny "delete"; defer on everything else.
    auth.before((_user, ability) => (ability === 'delete' ? false : undefined))

    expect(await auth.allows('read', member)).toBe(true)   // unaffected
    expect(await auth.allows('delete', member)).toBe(false) // explicitly denied
  })

  test('hook allowing one ability does not allow others', async () => {
    const auth = new Authorize()
    auth.define('read', () => false)
    auth.define('write', () => false)
    auth.before((_user, ability) => (ability === 'read' ? true : undefined))

    expect(await auth.allows('read', member)).toBe(true)  // granted by hook
    expect(await auth.allows('write', member)).toBe(false) // still denied
  })

  test('admin-bypass hook only short-circuits the checked ability', async () => {
    const auth = new Authorize()
    auth.define('edit', (u: any) => u.id === 999)
    auth.before((u: any) => (u.role === 'admin' ? true : undefined))

    expect(await auth.allows('edit', admin)).toBe(true)
    expect(await auth.allows('edit', member)).toBe(false)
  })

  test('non-boolean hook result is ignored (defers to ability), not treated as deny', async () => {
    const auth = new Authorize()
    auth.define('read', () => true)
    const origWarn = console.warn
    console.warn = () => {}
    try {
      // Returns a truthy object — must be ignored, not coerced to deny.
      auth.before(() => ({ sneaky: true }) as any)
      expect(await auth.allows('read', member)).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })
})

// ═══════════════════════════════════════════════════════════
// policy before-hooks stay per-method
// ═══════════════════════════════════════════════════════════

describe('policy before-hook — per-method', () => {
  class PostPolicy extends BasePolicy {
    view() { return true }
    delete() { return true }
  }

  test('denying one policy method leaves others intact', async () => {
    const auth = new Authorize()
    auth.registerPolicy('post', PostPolicy)
    auth.before((_user, method) => (method === 'delete' ? false : undefined))

    expect(await auth.policy('post').allows('view', member)).toBe(true)
    expect(await auth.policy('post').allows('delete', member)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// can() middleware authentication checks
// ═══════════════════════════════════════════════════════════

describe('can() middleware — authentication', () => {
  containerAuthorize.define('do-thing', () => true)

  test('rejects when no user', async () => {
    const mw = can('do-thing')
    await expect(mw({ auth: {} } as any, async () => {})).rejects.toThrow('Unauthenticated')
  })

  test('rejects when user present but isAuthenticated is false', async () => {
    const mw = can('do-thing')
    const ctx: any = { auth: { user: member, isAuthenticated: false } }
    await expect(mw(ctx, async () => {})).rejects.toThrow('Unauthenticated')
  })

  test('allows when authenticated and ability passes', async () => {
    const mw = can('do-thing')
    let nexted = false
    const ctx: any = { auth: { user: member, isAuthenticated: true } }
    await mw(ctx, async () => { nexted = true })
    expect(nexted).toBe(true)
  })

  test('allows when isAuthenticated is omitted but user is present (backward compat)', async () => {
    const mw = can('do-thing')
    let nexted = false
    const ctx: any = { auth: { user: member } }
    await mw(ctx, async () => { nexted = true })
    expect(nexted).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════
// can() lazy resolver — ownership / IDOR
// ═══════════════════════════════════════════════════════════

describe('can() middleware — lazy resource resolver (IDOR)', () => {
  // Ownership ability: a member may only edit their own resource.
  containerAuthorize.define('edit-post', (u: any, post: any) => post && post.ownerId === u.id)

  test('allows owner via per-request resolved resource', async () => {
    const mw = can('edit-post', (ctx: any) => [ctx.post])
    let nexted = false
    const ctx: any = { auth: { user: { id: 2 }, isAuthenticated: true }, post: { id: 10, ownerId: 2 } }
    await mw(ctx, async () => { nexted = true })
    expect(nexted).toBe(true)
  })

  test('denies non-owner even though role check alone would pass (IDOR closed)', async () => {
    const mw = can('edit-post', (ctx: any) => [ctx.post])
    const ctx: any = { auth: { user: { id: 2 }, isAuthenticated: true }, post: { id: 11, ownerId: 99 } }
    await expect(mw(ctx, async () => {})).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// normalizeResult fail-closed
// ═══════════════════════════════════════════════════════════

describe('ability results — fail closed', () => {
  test('truthy non-boolean ability result denies (with warning)', async () => {
    const auth = new Authorize()
    auth.define('weird', () => 1 as any)
    const origWarn = console.warn
    const warnings: string[] = []
    console.warn = (m: any) => warnings.push(String(m))
    try {
      expect(await auth.allows('weird', member)).toBe(false)
      expect(warnings.some((w) => w.includes('non-boolean'))).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })

  test('explicit AuthorizationResponse.allow still grants', async () => {
    const auth = new Authorize()
    auth.define('ok', () => AuthorizationResponse.allow())
    expect(await auth.allows('ok', member)).toBe(true)
  })
})
