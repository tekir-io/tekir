import { beforeEach, describe, expect, test } from 'bun:test'
import { App, setContainer } from '@tekir/core'
import { Auth } from '../src/auth_manager'
import { attachAuth, authenticate, guest, silentAuth } from '../src/middleware'
import { resolveAuthSubject } from '../src/resolve_auth'
import type { AuthGuard } from '../src/types'

function guard(overrides: Partial<AuthGuard> = {}): AuthGuard {
  return {
    name: 'test',
    authenticate: async () => ({ id: 1, name: 'Ali' }),
    ...overrides,
  }
}

let app: App
beforeEach(() => {
  app = new App()
  setContainer(app, {} as any, {} as any)
})

describe('standalone auth middleware', () => {
  test('tries guards in order and attaches the successful auth state', async () => {
    const attempted: string[] = []
    const auth = new Auth({
      defaultGuard: 'first',
      guards: {
        first: () => guard({ authenticate: async () => { attempted.push('first'); throw new Error('bad token') } }),
        second: () => guard({ authenticate: async () => { attempted.push('second'); return { id: 2 } } }),
      },
    })
    app.instance('auth', auth)
    const ctx: any = {}
    let nextCalled = false
    await authenticate(['first', 'second'])(ctx, async () => { nextCalled = true })
    expect(attempted).toEqual(['first', 'second'])
    expect(nextCalled).toBe(true)
    expect(ctx.auth).toMatchObject({ user: { id: 2 }, guard: 'second', isAuthenticated: true })
  })

  test('returns a generic 401 without exposing guard failure details', async () => {
    app.instance('auth', new Auth({
      defaultGuard: 'jwt',
      guards: { jwt: () => guard({ authenticate: async () => { throw new Error('user alice does not exist') } }) },
    }))
    const ctx: any = {}
    const response = await authenticate()(ctx, async () => {})
    expect(response?.status).toBe(401)
    expect(ctx.$result).toBe(response)
    const body = await response!.text()
    expect(body).toContain('Unauthorized')
    expect(body).not.toContain('alice')
  })

  test('attachAuth supports login, generate, list, revoke, and logout on one stable state object', async () => {
    const calls: string[] = []
    app.instance('auth', new Auth({
      defaultGuard: 'token',
      guards: {
        token: () => guard({
          login: async () => { calls.push('login') },
          logout: async () => { calls.push('logout') },
          generate: async (user: any) => `token-${user.id}`,
          list: async (id: unknown) => [`listed-${id}`],
          revokeAll: async (id: unknown) => { calls.push(`revoke-${id}`) },
        } as any),
      },
    }))
    const ctx: any = {}
    await attachAuth()(ctx, async () => {})
    const state = ctx.auth
    expect(state.isAuthenticated).toBe(false)
    await state.login({ id: 7 })
    expect(ctx.auth).toBe(state)
    expect(await state.generate()).toBe('token-7')
    expect(await state.list()).toEqual(['listed-7'])
    await state.revokeAll()
    await state.logout()
    expect(state.isAuthenticated).toBe(false)
    expect(calls).toEqual(['login', 'revoke-7', 'logout'])
  })

  test('silentAuth always continues with an empty state after failures', async () => {
    app.instance('auth', new Auth({
      defaultGuard: 'bad',
      guards: { bad: () => guard({ authenticate: async () => { throw new Error('invalid') } }) },
    }))
    const ctx: any = {}
    let nextCalled = false
    await silentAuth()(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ctx.auth.isAuthenticated).toBe(false)
  })

  test('guest blocks authenticated requests and does not run next', async () => {
    app.instance('auth', new Auth({
      defaultGuard: 'session',
      guards: { session: () => guard({ check: async () => true }) },
    }))
    let nextCalled = false
    const response = await guest()({}, async () => { nextCalled = true })
    expect(response?.status).toBe(403)
    expect(nextCalled).toBe(false)
  })
})

describe('auth subject resolver', () => {
  test('prefers an explicit resolver', async () => {
    const resolve = async (id: string | number) => ({ id })
    expect(resolveAuthSubject('jwt', { resolve })).toBe(resolve)
  })

  test('adapts a model find method', async () => {
    const resolver = resolveAuthSubject('jwt', { model: { find: async (id: unknown) => ({ id }) } as any })
    expect(await resolver(9)).toEqual({ id: 9 })
  })

  test('fails loudly when neither resolver nor model is configured', () => {
    expect(() => resolveAuthSubject('jwt', {})).toThrow("Either 'resolve' or 'model'")
  })
})
