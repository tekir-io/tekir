import { test, expect, describe } from 'bun:test'
import { Controller } from '../src/controller'
import { Get } from '../src/route'
import { ControllerManager } from '../src/controller_manager'

// Minimal router/trie double that records every route the manager registers.
function fakeRouter() {
  const added: Array<{ method: string; path: string; handler: any }> = []
  const trie = {
    add(method: string, path: string, handler: any, _mw: any, _name?: string) {
      added.push({ method, path, handler })
    },
  }
  return { added, getTrie: () => trie } as any
}

describe('ControllerManager.load() resilience', () => {
  test('a controller whose constructor throws is skipped with a warning, others still load', () => {
    @Controller('/bad')
    class BadController {
      constructor() { throw new Error('ctor boom') }
      @Get('/') list() {}
    }

    @Controller('/good')
    class GoodController {
      @Get('/') list() {}
    }

    const router = fakeRouter()
    const manager = new ControllerManager().register(BadController, GoodController)

    const original = console.warn
    let warned = 0
    console.warn = () => { warned++ }
    try {
      expect(() => manager.load(router)).not.toThrow()
    } finally {
      console.warn = original
    }

    expect(warned).toBeGreaterThanOrEqual(1)
    // The good controller's route is still registered.
    expect(router.added.some((r: any) => r.path === '/good')).toBe(true)
  })

  test('a route naming a missing handler method is skipped, not fatal', () => {
    @Controller('/things')
    class ThingController {
      @Get('/') list() {}
    }
    // Inject a bogus route whose method does not exist on the instance.
    ;(ThingController as any).__routes.push({ path: '/ghost', method: 'GET', methodName: 'doesNotExist' })

    const router = fakeRouter()
    const manager = new ControllerManager().register(ThingController)

    const original = console.warn
    let warned = 0
    console.warn = () => { warned++ }
    try {
      expect(() => manager.load(router)).not.toThrow()
    } finally {
      console.warn = original
    }

    expect(warned).toBeGreaterThanOrEqual(1)
    // The valid route still got registered.
    expect(router.added.some((r: any) => r.path === '/things')).toBe(true)
    expect(router.added.some((r: any) => r.path === '/things/ghost')).toBe(false)
  })

  test('a @Websocket route is skipped with a warning (not silently dropped)', () => {
    @Controller('/ws')
    class WsController {
      @Get('/') list() {}
    }
    ;(WsController as any).__routes.push({ path: '/socket', method: 'WS', methodName: 'list' })

    const router = fakeRouter()
    const manager = new ControllerManager().register(WsController)
    const original = console.warn
    let warned = 0
    console.warn = () => { warned++ }
    try {
      manager.load(router)
    } finally {
      console.warn = original
    }
    expect(warned).toBeGreaterThanOrEqual(1)
    expect(router.added.some((r: any) => r.method === 'WS')).toBe(false)
  })
})

describe('.where() matcher is not stateful across requests', () => {
  test('a global-flag matcher matches consistently on repeated calls', async () => {
    @Controller('/users')
    class UserController {
      @Get('/:id', { where: { id: { match: /\d+/g } } })
      show() { return new Response('ok') }
    }

    const router = fakeRouter()
    new ControllerManager().register(UserController).load(router)
    const route = router.added.find((r: any) => r.path === '/users/:id')
    expect(route).toBeDefined()

    // Call the handler several times with a valid param. A stateful /g regex
    // would flip to a 404 on alternating calls; the fix keeps it consistent.
    for (let i = 0; i < 4; i++) {
      const res = await route.handler({ params: { id: '123' } })
      expect(res.status ?? 200).not.toBe(404)
    }
  })
})

describe('route metadata does not leak across controller inheritance', () => {
  test('subclass routes do not pollute the parent (legacy addRoute)', () => {
    // Exercise the legacy addRoute path directly via route metadata arrays.
    class BaseCtrl {}
    class ChildCtrl extends BaseCtrl {}
    // Apply a legacy-style decorator by calling the returned function with
    // (prototype, methodName) so addRoute runs against each constructor.
    const dec = Get('/base')
    dec(BaseCtrl.prototype, 'baseHandler')
    const dec2 = Get('/child')
    dec2(ChildCtrl.prototype, 'childHandler')

    const baseRoutes = (BaseCtrl as any).__routes || []
    const childRoutes = (ChildCtrl as any).__routes || []
    expect(baseRoutes.map((r: any) => r.path)).toContain('/base')
    expect(baseRoutes.map((r: any) => r.path)).not.toContain('/child')
    expect(childRoutes.map((r: any) => r.path)).toContain('/child')
    expect(baseRoutes).not.toBe(childRoutes)
  })
})
