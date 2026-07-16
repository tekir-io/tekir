import { test, expect, describe, afterEach } from 'bun:test'
import { session } from '../src/middleware'
import { MemorySessionStore } from '../src/stores/memory'
import { Session } from '../src/session'

// Runs the session middleware against a Response result and returns the
// emitted Set-Cookie header (or undefined).
async function runWithResponse(
  config: Parameters<typeof session>[0],
  handler: (ctx: any) => void | Promise<void>,
  headers: Record<string, string> = {},
): Promise<{ setCookie: string | null; ctx: any }> {
  const mw = session(config)
  const ctx: any = { headers }
  await mw(ctx, async () => {
    await handler(ctx)
    ctx.$result = new Response('ok')
  })
  return { setCookie: ctx.$result?.headers?.get('Set-Cookie') ?? null, ctx }
}

const origEnv = (globalThis as any).process?.env?.NODE_ENV

afterEach(() => {
  if (origEnv === undefined) delete (globalThis as any).process.env.NODE_ENV
  else (globalThis as any).process.env.NODE_ENV = origEnv
})

describe('session cookie — secure-by-default flags', () => {
  test('emits HttpOnly, SameSite and Secure by default', async () => {
    delete (globalThis as any).process.env.NODE_ENV
    const { setCookie } = await runWithResponse({ store: new MemorySessionStore() }, (ctx) => {
      ctx.session.put('k', 'v')
    })
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect(setCookie).toContain('Secure')
  })

  test('production defaults to Secure', async () => {
    (globalThis as any).process.env.NODE_ENV = 'production'
    const { setCookie } = await runWithResponse({ store: new MemorySessionStore() }, (ctx) => {
      ctx.session.put('k', 'v')
    })
    expect(setCookie).toContain('Secure')
  })

  test('caller can explicitly disable Secure', async () => {
    (globalThis as any).process.env.NODE_ENV = 'production'
    const { setCookie } = await runWithResponse(
      { store: new MemorySessionStore(), cookie: { secure: false } },
      (ctx) => ctx.session.put('k', 'v'),
    )
    expect(setCookie).not.toContain('Secure')
    // HttpOnly stays on
    expect(setCookie).toContain('HttpOnly')
  })

  test('caller can tighten SameSite to strict', async () => {
    const { setCookie } = await runWithResponse(
      { store: new MemorySessionStore(), cookie: { sameSite: 'strict' } },
      (ctx) => ctx.session.put('k', 'v'),
    )
    expect(setCookie).toContain('SameSite=strict')
  })
})

describe('session cookie — configuration validation', () => {
  test('includes configured Domain on a Response', async () => {
    const { setCookie } = await runWithResponse(
      { store: new MemorySessionStore(), cookie: { domain: 'example.com' } },
      (ctx) => ctx.session.put('k', 'v'),
    )
    expect(setCookie).toContain('Domain=example.com')
  })

  test('rejects cookie attribute injection', () => {
    expect(() => session({ cookie: { path: '/; HttpOnly=false' } })).toThrow('Invalid cookie path')
    expect(() => session({ cookieName: 'sid\r\nX-Evil' })).toThrow('Invalid cookie name')
  })

  test('rejects insecure SameSite=None and invalid TTLs', () => {
    expect(() => session({ cookie: { sameSite: 'none', secure: false } })).toThrow('must also be Secure')
    expect(() => session({ age: 0 })).toThrow('positive number')
    expect(() => session({ age: Number.NaN })).toThrow('positive number')
  })
})

describe('session cookie — Set-Cookie always emitted', () => {
  test('writes Set-Cookie on the Response', async () => {
    const { setCookie } = await runWithResponse({ store: new MemorySessionStore() }, (ctx) => {
      ctx.session.put('user', 1)
    })
    expect(setCookie).toContain('tekir_session=')
  })

  test('regenerated id reaches the client via Response', async () => {
    let newId = ''
    const { setCookie } = await runWithResponse({ store: new MemorySessionStore() }, async (ctx) => {
      newId = await ctx.session.regenerate()
      ctx.session.put('user', 1)
    })
    expect(newId).toBeTruthy()
    expect(setCookie).toContain(`tekir_session=${newId}`)
  })

  test('falls back to ctx.response.cookie when no Response result', async () => {
    const calls: any[] = []
    const mw = session({ store: new MemorySessionStore() })
    const ctx: any = { headers: {}, response: { cookie: (name: string, val: string, opts: any) => calls.push({ name, val, opts }) } }
    await mw(ctx, async () => {
      ctx.session.put('user', 1)
    })
    expect(calls.length).toBe(1)
    expect(calls[0].name).toBe('tekir_session')
  })

  test('regenerated id is never silently dropped (stashed when no direct sink)', async () => {
    const mw = session({ store: new MemorySessionStore() })
    const ctx: any = { headers: {} } // no $result, no response sink
    let newId = ''
    await mw(ctx, async () => {
      newId = await ctx.session.regenerate()
      ctx.session.put('user', 1)
    })
    expect(Array.isArray(ctx.$setCookies)).toBe(true)
    expect(ctx.$setCookies[0]).toContain(`tekir_session=${newId}`)
  })

  test('stashes cookie on ctx for an outer adapter when no direct sink', async () => {
    // A fresh (non-regenerated) id with no Response should still be captured
    // so an outer adapter can flush it, without throwing.
    const mw = session({ store: new MemorySessionStore() })
    const ctx: any = { headers: { cookie: 'tekir_session=existing-id' } }
    await mw(ctx, async () => {
      ctx.session.put('user', 1)
    })
    expect(Array.isArray(ctx.$setCookies)).toBe(true)
    expect(ctx.$setCookies[0]).toContain('tekir_session=existing-id')
  })
})

describe('Session — prototype pollution guard', () => {
  const store = new MemorySessionStore({ sweepIntervalMs: 0 })

  test('put rejects __proto__ and constructor', () => {
    const s = new Session('id', store, 60)
    expect(() => s.put('__proto__', { polluted: true })).toThrow('Reserved session key')
    expect(() => s.put('constructor', {})).toThrow('Reserved session key')
    expect(({} as any).polluted).toBeUndefined()
  })

  test('flash rejects reserved keys', () => {
    const s = new Session('id', store, 60)
    expect(() => s.flash('prototype', {})).toThrow('Reserved session key')
  })

  test('normal keys still work', () => {
    const s = new Session('id', store, 60)
    s.put('user_id', 5)
    expect(s.get<number>('user_id')).toBe(5)
  })
})

describe('MemorySessionStore — eviction', () => {
  test('sweep purges expired entries', async () => {
    const store = new MemorySessionStore({ sweepIntervalMs: 0 })
    await store.write('a', { v: 1 }, -1) // already expired
    await store.write('b', { v: 2 }, 60)
    store.sweep()
    expect(await store.read('a')).toBeNull()
    expect(await store.read('b')).not.toBeNull()
    store.stop()
  })

  test('enforces maxEntries cap', async () => {
    const store = new MemorySessionStore({ sweepIntervalMs: 0, maxEntries: 3 })
    for (let i = 0; i < 10; i++) await store.write(`s${i}`, { i }, 60)
    expect((store as any).data.size).toBeLessThanOrEqual(3)
    store.stop()
  })
})

describe('session TTL sliding', () => {
  test('touches store on non-dirty request for existing session', async () => {
    const store = new MemorySessionStore({ sweepIntervalMs: 0 })
    // Seed an existing session
    await store.write('existing-id', { data: { user: 1 }, flash: {} }, 1)
    let touched = false
    const orig = store.touch.bind(store)
    ;(store as any).touch = async (id: string, ttl: number) => { touched = true; return orig(id, ttl) }

    const mw = session({ store, age: 100 })
    const ctx: any = { headers: { cookie: 'tekir_session=existing-id' } }
    await mw(ctx, async () => { /* read-only, no writes */ })
    expect(touched).toBe(true)
    store.stop()
  })
})
