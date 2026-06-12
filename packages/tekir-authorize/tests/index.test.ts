import { test, expect, describe } from 'bun:test'
import { App, setContainer } from '@tekir/core'
import {
  Authorize,
  BasePolicy,
  PolicyProxy,
  AuthorizationResponse,
  ForbiddenException,
  AuthorizeProvider,
  can,
} from '../src/index'

// Set up a minimal DI container so can() middleware can resolve 'authorize'
const testAuthorize = new Authorize()
const _testApp = new App()
_testApp.instance('authorize', testAuthorize)
setContainer(_testApp, { getRouter: () => ({}) } as any, { info: () => {} } as any)

const user = { id: 1, role: 'user', name: 'Alice' }
const adminUser = { id: 2, role: 'admin', name: 'Bob' }
const post = { id: 10, userId: 1, title: 'Hello' }
const otherPost = { id: 11, userId: 99, title: 'Other' }

// Fresh Authorize instance for each describe block to avoid cross-test pollution
function freshAuthorize() {
  return new Authorize()
}

// ForbiddenException

describe('ForbiddenException', () => {
  test('is an instance of Error', () => {
    const err = new ForbiddenException()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ForbiddenException)
  })

  test('has statusCode 403', () => {
    const err = new ForbiddenException()
    expect(err.statusCode).toBe(403)
  })

  test('has code E_AUTHORIZATION_FAILURE', () => {
    const err = new ForbiddenException()
    expect(err.code).toBe('AUTHORIZATION_FAILURE')
  })

  test('has default message "Authorization failed"', () => {
    const err = new ForbiddenException()
    expect(err.message).toBe('Authorization failed')
  })

  test('accepts a custom message', () => {
    const err = new ForbiddenException('You shall not pass')
    expect(err.message).toBe('You shall not pass')
  })

  test('is instance of Error', () => {
    const err = new ForbiddenException()
    expect(err).toBeInstanceOf(Error)
  })
})

// AuthorizationResponse

describe('AuthorizationResponse', () => {
  test('allow() returns an allowed response', () => {
    const resp = AuthorizationResponse.allow()
    expect(resp.allowed).toBe(true)
    expect(resp.message).toBeUndefined()
  })

  test('deny() returns a denied response with a default message', () => {
    const resp = AuthorizationResponse.deny()
    expect(resp.allowed).toBe(false)
    expect(resp.message).toBe('Authorization failed')
  })

  test('deny() accepts a custom message', () => {
    const resp = AuthorizationResponse.deny('Not your post')
    expect(resp.allowed).toBe(false)
    expect(resp.message).toBe('Not your post')
  })

  test('toBoolean() mirrors the allowed property', () => {
    expect(AuthorizationResponse.allow().toBoolean()).toBe(true)
    expect(AuthorizationResponse.deny().toBoolean()).toBe(false)
  })
})

// Authorize — define() / allows() / denies()

describe('Authorize: define / allows / denies', () => {
  test('define() registers an ability and allows() returns true when granted', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    expect(await gate.allows('editPost', user, post)).toBe(true)
  })

  test('allows() returns false when the ability callback returns false', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    expect(await gate.allows('editPost', user, otherPost)).toBe(false)
  })

  test('denies() is the inverse of allows()', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    expect(await gate.denies('editPost', user, post)).toBe(false)
    expect(await gate.denies('editPost', user, otherPost)).toBe(true)
  })

  test('allows() returns false for an undefined ability', async () => {
    const gate = freshAuthorize()
    expect(await gate.allows('nonexistent', user)).toBe(false)
  })

  test('define() supports async callbacks', async () => {
    const gate = freshAuthorize()
    gate.define('asyncAbility', async (u: any) => {
      await Promise.resolve()
      return u.role === 'admin'
    })
    expect(await gate.allows('asyncAbility', adminUser)).toBe(true)
    expect(await gate.allows('asyncAbility', user)).toBe(false)
  })

  test('define() returns the Authorize instance for chaining', () => {
    const gate = freshAuthorize()
    const result = gate.define('x', () => true)
    expect(result).toBe(gate)
  })

  test('ability callback returning AuthorizationResponse.allow() is treated as allowed', async () => {
    const gate = freshAuthorize()
    gate.define('resp', () => AuthorizationResponse.allow())
    expect(await gate.allows('resp', user)).toBe(true)
  })

  test('ability callback returning AuthorizationResponse.deny() is treated as denied', async () => {
    const gate = freshAuthorize()
    gate.define('resp', () => AuthorizationResponse.deny('nope'))
    expect(await gate.allows('resp', user)).toBe(false)
  })

  test('ability callback returning undefined is treated as denied', async () => {
    const gate = freshAuthorize()
    gate.define('undef', () => undefined)
    expect(await gate.allows('undef', user)).toBe(false)
  })

  test('ability callback returning null is treated as denied', async () => {
    const gate = freshAuthorize()
    gate.define('nil', () => null)
    expect(await gate.allows('nil', user)).toBe(false)
  })
})

// Authorize — authorize() throws ForbiddenException on deny

describe('Authorize: authorize()', () => {
  test('authorize() resolves without throwing when ability is granted', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    await expect(gate.authorize('editPost', user, post)).resolves.toBeUndefined()
  })

  test('authorize() throws ForbiddenException when ability is denied', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    await expect(gate.authorize('editPost', user, otherPost)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('authorize() throws ForbiddenException for an undefined ability', async () => {
    const gate = freshAuthorize()
    await expect(gate.authorize('ghost', user)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('ForbiddenException thrown by authorize() has status 403', async () => {
    const gate = freshAuthorize()
    gate.define('deny', () => false)
    try {
      await gate.authorize('deny', user)
      expect(true).toBe(false) // should not reach here
    } catch (err: any) {
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe('AUTHORIZATION_FAILURE')
    }
  })

  test('authorize() uses the deny message from AuthorizationResponse', async () => {
    const gate = freshAuthorize()
    gate.define('withMsg', () => AuthorizationResponse.deny('Custom reason'))
    try {
      await gate.authorize('withMsg', user)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.message).toBe('Custom reason')
    }
  })
})

// Authorize — before() hooks

describe('Authorize: before() hooks', () => {
  test('before hook returning true short-circuits and grants access', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    gate.before((u: any) => u.role === 'admin' ? true : undefined)
    // adminUser would normally fail because adminUser.id (2) !== otherPost.userId (99)
    expect(await gate.allows('editPost', adminUser, otherPost)).toBe(true)
  })

  test('before hook returning undefined passes through to the ability', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', (u: any, p: any) => u.id === p.userId)
    gate.before((u: any) => (u.role === 'admin' ? true : undefined))
    // regular user — before hook returns undefined, so ability is checked normally
    expect(await gate.allows('editPost', user, post)).toBe(true)
    expect(await gate.allows('editPost', user, otherPost)).toBe(false)
  })

  test('before hook returning false short-circuits and denies access', async () => {
    const gate = freshAuthorize()
    gate.define('editPost', () => true) // would normally allow
    gate.before(() => false)
    expect(await gate.allows('editPost', user, post)).toBe(false)
  })

  test('multiple before hooks: first non-undefined result wins', async () => {
    const gate = freshAuthorize()
    gate.define('x', () => false)
    gate.before(() => undefined)       // passes through
    gate.before(() => true)            // grants
    gate.before(() => false)           // never reached
    expect(await gate.allows('x', user)).toBe(true)
  })

  test('before() returns the Authorize instance for chaining', () => {
    const gate = freshAuthorize()
    const result = gate.before(() => undefined)
    expect(result).toBe(gate)
  })

  test('runBeforeHooks() returns undefined when all hooks return undefined', async () => {
    const gate = freshAuthorize()
    gate.before(() => undefined)
    const result = await gate.runBeforeHooks(user, 'x')
    expect(result).toBeUndefined()
  })

  test('runBeforeHooks() returns first non-undefined hook result', async () => {
    const gate = freshAuthorize()
    gate.before(() => undefined)
    gate.before(() => true)
    const result = await gate.runBeforeHooks(user, 'x')
    expect(result).toBe(true)
  })
})

// BasePolicy — subclass

describe('BasePolicy', () => {
  class PostPolicy extends BasePolicy {
    view(u: any, p: any) { return true }
    edit(u: any, p: any) { return u.id === p.userId }
    delete(u: any, p: any) { return u.role === 'admin' }
  }

  test('can be subclassed', () => {
    const policy = new PostPolicy()
    expect(policy).toBeInstanceOf(BasePolicy)
    expect(policy).toBeInstanceOf(PostPolicy)
  })

  test('subclass methods are accessible', () => {
    const policy = new PostPolicy()
    expect(typeof policy.view).toBe('function')
    expect(typeof policy.edit).toBe('function')
    expect(typeof policy.delete).toBe('function')
  })
})

// registerPolicy() + policy().allows() / policy().denies() / policy().authorize()

describe('Authorize: registerPolicy() and policy()', () => {
  class PostPolicy extends BasePolicy {
    view(_u: any, _p: any) { return true }
    edit(u: any, p: any) { return u.id === p.userId }
    delete(u: any, p: any) { return u.role === 'admin' }
  }

  test('registerPolicy() registers and policy() returns a PolicyProxy', () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    const proxy = gate.policy('post')
    expect(proxy).toBeInstanceOf(PolicyProxy)
  })

  test('policy().allows() returns true when policy method grants', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    expect(await gate.policy('post').allows('edit', user, post)).toBe(true)
  })

  test('policy().allows() returns false when policy method denies', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    expect(await gate.policy('post').allows('edit', user, otherPost)).toBe(false)
  })

  test('policy().denies() is the inverse of allows()', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    expect(await gate.policy('post').denies('delete', user, post)).toBe(true)
    expect(await gate.policy('post').denies('delete', adminUser, post)).toBe(false)
  })

  test('policy().authorize() resolves when access is granted', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    await expect(gate.policy('post').authorize('view', user, post)).resolves.toBeUndefined()
  })

  test('policy().authorize() throws ForbiddenException when denied', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    await expect(gate.policy('post').authorize('delete', user, post)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('policy() throws when resource has no registered policy', () => {
    const gate = freshAuthorize()
    expect(() => gate.policy('unregistered')).toThrow('No policy registered for resource "unregistered"')
  })

  test('policy() returns cached PolicyProxy on repeated calls', () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    const first = gate.policy('post')
    const second = gate.policy('post')
    expect(first).toBe(second)
  })

  test('registerPolicy() invalidates cache when re-registered', () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    const first = gate.policy('post')
    gate.registerPolicy('post', PostPolicy) // re-register
    const second = gate.policy('post')
    expect(first).not.toBe(second)
  })

  test('registerPolicy() returns the Authorize instance for chaining', () => {
    const gate = freshAuthorize()
    const result = gate.registerPolicy('post', PostPolicy)
    expect(result).toBe(gate)
  })

  test('policy respects global before-hooks (admin override)', async () => {
    const gate = freshAuthorize()
    gate.before((u: any) => u.role === 'admin' ? true : undefined)
    gate.registerPolicy('post', PostPolicy)
    // adminUser.id (2) !== post.userId (1) but before hook grants access
    expect(await gate.policy('post').allows('edit', adminUser, post)).toBe(true)
  })

  test('policy method that is not defined returns deny', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('post', PostPolicy)
    expect(await gate.policy('post').allows('nonexistent', user, post)).toBe(false)
  })
})

// PolicyProxy: direct instantiation

describe('PolicyProxy', () => {
  class SimplePolicy extends BasePolicy {
    canDo(u: any) { return u.id === 1 }
  }

  test('can be instantiated directly', () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new SimplePolicy(), gate)
    expect(proxy).toBeInstanceOf(PolicyProxy)
  })

  test('allows() delegates to the policy method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new SimplePolicy(), gate)
    expect(await proxy.allows('canDo', user)).toBe(true)
    expect(await proxy.allows('canDo', adminUser)).toBe(false)
  })

  test('denies() is the inverse of allows()', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new SimplePolicy(), gate)
    expect(await proxy.denies('canDo', user)).toBe(false)
    expect(await proxy.denies('canDo', adminUser)).toBe(true)
  })

  test('authorize() resolves when allowed', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new SimplePolicy(), gate)
    await expect(proxy.authorize('canDo', user)).resolves.toBeUndefined()
  })

  test('authorize() throws ForbiddenException when denied', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new SimplePolicy(), gate)
    await expect(proxy.authorize('canDo', adminUser)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

// can() middleware

describe('can() middleware', () => {
  test('throws ForbiddenException("Unauthenticated") when ctx.auth.user is absent', async () => {
    const mw = can('editPost')
    const ctx: any = {}
    await expect(mw(ctx, async () => {})).rejects.toMatchObject({
      message: 'Unauthenticated',
    })
  })

  test('throws ForbiddenException when ctx.auth exists but user is null', async () => {
    const mw = can('editPost')
    const ctx: any = { auth: { user: null } }
    await expect(mw(ctx, async () => {})).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('calls next() when ability is granted on the default Authorize instance', async () => {
    // Register on the module-level default instance
    testAuthorize.define('testCan', () => true)
    let nextCalled = false
    const mw = can('testCan')
    const ctx: any = { auth: { user } }
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('throws ForbiddenException when ability is denied on the default instance', async () => {
    testAuthorize.define('testCanDeny', () => false)
    const mw = can('testCanDeny')
    const ctx: any = { auth: { user } }
    await expect(mw(ctx, async () => {})).rejects.toBeInstanceOf(ForbiddenException)
  })
})

// AuthorizeProvider

describe('AuthorizeProvider', () => {
  test('register() registers an Authorize instance into the app container', async () => {
    const provider = new AuthorizeProvider()
    const app = new App()
    await provider.register(app)
    expect(app.use('authorize')).toBeInstanceOf(Authorize)
  })

  test('register() creates a fresh Authorize on each provider instance', async () => {
    const p1 = new AuthorizeProvider()
    const p2 = new AuthorizeProvider()
    const app1 = new App()
    const app2 = new App()
    await p1.register(app1)
    await p2.register(app2)
    expect(app1.use('authorize')).not.toBe(app2.use('authorize'))
  })
})

// Multiple before hooks — ordering and interaction

describe('Authorize: multiple before hooks — ordering', () => {
  test('before hooks are evaluated in registration order', async () => {
    const gate = freshAuthorize()
    gate.define('action', () => false)
    const order: number[] = []
    gate.before(() => { order.push(1); return undefined })
    gate.before(() => { order.push(2); return true })
    gate.before(() => { order.push(3); return undefined })
    await gate.allows('action', user)
    // Hook 3 should NOT be reached because hook 2 returned a non-undefined value
    expect(order).toEqual([1, 2])
  })

  test('all before hooks returning undefined fall through to ability', async () => {
    const gate = freshAuthorize()
    gate.define('action', () => true)
    gate.before(() => undefined)
    gate.before(() => undefined)
    gate.before(() => undefined)
    expect(await gate.allows('action', user)).toBe(true)
  })

  test('before hook returning false blocks even when ability would allow', async () => {
    const gate = freshAuthorize()
    gate.define('always', () => true)
    gate.before(() => false)
    expect(await gate.allows('always', user)).toBe(false)
  })

  test('before hook returning undefined lets ability decide', async () => {
    const gate = freshAuthorize()
    gate.define('decide', (u: any) => u.id === 1)
    gate.before(() => undefined)
    expect(await gate.allows('decide', user)).toBe(true)
    expect(await gate.allows('decide', adminUser)).toBe(false)
  })

  test('multiple before hooks: second hook grants when first returns undefined', async () => {
    const gate = freshAuthorize()
    gate.define('action', () => false)
    gate.before(() => undefined)
    gate.before(() => true)
    expect(await gate.allows('action', user)).toBe(true)
  })

  test('async before hook works correctly', async () => {
    const gate = freshAuthorize()
    gate.define('action', () => false)
    gate.before(async (u: any) => {
      await Promise.resolve()
      return u.role === 'admin' ? true : undefined
    })
    expect(await gate.allows('action', adminUser)).toBe(true)
    expect(await gate.allows('action', user)).toBe(false)
  })
})

// Authorize: authorize() with custom AuthorizationResponse message

describe('Authorize: authorize() with AuthorizationResponse deny message', () => {
  test('authorize() throws ForbiddenException with custom message from deny()', async () => {
    const gate = freshAuthorize()
    gate.define('limited', () => AuthorizationResponse.deny('You are not allowed here'))
    try {
      await gate.authorize('limited', user)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException)
      expect(err.message).toBe('You are not allowed here')
    }
  })

  test('authorize() with allow response does not throw', async () => {
    const gate = freshAuthorize()
    gate.define('open', () => AuthorizationResponse.allow())
    await expect(gate.authorize('open', user)).resolves.toBeUndefined()
  })

  test('ForbiddenException from authorize() carries status 403 and correct code', async () => {
    const gate = freshAuthorize()
    gate.define('blocked', () => false)
    const err = await gate.authorize('blocked', user).catch(e => e)
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('AUTHORIZATION_FAILURE')
  })
})

// Policy with multiple methods

describe('Policy with multiple methods', () => {
  class ArticlePolicy extends BasePolicy {
    create(u: any) { return u.role === 'admin' || u.role === 'editor' }
    read(_u: any, _a: any) { return true }
    update(u: any, a: any) { return u.id === a.authorId }
    delete(u: any, a: any) { return u.role === 'admin' || u.id === a.authorId }
  }

  const article = { id: 5, authorId: 1 }
  const otherArticle = { id: 6, authorId: 99 }

  test('policy create — admin can create', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('create', adminUser)).toBe(true)
  })

  test('policy create — regular user cannot create', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('create', user)).toBe(false)
  })

  test('policy read — anyone can read', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('read', user, article)).toBe(true)
    expect(await gate.policy('article').allows('read', adminUser, article)).toBe(true)
  })

  test('policy update — author can update own article', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('update', user, article)).toBe(true)
  })

  test('policy update — non-author cannot update', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('update', user, otherArticle)).toBe(false)
  })

  test('policy delete — admin can delete any article', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('delete', adminUser, otherArticle)).toBe(true)
  })

  test('policy delete — author can delete own article', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    expect(await gate.policy('article').allows('delete', user, article)).toBe(true)
  })

  test('policy delete — non-author non-admin cannot delete', async () => {
    const gate = freshAuthorize()
    gate.registerPolicy('article', ArticlePolicy)
    const stranger = { id: 50, role: 'user', name: 'Stranger' }
    expect(await gate.policy('article').allows('delete', stranger, article)).toBe(false)
  })
})

// Ability overwrite (define same name twice)

describe('Authorize: ability overwrite', () => {
  test('defining the same ability twice overwrites the first', async () => {
    const gate = freshAuthorize()
    gate.define('action', () => false)
    gate.define('action', () => true) // overwrite
    expect(await gate.allows('action', user)).toBe(true)
  })

  test('overwritten ability uses the new callback logic', async () => {
    const gate = freshAuthorize()
    gate.define('check', (u: any) => u.role === 'admin')
    gate.define('check', (u: any) => u.id === 1) // overwrite
    expect(await gate.allows('check', user)).toBe(true)     // user.id === 1
    expect(await gate.allows('check', adminUser)).toBe(false) // adminUser.id === 2
  })

  test('define() returns gate for chaining and chain registers multiple abilities', async () => {
    const gate = freshAuthorize()
    gate
      .define('a', () => true)
      .define('b', () => false)
    expect(await gate.allows('a', user)).toBe(true)
    expect(await gate.allows('b', user)).toBe(false)
  })
})

// AuthorizeProvider: register / resolve / reset cycle

describe('AuthorizeProvider: register cycle', () => {
  test('registered instance is functional (can define and check abilities)', async () => {
    const provider = new AuthorizeProvider()
    const app = new App()
    await provider.register(app)
    const inst = app.use<Authorize>('authorize')
    inst.define('providerTest', () => true)
    expect(await inst.allows('providerTest', user)).toBe(true)
  })

  test('two separate register() calls produce independent Authorize instances', async () => {
    const p1 = new AuthorizeProvider()
    const p2 = new AuthorizeProvider()
    const app1 = new App()
    const app2 = new App()
    await p1.register(app1)
    await p2.register(app2)
    const inst1 = app1.use<Authorize>('authorize')
    const inst2 = app2.use<Authorize>('authorize')
    inst1.define('willBeGone', () => true)
    // inst2 is independent — 'willBeGone' not defined on it
    expect(await inst2.allows('willBeGone', user)).toBe(false)
  })
})

// PolicyProxy: denies on undefined method

describe('PolicyProxy: denies on undefined method', () => {
  class MinimalPolicy extends BasePolicy {
    view(_u: any) { return true }
  }

  test('allows() returns false for method not defined on policy', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new MinimalPolicy(), gate)
    expect(await proxy.allows('edit', user)).toBe(false)
  })

  test('denies() returns true for method not defined on policy', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new MinimalPolicy(), gate)
    expect(await proxy.denies('delete', user)).toBe(true)
  })

  test('authorize() throws ForbiddenException for undefined method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new MinimalPolicy(), gate)
    await expect(proxy.authorize('publish', user)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('authorize() throws with a message mentioning the missing method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new MinimalPolicy(), gate)
    const err = await proxy.authorize('nonexistent', user).catch(e => e)
    expect(err.message).toContain('nonexistent')
  })

  test('allows() returns true for a defined method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new MinimalPolicy(), gate)
    expect(await proxy.allows('view', user)).toBe(true)
  })
})

// can() middleware — additional edge cases

describe('can() middleware: additional edge cases', () => {
  test('throws ForbiddenException with "Unauthenticated" when ctx has no auth key', async () => {
    const mw = can('anyAbility')
    const ctx: any = {}
    const err = await Promise.resolve(mw(ctx, async () => {})).catch((e: Error) => e)
    expect(err).toBeInstanceOf(ForbiddenException)
    expect((err as Error).message).toBe('Unauthenticated')
  })

  test('throws ForbiddenException when ctx.auth is present but user is undefined', async () => {
    const mw = can('anyAbility')
    const ctx: any = { auth: {} } // user is undefined
    await expect(mw(ctx, async () => {})).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('does not call next() when ability is denied', async () => {
    testAuthorize.define('canDeniedMw', () => false)
    let called = false
    const mw = can('canDeniedMw')
    const ctx: any = { auth: { user } }
    await Promise.resolve(mw(ctx, async () => { called = true })).catch(() => {})
    expect(called).toBe(false)
  })

  test('calls next() when ability is allowed', async () => {
    testAuthorize.define('canAllowedMw', () => true)
    let called = false
    const mw = can('canAllowedMw')
    const ctx: any = { auth: { user } }
    await mw(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('can() middleware passes extra args to the ability callback', async () => {
    let receivedArgs: unknown[] = []
    testAuthorize.define('canWithArgs', (_u: unknown, ...args: unknown[]) => {
      receivedArgs = args
      return true
    })
    const mw = can('canWithArgs', 'arg1', 42)
    const ctx: any = { auth: { user } }
    await mw(ctx, async () => {})
    expect(receivedArgs).toEqual(['arg1', 42])
  })
})

// End-to-end: can() + Auth middleware via TekirServer.handle()

import { TekirServer, App as CoreApp, setContainer as coreSetContainer } from '../../tekir-core/src/index'
import { Auth } from '../../tekir-auth/src/auth_manager'
import { JwtGuard } from '../../tekir-auth/src/guards/jwt_guard'

describe('can() middleware — end-to-end via TekirServer', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? user : id == 2 ? adminUser : null

  const secret = 'authorize-e2e-secret-key-32chars!'

  function setup() {
    const server = new TekirServer()
    const router = server.getRouter()
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    // Re-set container so can() resolves authorize from the right app
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)
    return { server, router, jwtGuard, authManager }
  }

  test('can() returns 403 when ability is denied', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:admin', (u: any) => u.role === 'admin')

    router.get('/admin', () => ({ admin: true }))
      .use([authManager.middleware(), can('e2e:admin')])

    // Regular user — denied
    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/admin', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('can() returns 200 when ability is granted', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:admin2', (u: any) => u.role === 'admin')

    router.get('/admin2', () => ({ admin: true }))
      .use([authManager.middleware(), can('e2e:admin2')])

    // Admin user — granted
    const { token } = await jwtGuard.generate(adminUser)
    const res = await server.handle(new Request('http://localhost/admin2', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.admin).toBe(true)
  })

  test('can() returns 401 when no auth token provided', async () => {
    const { server, router, authManager } = setup()

    testAuthorize.define('e2e:any', () => true)

    router.get('/protected', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2e:any')])

    const res = await server.handle(new Request('http://localhost/protected'))
    expect(res.status).toBe(401)
  })

  test('route without can() is accessible to any authenticated user', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    router.get('/open', ({ auth }: any) => ({ user: auth.user.name }))
      .use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/open', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBe('Alice')
  })

  test('before hook bypasses can() for admin', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.before((u: any) => {
      if (u.role === 'admin') return true
      return undefined
    })

    testAuthorize.define('e2e:restricted', () => false)

    router.get('/restricted', () => ({ allowed: true }))
      .use([authManager.middleware(), can('e2e:restricted')])

    // Admin bypasses via before hook
    const { token: adminToken } = await jwtGuard.generate(adminUser)
    const adminRes = await server.handle(new Request('http://localhost/restricted', {
      headers: { authorization: `Bearer ${adminToken}` },
    }))
    expect(adminRes.status).toBe(200)

    // Regular user denied
    const { token: userToken } = await jwtGuard.generate(user)
    const userRes = await server.handle(new Request('http://localhost/restricted', {
      headers: { authorization: `Bearer ${userToken}` },
    }))
    expect(userRes.status).toBe(403)
  })
})

// End-to-end: authorize.authorize() inside handler

describe('authorize.authorize() in handler — end-to-end via TekirServer', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? user : id == 2 ? adminUser : null

  const secret = 'handler-auth-e2e-secret-32chars!!'

  test('returns 200 when user owns the resource', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)

    testAuthorize.define('e2e:editPost', (u: any, post: any) => u.id === post.userId)

    router.put('/posts/:id', async ({ params, auth }: any) => {
      const post = { id: params.id, userId: 1, title: 'Test' }
      await testAuthorize.authorize('e2e:editPost', auth.user, post)
      return { updated: true }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user) // user.id = 1, post.userId = 1
    const res = await server.handle(new Request('http://localhost/posts/1', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(true)
  })

  test('returns 403 when user does not own the resource', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)

    testAuthorize.define('e2e:editPost2', (u: any, post: any) => u.id === post.userId)

    router.put('/posts2/:id', async ({ params, auth }: any) => {
      const post = { id: params.id, userId: 999, title: 'Not yours' }
      await testAuthorize.authorize('e2e:editPost2', auth.user, post)
      return { updated: true }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user) // user.id = 1, post.userId = 999
    const res = await server.handle(new Request('http://localhost/posts2/1', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })
})

// E2E: can() with multiple abilities on different routes

describe('can() — multiple routes with different abilities', () => {
  function setup() {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'multi-ability-e2e-key-32-chars!!'
    const findUser = async (id: string | number) =>
      id == 1 ? user : id == 2 ? adminUser : null
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)
    return { server, router, jwtGuard, authManager }
  }

  test('different abilities on different routes', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:viewDashboard', () => true)
    testAuthorize.define('e2e:manageUsers', (u: any) => u.role === 'admin')

    router.get('/dashboard', () => ({ page: 'dashboard' }))
      .use([authManager.middleware(), can('e2e:viewDashboard')])

    router.get('/manage-users', () => ({ page: 'manage' }))
      .use([authManager.middleware(), can('e2e:manageUsers')])

    const { token } = await jwtGuard.generate(user)

    // Dashboard accessible to all authenticated users
    const dashRes = await server.handle(new Request('http://localhost/dashboard', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(dashRes.status).toBe(200)

    // Manage users denied for regular user
    const manageRes = await server.handle(new Request('http://localhost/manage-users', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(manageRes.status).toBe(403)
  })

  test('admin passes both abilities', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:viewDash2', () => true)
    testAuthorize.define('e2e:manageUsers2', (u: any) => u.role === 'admin')

    router.get('/dash2', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2e:viewDash2')])
    router.get('/manage2', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2e:manageUsers2')])

    const { token } = await jwtGuard.generate(adminUser)

    const r1 = await server.handle(new Request('http://localhost/dash2', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(r1.status).toBe(200)

    const r2 = await server.handle(new Request('http://localhost/manage2', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(r2.status).toBe(200)
  })
})

// E2E: Policy via handler

describe('Policy checks in handler — e2e', () => {
  function setup() {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'policy-e2e-key-32-characters!!!!!'
    const findUser = async (id: string | number) =>
      id == 1 ? user : id == 2 ? adminUser : null
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)
    return { server, router, jwtGuard, authManager }
  }

  test('policy allows owner to edit', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    class PostPolicy extends BasePolicy {
      edit(u: any, post: any) { return u.id === post.userId }
    }
    testAuthorize.registerPolicy('e2e:post', PostPolicy)

    router.put('/policy-posts/:id', async ({ params, auth }: any) => {
      const post = { id: params.id, userId: 1 }
      await testAuthorize.policy('e2e:post').authorize('edit', auth.user, post)
      return { edited: true }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/policy-posts/1', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).edited).toBe(true)
  })

  test('policy denies non-owner', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    class PostPolicy2 extends BasePolicy {
      edit(u: any, post: any) { return u.id === post.userId }
    }
    testAuthorize.registerPolicy('e2e:post2', PostPolicy2)

    router.put('/policy-posts2/:id', async ({ params, auth }: any) => {
      const post = { id: params.id, userId: 999 }
      await testAuthorize.policy('e2e:post2').authorize('edit', auth.user, post)
      return { edited: true }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/policy-posts2/1', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('policy with AuthorizationResponse.deny includes message', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    class StrictPolicy extends BasePolicy {
      delete(u: any, post: any) {
        if (u.id !== post.userId) return AuthorizationResponse.deny('Only the author can delete')
        return AuthorizationResponse.allow()
      }
    }
    testAuthorize.registerPolicy('e2e:strict', StrictPolicy)

    router.delete('/strict-posts/:id', async ({ params, auth }: any) => {
      const post = { id: params.id, userId: 999 }
      await testAuthorize.policy('e2e:strict').authorize('delete', auth.user, post)
      return { deleted: true }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/strict-posts/1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.message).toContain('Only the author can delete')
  })
})

// E2E: Auth + Authorize combined scenarios

describe('Auth + Authorize combined edge cases', () => {
  function setup() {
    const server = new TekirServer()
    const router = server.getRouter()
    const secret = 'combined-e2e-key-32-characters!!'
    const findUser = async (id: string | number) =>
      id == 1 ? user : id == 2 ? adminUser : null
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)
    return { server, router, jwtGuard, authManager }
  }

  test('unauthenticated request to can()-protected route returns 401 not 403', async () => {
    const { server, router, authManager } = setup()
    testAuthorize.define('e2e:anyAbility', () => true)

    router.get('/guarded', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2e:anyAbility')])

    const res = await server.handle(new Request('http://localhost/guarded'))
    expect(res.status).toBe(401)
  })

  test('expired token returns 401 even with can()', async () => {
    const { server, router, authManager } = setup()
    const findUser = async (id: string | number) => id == 1 ? user : null
    const expiredGuard = new JwtGuard({ secret: 'combined-e2e-key-32-characters!!', expiresIn: -1, resolve: findUser })

    testAuthorize.define('e2e:anyAbility2', () => true)
    router.get('/guarded2', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2e:anyAbility2')])

    const { token } = await expiredGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/guarded2', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(401)
  })

  test('authorize.allows() in handler returns boolean without throwing', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:maybeAllowed', (u: any) => u.role === 'admin')

    router.get('/check-ability', async ({ auth, response }: any) => {
      const allowed = await testAuthorize.allows('e2e:maybeAllowed', auth.user)
      return { allowed }
    }).use(authManager.middleware())

    // Regular user
    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/check-ability', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).allowed).toBe(false)

    // Admin user
    const { token: adminToken } = await jwtGuard.generate(adminUser)
    const res2 = await server.handle(new Request('http://localhost/check-ability', {
      headers: { authorization: `Bearer ${adminToken}` },
    }))
    expect(res2.status).toBe(200)
    expect((await res2.json()).allowed).toBe(true)
  })

  test('authorize.denies() returns inverse of allows()', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:denyCheck', (u: any) => u.role === 'admin')

    router.get('/deny-check', async ({ auth }: any) => {
      const denied = await testAuthorize.denies('e2e:denyCheck', auth.user)
      return { denied }
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/deny-check', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect((await res.json()).denied).toBe(true)

    const { token: t2 } = await jwtGuard.generate(adminUser)
    const res2 = await server.handle(new Request('http://localhost/deny-check', {
      headers: { authorization: `Bearer ${t2}` },
    }))
    expect((await res2.json()).denied).toBe(false)
  })

  test('public route works without any middleware', async () => {
    const { server, router } = setup()

    router.get('/public', () => ({ public: true }))

    const res = await server.handle(new Request('http://localhost/public'))
    expect(res.status).toBe(200)
    expect((await res.json()).public).toBe(true)
  })

  test('auth middleware + handler authorize + response in one flow', async () => {
    const { server, router, jwtGuard, authManager } = setup()

    testAuthorize.define('e2e:createPost', (u: any) => u.role !== 'guest')

    router.post('/create-post', async ({ auth, response }: any) => {
      await testAuthorize.authorize('e2e:createPost', auth.user)
      return response.created({ title: 'New Post', author: auth.user.name })
    }).use(authManager.middleware())

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/create-post', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('New Post')
    expect(body.author).toBe('Alice')
  })
})

// NEW TESTS — Authorize.define() edge cases

describe('Authorize.define() edge cases', () => {
  test('redefine same ability overwrites the previous callback', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:overwrite', () => false)
    gate.define('defEdge:overwrite', () => true)
    expect(await gate.allows('defEdge:overwrite', user)).toBe(true)
  })

  test('async ability callback that resolves true', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:asyncTrue', async () => {
      await new Promise(r => setTimeout(r, 1))
      return true
    })
    expect(await gate.allows('defEdge:asyncTrue', user)).toBe(true)
  })

  test('async ability callback that resolves false', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:asyncFalse', async () => {
      await new Promise(r => setTimeout(r, 1))
      return false
    })
    expect(await gate.allows('defEdge:asyncFalse', user)).toBe(false)
  })

  test('ability returning null is treated as denied', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:null', () => null)
    expect(await gate.allows('defEdge:null', user)).toBe(false)
  })

  test('ability returning undefined is treated as denied', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:undef', () => undefined)
    expect(await gate.allows('defEdge:undef', user)).toBe(false)
  })

  test('ability callback receives multiple extra args', async () => {
    const gate = freshAuthorize()
    let received: unknown[] = []
    gate.define('defEdge:multiArgs', (_u: any, ...args: unknown[]) => {
      received = args
      return true
    })
    await gate.allows('defEdge:multiArgs', user, 'a', 'b', 42)
    expect(received).toEqual(['a', 'b', 42])
  })

  test('ability accessing nested user properties', async () => {
    const gate = freshAuthorize()
    const nestedUser = { id: 1, profile: { level: 'premium' } }
    gate.define('defEdge:nested', (u: any) => u.profile?.level === 'premium')
    expect(await gate.allows('defEdge:nested', nestedUser)).toBe(true)
  })

  test('ability accessing nested user property that does not exist returns denied', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:nestedMissing', (u: any) => u.profile?.level === 'premium')
    expect(await gate.allows('defEdge:nestedMissing', user)).toBe(false)
  })

  test('define many abilities and check correct one fires', async () => {
    const gate = freshAuthorize()
    for (let i = 0; i < 20; i++) {
      gate.define(`defEdge:bulk-${i}`, (_u: any) => i === 7)
    }
    expect(await gate.allows('defEdge:bulk-7', user)).toBe(true)
    expect(await gate.allows('defEdge:bulk-0', user)).toBe(false)
    expect(await gate.allows('defEdge:bulk-19', user)).toBe(false)
  })

  test('overwritten ability async to sync', async () => {
    const gate = freshAuthorize()
    gate.define('defEdge:asyncToSync', async () => false)
    gate.define('defEdge:asyncToSync', () => true)
    expect(await gate.allows('defEdge:asyncToSync', user)).toBe(true)
  })
})

// NEW TESTS — Authorize.allows() / denies() thorough

describe('Authorize.allows() / denies() thorough', () => {
  test('allows returns true for a granted ability', async () => {
    const gate = freshAuthorize()
    gate.define('ad:granted', () => true)
    expect(await gate.allows('ad:granted', user)).toBe(true)
  })

  test('allows returns false for a denied ability', async () => {
    const gate = freshAuthorize()
    gate.define('ad:denied', () => false)
    expect(await gate.allows('ad:denied', user)).toBe(false)
  })

  test('denies returns false for a granted ability', async () => {
    const gate = freshAuthorize()
    gate.define('ad:grantedDenies', () => true)
    expect(await gate.denies('ad:grantedDenies', user)).toBe(false)
  })

  test('denies returns true for a denied ability', async () => {
    const gate = freshAuthorize()
    gate.define('ad:deniedDenies', () => false)
    expect(await gate.denies('ad:deniedDenies', user)).toBe(true)
  })

  test('unknown ability name results in denied', async () => {
    const gate = freshAuthorize()
    expect(await gate.allows('ad:nonexistent', user)).toBe(false)
    expect(await gate.denies('ad:nonexistent', user)).toBe(true)
  })

  test('allows with async callback resolving true', async () => {
    const gate = freshAuthorize()
    gate.define('ad:asyncAllow', async () => true)
    expect(await gate.allows('ad:asyncAllow', user)).toBe(true)
  })

  test('denies with AuthorizationResponse.deny', async () => {
    const gate = freshAuthorize()
    gate.define('ad:respDeny', () => AuthorizationResponse.deny('nope'))
    expect(await gate.denies('ad:respDeny', user)).toBe(true)
  })

  test('allows after before hook grants', async () => {
    const gate = freshAuthorize()
    gate.define('ad:hookGrant', () => false)
    gate.before(() => true)
    expect(await gate.allows('ad:hookGrant', user)).toBe(true)
  })

  test('denies after before hook denies', async () => {
    const gate = freshAuthorize()
    gate.define('ad:hookDeny', () => true)
    gate.before(() => false)
    expect(await gate.denies('ad:hookDeny', user)).toBe(true)
  })

  test('allows with AuthorizationResponse.allow callback', async () => {
    const gate = freshAuthorize()
    gate.define('ad:respAllow', () => AuthorizationResponse.allow())
    expect(await gate.allows('ad:respAllow', user)).toBe(true)
  })
})

// NEW TESTS — Authorize.authorize() thorough

describe('Authorize.authorize() thorough', () => {
  test('throws ForbiddenException with correct default message', async () => {
    const gate = freshAuthorize()
    gate.define('authz:fail', () => false)
    const err = await gate.authorize('authz:fail', user).catch((e: any) => e)
    expect(err).toBeInstanceOf(ForbiddenException)
    expect(err.message).toBe('Authorization failed')
  })

  test('does not throw when allowed', async () => {
    const gate = freshAuthorize()
    gate.define('authz:pass', () => true)
    await expect(gate.authorize('authz:pass', user)).resolves.toBeUndefined()
  })

  test('ForbiddenException has statusCode 403', async () => {
    const gate = freshAuthorize()
    gate.define('authz:status', () => false)
    const err = await gate.authorize('authz:status', user).catch((e: any) => e)
    expect(err.statusCode).toBe(403)
  })

  test('ForbiddenException has code E_AUTHORIZATION_FAILURE', async () => {
    const gate = freshAuthorize()
    gate.define('authz:code', () => false)
    const err = await gate.authorize('authz:code', user).catch((e: any) => e)
    expect(err.code).toBe('AUTHORIZATION_FAILURE')
  })

  test('custom deny message preserved in exception', async () => {
    const gate = freshAuthorize()
    gate.define('authz:customMsg', () => AuthorizationResponse.deny('Custom deny reason'))
    const err = await gate.authorize('authz:customMsg', user).catch((e: any) => e)
    expect(err.message).toBe('Custom deny reason')
  })

  test('authorize with multiple resource args passes them through', async () => {
    const gate = freshAuthorize()
    let receivedArgs: unknown[] = []
    gate.define('authz:multiArgs', (_u: any, ...args: unknown[]) => {
      receivedArgs = args
      return true
    })
    await gate.authorize('authz:multiArgs', user, 'resource', 42)
    expect(receivedArgs).toEqual(['resource', 42])
  })

  test('authorize for undefined ability throws ForbiddenException', async () => {
    const gate = freshAuthorize()
    await expect(gate.authorize('authz:unknown', user)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('authorize with before hook granting does not throw', async () => {
    const gate = freshAuthorize()
    gate.define('authz:hookPass', () => false)
    gate.before(() => true)
    await expect(gate.authorize('authz:hookPass', user)).resolves.toBeUndefined()
  })
})

// NEW TESTS — Before hooks thorough

describe('Before hooks thorough', () => {
  test('multiple before hooks run in registration order', async () => {
    const gate = freshAuthorize()
    gate.define('bh:order', () => false)
    const order: number[] = []
    gate.before(() => { order.push(1); return undefined })
    gate.before(() => { order.push(2); return undefined })
    gate.before(() => { order.push(3); return undefined })
    await gate.allows('bh:order', user)
    expect(order).toEqual([1, 2, 3])
  })

  test('first hook returning true stops the chain', async () => {
    const gate = freshAuthorize()
    gate.define('bh:stopTrue', () => false)
    const order: number[] = []
    gate.before(() => { order.push(1); return true })
    gate.before(() => { order.push(2); return undefined })
    await gate.allows('bh:stopTrue', user)
    expect(order).toEqual([1])
  })

  test('first hook returning false stops the chain', async () => {
    const gate = freshAuthorize()
    gate.define('bh:stopFalse', () => true)
    const order: number[] = []
    gate.before(() => { order.push(1); return false })
    gate.before(() => { order.push(2); return undefined })
    await gate.allows('bh:stopFalse', user)
    expect(order).toEqual([1])
  })

  test('undefined from hook continues to next hook', async () => {
    const gate = freshAuthorize()
    gate.define('bh:continue', () => false)
    let secondReached = false
    gate.before(() => undefined)
    gate.before(() => { secondReached = true; return true })
    await gate.allows('bh:continue', user)
    expect(secondReached).toBe(true)
  })

  test('before hook receives ability name as second arg', async () => {
    const gate = freshAuthorize()
    gate.define('bh:abilityName', () => true)
    let receivedAbility = ''
    gate.before((_u: any, ability: string) => { receivedAbility = ability; return undefined })
    await gate.allows('bh:abilityName', user)
    expect(receivedAbility).toBe('bh:abilityName')
  })

  test('before hook receives extra args', async () => {
    const gate = freshAuthorize()
    gate.define('bh:extraArgs', () => true)
    let receivedArgs: unknown[] = []
    gate.before((_u: any, _ability: string, ...args: unknown[]) => { receivedArgs = args; return undefined })
    await gate.allows('bh:extraArgs', user, 'extra1', 'extra2')
    expect(receivedArgs).toEqual(['extra1', 'extra2'])
  })

  test('async before hook resolves correctly', async () => {
    const gate = freshAuthorize()
    gate.define('bh:async', () => false)
    gate.before(async () => {
      await new Promise(r => setTimeout(r, 1))
      return true
    })
    expect(await gate.allows('bh:async', user)).toBe(true)
  })

  test('new Authorize instance has no before hooks from another instance', async () => {
    const gate1 = freshAuthorize()
    gate1.before(() => true)
    const gate2 = freshAuthorize()
    gate2.define('bh:isolated', () => false)
    // gate2 has no before hooks, so ability returning false should deny
    expect(await gate2.allows('bh:isolated', user)).toBe(false)
  })

  test('before hook returning null continues to next hook', async () => {
    const gate = freshAuthorize()
    gate.define('bh:null', () => true)
    let secondReached = false
    gate.before(() => null)
    gate.before(() => { secondReached = true; return undefined })
    await gate.allows('bh:null', user)
    expect(secondReached).toBe(true)
  })

  test('before hook returning AuthorizationResponse.allow() short-circuits', async () => {
    const gate = freshAuthorize()
    gate.define('bh:respAllow', () => false)
    gate.before(() => AuthorizationResponse.allow())
    expect(await gate.allows('bh:respAllow', user)).toBe(true)
  })
})

// NEW TESTS — BasePolicy thorough

describe('BasePolicy thorough', () => {
  test('policy method returning true means allow', async () => {
    class P extends BasePolicy { act(_u: any) { return true } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:boolTrue', P)
    expect(await gate.policy('bp:boolTrue').allows('act', user)).toBe(true)
  })

  test('policy method returning false means deny', async () => {
    class P extends BasePolicy { act(_u: any) { return false } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:boolFalse', P)
    expect(await gate.policy('bp:boolFalse').allows('act', user)).toBe(false)
  })

  test('policy method returning AuthorizationResponse.allow()', async () => {
    class P extends BasePolicy { act(_u: any) { return AuthorizationResponse.allow() } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:respAllow', P)
    expect(await gate.policy('bp:respAllow').allows('act', user)).toBe(true)
  })

  test('policy method returning AuthorizationResponse.deny(message)', async () => {
    class P extends BasePolicy { act(_u: any) { return AuthorizationResponse.deny('policy denied') } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:respDeny', P)
    expect(await gate.policy('bp:respDeny').allows('act', user)).toBe(false)
  })

  test('async policy method', async () => {
    class P extends BasePolicy {
      async act(u: any) {
        await new Promise(r => setTimeout(r, 1))
        return u.role === 'admin'
      }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:async', P)
    expect(await gate.policy('bp:async').allows('act', adminUser)).toBe(true)
    expect(await gate.policy('bp:async').allows('act', user)).toBe(false)
  })

  test('policy method receiving multiple args', async () => {
    class P extends BasePolicy {
      act(_u: any, resource: any, action: any) { return resource.id === 10 && action === 'read' }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:multiArgs', P)
    expect(await gate.policy('bp:multiArgs').allows('act', user, { id: 10 }, 'read')).toBe(true)
    expect(await gate.policy('bp:multiArgs').allows('act', user, { id: 10 }, 'write')).toBe(false)
  })

  test('policy method not found results in denied', async () => {
    class P extends BasePolicy { view(_u: any) { return true } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:noMethod', P)
    expect(await gate.policy('bp:noMethod').allows('edit', user)).toBe(false)
  })

  test('policy with nested user property checks', async () => {
    class P extends BasePolicy {
      act(u: any) { return u.profile?.permissions?.includes('manage') }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:nestedUser', P)
    const privileged = { id: 3, role: 'user', name: 'Carol', profile: { permissions: ['manage', 'view'] } }
    expect(await gate.policy('bp:nestedUser').allows('act', privileged)).toBe(true)
    expect(await gate.policy('bp:nestedUser').allows('act', user)).toBe(false)
  })

  test('policy method returning undefined is denied', async () => {
    class P extends BasePolicy { act(_u: any) { return undefined } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:undef', P)
    expect(await gate.policy('bp:undef').allows('act', user)).toBe(false)
  })

  test('policy method returning null is denied', async () => {
    class P extends BasePolicy { act(_u: any) { return null } }
    const gate = freshAuthorize()
    gate.registerPolicy('bp:null', P)
    expect(await gate.policy('bp:null').allows('act', user)).toBe(false)
  })
})

// NEW TESTS — PolicyProxy thorough

describe('PolicyProxy thorough', () => {
  class ProxyTestPolicy extends BasePolicy {
    allow(_u: any) { return true }
    deny(_u: any) { return false }
    adminOnly(u: any) { return u.role === 'admin' }
    async asyncMethod(u: any) {
      await new Promise(r => setTimeout(r, 1))
      return u.id === 1
    }
    withResponse(_u: any) { return AuthorizationResponse.deny('proxy denied') }
  }

  test('proxy.allows() returns true when policy allows', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    expect(await proxy.allows('allow', user)).toBe(true)
  })

  test('proxy.allows() returns false when policy denies', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    expect(await proxy.allows('deny', user)).toBe(false)
  })

  test('proxy.denies() returns false when policy allows', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    expect(await proxy.denies('allow', user)).toBe(false)
  })

  test('proxy.denies() returns true when policy denies', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    expect(await proxy.denies('deny', user)).toBe(true)
  })

  test('proxy.authorize() throws on deny', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    await expect(proxy.authorize('deny', user)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('proxy.authorize() passes on allow', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    await expect(proxy.authorize('allow', user)).resolves.toBeUndefined()
  })

  test('proxy with async method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    expect(await proxy.allows('asyncMethod', user)).toBe(true)
    expect(await proxy.allows('asyncMethod', adminUser)).toBe(false)
  })

  test('proxy before hooks still apply', async () => {
    const gate = freshAuthorize()
    gate.before(() => true) // grant everything
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    // Even though 'deny' returns false, before hook overrides
    expect(await proxy.allows('deny', user)).toBe(true)
  })

  test('proxy.authorize() includes deny message from AuthorizationResponse', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    const err = await proxy.authorize('withResponse', user).catch((e: any) => e)
    expect(err.message).toBe('proxy denied')
  })

  test('proxy for undefined method denies with message about method', async () => {
    const gate = freshAuthorize()
    const proxy = new PolicyProxy(new ProxyTestPolicy(), gate)
    const err = await proxy.authorize('nonexistent', user).catch((e: any) => e)
    expect(err).toBeInstanceOf(ForbiddenException)
    expect(err.message).toContain('nonexistent')
  })
})

// NEW TESTS — AuthorizationResponse additional

describe('AuthorizationResponse additional', () => {
  test('allow().allowed is true', () => {
    expect(AuthorizationResponse.allow().allowed).toBe(true)
  })

  test('deny().allowed is false', () => {
    expect(AuthorizationResponse.deny().allowed).toBe(false)
  })

  test('deny().message is set to provided value', () => {
    expect(AuthorizationResponse.deny('custom msg').message).toBe('custom msg')
  })

  test('deny() default message is "Authorization failed"', () => {
    expect(AuthorizationResponse.deny().message).toBe('Authorization failed')
  })

  test('allow().message is undefined', () => {
    expect(AuthorizationResponse.allow().message).toBeUndefined()
  })

  test('toBoolean() returns true for allow', () => {
    expect(AuthorizationResponse.allow().toBoolean()).toBe(true)
  })

  test('toBoolean() returns false for deny', () => {
    expect(AuthorizationResponse.deny().toBoolean()).toBe(false)
  })

  test('multiple deny with different messages retain their own message', () => {
    const d1 = AuthorizationResponse.deny('reason A')
    const d2 = AuthorizationResponse.deny('reason B')
    expect(d1.message).toBe('reason A')
    expect(d2.message).toBe('reason B')
    expect(d1.allowed).toBe(false)
    expect(d2.allowed).toBe(false)
  })
})

// NEW TESTS — ForbiddenException additional

describe('ForbiddenException additional', () => {
  test('extends Error', () => {
    expect(new ForbiddenException()).toBeInstanceOf(Error)
  })

  test('has statusCode 403', () => {
    expect(new ForbiddenException().statusCode).toBe(403)
  })

  test('has code E_AUTHORIZATION_FAILURE', () => {
    expect(new ForbiddenException().code).toBe('AUTHORIZATION_FAILURE')
  })

  test('message is customizable', () => {
    expect(new ForbiddenException('custom').message).toBe('custom')
  })

  test('toJSON() returns correct shape', () => {
    const err = new ForbiddenException('test msg')
    const json = err.toJSON()
    expect(json.error.message).toBe('test msg')
    expect(json.error.statusCode).toBe(403)
    expect(json.error.code).toBe('AUTHORIZATION_FAILURE')
  })
})

// NEW TESTS — can() middleware e2e advanced

describe('can() middleware e2e advanced', () => {
  const findUser = async (id: string | number) =>
    id == 1 ? user : id == 2 ? adminUser : id == 3 ? { id: 3, role: 'editor', name: 'Eve' } : null

  const secret = 'can-e2e-advanced-secret-32chars!'

  function setupAdvanced() {
    const server = new TekirServer()
    const router = server.getRouter()
    const jwtGuard = new JwtGuard({ secret, expiresIn: 3600, resolve: findUser })
    const authManager = new Auth({ defaultGuard: 'jwt', guards: { jwt: () => jwtGuard } })
    const app = new CoreApp()
    app.instance('authorize', testAuthorize)
    coreSetContainer(app, server as any, { info: () => {} } as any)
    return { server, router, jwtGuard, authManager }
  }

  test('can with async ability callback', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:asyncAbility', async (u: any) => {
      await new Promise(r => setTimeout(r, 1))
      return u.role === 'admin'
    })
    router.get('/async-check', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2eAdv:asyncAbility')])

    const { token } = await jwtGuard.generate(adminUser)
    const res = await server.handle(new Request('http://localhost/async-check', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
  })

  test('can with async ability denied', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:asyncDeny', async (u: any) => {
      await new Promise(r => setTimeout(r, 1))
      return u.role === 'admin'
    })
    router.get('/async-deny', () => ({ ok: true }))
      .use([authManager.middleware(), can('e2eAdv:asyncDeny')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/async-deny', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('can + auth + response.created', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:create', () => true)
    router.post('/adv-create', ({ response }: any) => response.created({ done: true }))
      .use([authManager.middleware(), can('e2eAdv:create')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/adv-create', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(201)
  })

  test('can + auth + response.noContent', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:noContent', () => true)
    router.delete('/adv-no-content', ({ response }: any) => response.noContent())
      .use([authManager.middleware(), can('e2eAdv:noContent')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/adv-no-content', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(204)
  })

  test('can on POST route', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:postRoute', (u: any) => u.role === 'admin')
    router.post('/adv-post', () => ({ posted: true }))
      .use([authManager.middleware(), can('e2eAdv:postRoute')])

    const { token } = await jwtGuard.generate(adminUser)
    const res = await server.handle(new Request('http://localhost/adv-post', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
  })

  test('can on PUT route denied', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:putRoute', (u: any) => u.role === 'admin')
    router.put('/adv-put', () => ({ updated: true }))
      .use([authManager.middleware(), can('e2eAdv:putRoute')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/adv-put', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('can on DELETE route allowed', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:deleteRoute', () => true)
    router.delete('/adv-delete', () => ({ deleted: true }))
      .use([authManager.middleware(), can('e2eAdv:deleteRoute')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/adv-delete', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
  })

  test('role-based: editor role granted', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:editorOnly', (u: any) => u.role === 'editor' || u.role === 'admin')
    router.get('/editor-area', () => ({ area: 'editor' }))
      .use([authManager.middleware(), can('e2eAdv:editorOnly')])

    const editor = { id: 3, role: 'editor', name: 'Eve' }
    const { token } = await jwtGuard.generate(editor)
    const res = await server.handle(new Request('http://localhost/editor-area', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(200)
  })

  test('role-based: regular user denied from editor area', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:editorOnly2', (u: any) => u.role === 'editor' || u.role === 'admin')
    router.get('/editor-area2', () => ({ area: 'editor' }))
      .use([authManager.middleware(), can('e2eAdv:editorOnly2')])

    const { token } = await jwtGuard.generate(user)
    const res = await server.handle(new Request('http://localhost/editor-area2', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(res.status).toBe(403)
  })

  test('multiple can() on different routes same server', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:routeA', () => true)
    testAuthorize.define('e2eAdv:routeB', (u: any) => u.role === 'admin')

    router.get('/multi-a', () => ({ route: 'a' }))
      .use([authManager.middleware(), can('e2eAdv:routeA')])
    router.get('/multi-b', () => ({ route: 'b' }))
      .use([authManager.middleware(), can('e2eAdv:routeB')])

    const { token } = await jwtGuard.generate(user)
    const resA = await server.handle(new Request('http://localhost/multi-a', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(resA.status).toBe(200)
    const resB = await server.handle(new Request('http://localhost/multi-b', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(resB.status).toBe(403)
  })

  test('admin passes both routes', async () => {
    const { server, router, jwtGuard, authManager } = setupAdvanced()
    testAuthorize.define('e2eAdv:routeC', () => true)
    testAuthorize.define('e2eAdv:routeD', (u: any) => u.role === 'admin')

    router.get('/multi-c', () => ({ route: 'c' }))
      .use([authManager.middleware(), can('e2eAdv:routeC')])
    router.get('/multi-d', () => ({ route: 'd' }))
      .use([authManager.middleware(), can('e2eAdv:routeD')])

    const { token } = await jwtGuard.generate(adminUser)
    const resC = await server.handle(new Request('http://localhost/multi-c', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(resC.status).toBe(200)
    const resD = await server.handle(new Request('http://localhost/multi-d', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(resD.status).toBe(200)
  })
})

// NEW TESTS — Authorize fresh instance isolation

describe('Authorize fresh instance isolation', () => {
  test('new Authorize() has no abilities', async () => {
    const gate = freshAuthorize()
    expect(await gate.allows('anything', user)).toBe(false)
  })

  test('new Authorize() has no before hooks (ability result is used directly)', async () => {
    const gate = freshAuthorize()
    gate.define('iso:check', () => false)
    // If there were before hooks granting, this would be true
    expect(await gate.allows('iso:check', user)).toBe(false)
  })

  test('abilities on one instance do not leak to another', async () => {
    const gate1 = freshAuthorize()
    const gate2 = freshAuthorize()
    gate1.define('iso:leak', () => true)
    expect(await gate1.allows('iso:leak', user)).toBe(true)
    expect(await gate2.allows('iso:leak', user)).toBe(false)
  })

  test('before hooks on one instance do not leak to another', async () => {
    const gate1 = freshAuthorize()
    const gate2 = freshAuthorize()
    gate1.before(() => true)
    gate2.define('iso:hookLeak', () => false)
    // gate2 has no before hooks so ability returning false should deny
    expect(await gate2.allows('iso:hookLeak', user)).toBe(false)
  })

  test('policies on one instance do not leak to another', () => {
    class P extends BasePolicy { act() { return true } }
    const gate1 = freshAuthorize()
    const gate2 = freshAuthorize()
    gate1.registerPolicy('iso:policyLeak', P)
    expect(() => gate2.policy('iso:policyLeak')).toThrow()
  })

  test('registerPolicy + policy() works on fresh instance', async () => {
    class P extends BasePolicy { view(_u: any) { return true } }
    const gate = freshAuthorize()
    gate.registerPolicy('iso:fresh', P)
    expect(await gate.policy('iso:fresh').allows('view', user)).toBe(true)
  })

  test('fresh instance allows defining and checking abilities independently', async () => {
    const gate = freshAuthorize()
    gate.define('iso:independent', (u: any) => u.id === 1)
    expect(await gate.allows('iso:independent', user)).toBe(true)
    expect(await gate.allows('iso:independent', adminUser)).toBe(false)
  })

  test('fresh instance before hook works independently', async () => {
    const gate = freshAuthorize()
    gate.define('iso:hookIndep', () => false)
    gate.before((u: any) => u.role === 'admin' ? true : undefined)
    expect(await gate.allows('iso:hookIndep', adminUser)).toBe(true)
    expect(await gate.allows('iso:hookIndep', user)).toBe(false)
  })

  test('registering same policy name on different instances gives different proxies', () => {
    class P extends BasePolicy { act() { return true } }
    const gate1 = freshAuthorize()
    const gate2 = freshAuthorize()
    gate1.registerPolicy('iso:sameKey', P)
    gate2.registerPolicy('iso:sameKey', P)
    expect(gate1.policy('iso:sameKey')).not.toBe(gate2.policy('iso:sameKey'))
  })

  test('fresh instance policy proxy cache is independent', () => {
    class P extends BasePolicy { act() { return true } }
    const gate = freshAuthorize()
    gate.registerPolicy('iso:cache', P)
    const first = gate.policy('iso:cache')
    const second = gate.policy('iso:cache')
    expect(first).toBe(second) // same instance, cached
  })

  test('chaining define and before on fresh instance', async () => {
    const gate = freshAuthorize()
    gate.define('iso:chain', () => false).before((u: any) => u.role === 'admin' ? true : undefined)
    expect(await gate.allows('iso:chain', adminUser)).toBe(true)
    expect(await gate.allows('iso:chain', user)).toBe(false)
  })
})

// NEW TESTS: Deep edge cases for Authorize

describe('Authorize — before hook edge cases', () => {
  test('before returning true bypasses the ability callback entirely', async () => {
    const gate = freshAuthorize()
    let abilityCalled = false
    gate.define('byp', () => { abilityCalled = true; return false })
    gate.before(() => true)
    expect(await gate.allows('byp', user)).toBe(true)
    expect(abilityCalled).toBe(false)
  })

  test('before returning false denies even when ability would allow', async () => {
    const gate = freshAuthorize()
    gate.define('blocked', () => true)
    gate.before(() => false)
    expect(await gate.allows('blocked', user)).toBe(false)
  })

  test('before returning undefined falls through to ability check', async () => {
    const gate = freshAuthorize()
    gate.define('passthrough', (u: any) => u.role === 'admin')
    gate.before(() => undefined)
    expect(await gate.allows('passthrough', adminUser)).toBe(true)
    expect(await gate.allows('passthrough', user)).toBe(false)
  })

  test('async before hook works', async () => {
    const gate = freshAuthorize()
    gate.define('async-before', () => false)
    gate.before(async (u: any) => {
      await Promise.resolve()
      return u.role === 'admin' ? true : undefined
    })
    expect(await gate.allows('async-before', adminUser)).toBe(true)
    expect(await gate.allows('async-before', user)).toBe(false)
  })
})

describe('Authorize — define overwrite', () => {
  test('re-defining an ability replaces the old callback', async () => {
    const gate = freshAuthorize()
    gate.define('overwrite', () => true)
    gate.define('overwrite', () => false)
    expect(await gate.allows('overwrite', user)).toBe(false)
  })
})

describe('Authorize — authorize() error message', () => {
  test('authorize() error has correct status and code', async () => {
    const gate = freshAuthorize()
    gate.define('deny-msg', () => false)
    try {
      await gate.authorize('deny-msg', user)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException)
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe('AUTHORIZATION_FAILURE')
    }
  })

  test('authorize() with AuthorizationResponse.deny(msg) propagates message', async () => {
    const gate = freshAuthorize()
    gate.define('deny-custom', () => AuthorizationResponse.deny('Custom denial'))
    try {
      await gate.authorize('deny-custom', user)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.message).toBe('Custom denial')
    }
  })
})

describe('Authorize — multiple abilities', () => {
  test('multiple independent abilities work correctly', async () => {
    const gate = freshAuthorize()
    gate.define('read', () => true)
    gate.define('write', (u: any) => u.role === 'admin')
    gate.define('delete', () => false)
    expect(await gate.allows('read', user)).toBe(true)
    expect(await gate.allows('write', user)).toBe(false)
    expect(await gate.allows('write', adminUser)).toBe(true)
    expect(await gate.allows('delete', adminUser)).toBe(false)
  })
})

describe('PolicyProxy — method dispatch via allows/denies', () => {
  test('allows() dispatches to policy method with user and model', async () => {
    class PostPolicy extends BasePolicy {
      edit(u: any, p: any) { return u.id === p.userId }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('post-edit', PostPolicy)
    const proxy = gate.policy('post-edit')
    expect(await proxy.allows('edit', user, post)).toBe(true)
    expect(await proxy.allows('edit', user, otherPost)).toBe(false)
  })

  test('denies() is inverse of allows()', async () => {
    class PostPolicy extends BasePolicy {
      edit(u: any, p: any) { return u.id === p.userId }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('post-deny', PostPolicy)
    const proxy = gate.policy('post-deny')
    expect(await proxy.denies('edit', user, post)).toBe(false)
    expect(await proxy.denies('edit', user, otherPost)).toBe(true)
  })

  test('authorize() throws ForbiddenException when denied', async () => {
    class StrictPolicy extends BasePolicy {
      admin(_u: any) { return false }
    }
    const gate = freshAuthorize()
    gate.registerPolicy('strict', StrictPolicy)
    const proxy = gate.policy('strict')
    await expect(proxy.authorize('admin', user)).rejects.toBeInstanceOf(ForbiddenException)
  })

  test('allows() returns false for undefined policy method', async () => {
    class EmptyPolicy extends BasePolicy {}
    const gate = freshAuthorize()
    gate.registerPolicy('empty-pol', EmptyPolicy)
    const proxy = gate.policy('empty-pol')
    expect(await proxy.allows('nonexistent', user)).toBe(false)
  })
})

describe('AuthorizationResponse — edge cases', () => {
  test('allow() with no message has undefined message', () => {
    const resp = AuthorizationResponse.allow()
    expect(resp.message).toBeUndefined()
  })

  test('deny() with empty string still has that message', () => {
    const resp = AuthorizationResponse.deny('')
    expect(resp.allowed).toBe(false)
    expect(resp.message).toBe('')
  })

  test('toBoolean on allow returns true', () => {
    expect(AuthorizationResponse.allow().toBoolean()).toBe(true)
  })

  test('toBoolean on deny returns false', () => {
    expect(AuthorizationResponse.deny().toBoolean()).toBe(false)
  })
})

describe('ForbiddenException — additional', () => {
  test('ForbiddenException name property is HttpException', () => {
    const err = new ForbiddenException()
    // Inherits from HttpException
    expect(err.name).toBe('HttpException')
  })

  test('ForbiddenException with long message preserves it', () => {
    const msg = 'x'.repeat(500)
    const err = new ForbiddenException(msg)
    expect(err.message).toBe(msg)
    expect(err.message.length).toBe(500)
  })

  test('ForbiddenException is catchable as Error', () => {
    try {
      throw new ForbiddenException('test')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as any).statusCode).toBe(403)
    }
  })
})
