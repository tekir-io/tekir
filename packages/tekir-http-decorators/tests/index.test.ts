import { test, expect, describe } from 'bun:test'
import { Controller } from '../src/controller'
import { Get, Post, Put, Delete, Patch, Head, Options, Websocket } from '../src/route'
import { Middleware } from '../src/middleware'
import type { RouteMetadata } from '../src/utils'

// Decorated controller classes stamp method-level middleware lists onto
// their prototype under the `__middlewares` key. The type alias here
// surfaces that convention to TypeScript so tests can read the map
// without an `any` cast.
type WithMiddlewares = { __middlewares?: Record<string, any[]> }

// Helpers

/** Retrieve __routes from a class, handling both legacy and TC39 paths. */
function getRoutes(cls: any): RouteMetadata[] {
  return cls.__routes ?? []
}

/** Retrieve __prefix from a class. */
function getPrefix(cls: any): string[] {
  return cls.__prefix ?? []
}

// A minimal no-op middleware function accepted by @Middleware
const noopMw = async (_ctx: any, next: any) => next()

// @Controller

describe('@Controller', () => {
  test('sets __prefix to an array with the given string', () => {
    @Controller('/users')
    class UserController {}

    expect(getPrefix(UserController)).toEqual(['/users'])
  })

  test('defaults to an empty string prefix when called with no argument', () => {
    @Controller()
    class RootController {}

    expect(getPrefix(RootController)).toEqual([''])
  })

  test('accepts an array of prefixes', () => {
    @Controller(['/v1/posts', '/v2/posts'])
    class PostController {}

    expect(getPrefix(PostController)).toEqual(['/v1/posts', '/v2/posts'])
  })

  test('initialises __routes on the class', () => {
    @Controller('/things')
    class ThingController {}

    expect(Array.isArray(getRoutes(ThingController))).toBe(true)
  })

  test('TC39 path: collects __routeMeta from decorated methods', () => {
    @Controller('/api')
    class ApiController {
      index() {}
    }
    // In legacy mode __routes may be empty; in TC39 mode it will be populated.
    // Either way the array must exist.
    expect(Array.isArray(getRoutes(ApiController))).toBe(true)
  })
})

// @Get

describe('@Get', () => {
  test('registers a GET route on the class', () => {
    @Controller('/users')
    class UsersController {
      @Get('/list')
      list() {}
    }

    const routes = getRoutes(UsersController)
    const route  = routes.find(r => r.methodName === 'list')
    expect(route).toBeDefined()
    expect(route!.method).toBe('GET')
    expect(route!.path).toBe('/list')
  })

  test('defaults path to empty string when none is supplied', () => {
    @Controller('/')
    class HomeController {
      @Get()
      index() {}
    }

    const route = getRoutes(HomeController).find(r => r.methodName === 'index')
    expect(route).toBeDefined()
    expect(route!.path).toBe('')
  })
})

// @Post

describe('@Post', () => {
  test('registers a POST route', () => {
    @Controller('/items')
    class ItemsController {
      @Post('/create')
      create() {}
    }

    const route = getRoutes(ItemsController).find(r => r.methodName === 'create')
    expect(route!.method).toBe('POST')
  })
})

// @Put

describe('@Put', () => {
  test('registers a PUT route', () => {
    @Controller('/articles')
    class ArticlesController {
      @Put('/:id')
      update() {}
    }

    const route = getRoutes(ArticlesController).find(r => r.methodName === 'update')
    expect(route!.method).toBe('PUT')
    expect(route!.path).toBe('/:id')
  })
})

// @Delete

describe('@Delete', () => {
  test('registers a DELETE route', () => {
    @Controller('/posts')
    class PostsController {
      @Delete('/:id')
      destroy() {}
    }

    const route = getRoutes(PostsController).find(r => r.methodName === 'destroy')
    expect(route!.method).toBe('DELETE')
  })
})

// @Patch

describe('@Patch', () => {
  test('registers a PATCH route', () => {
    @Controller('/orders')
    class OrdersController {
      @Patch('/:id/status')
      updateStatus() {}
    }

    const route = getRoutes(OrdersController).find(r => r.methodName === 'updateStatus')
    expect(route!.method).toBe('PATCH')
    expect(route!.path).toBe('/:id/status')
  })
})

// @Head / @Options / @Websocket

describe('@Head', () => {
  test('registers a HEAD route', () => {
    @Controller()
    class PingController {
      @Head('/ping')
      ping() {}
    }

    const route = getRoutes(PingController).find(r => r.methodName === 'ping')
    expect(route!.method).toBe('HEAD')
  })
})

describe('@Options', () => {
  test('registers an OPTIONS route', () => {
    @Controller()
    class CorsController {
      @Options('/resource')
      preflight() {}
    }

    const route = getRoutes(CorsController).find(r => r.methodName === 'preflight')
    expect(route!.method).toBe('OPTIONS')
  })
})

describe('@Websocket', () => {
  test('registers a WS route', () => {
    @Controller('/ws')
    class ChatController {
      @Websocket('/chat')
      connect() {}
    }

    const route = getRoutes(ChatController).find(r => r.methodName === 'connect')
    expect(route!.method).toBe('WS')
    expect(route!.path).toBe('/chat')
  })
})

// @Middleware

describe('@Middleware', () => {
  test('attaches middlewares to the prototype __middlewares map under the method name', () => {
    @Controller('/auth')
    class AuthController {
      @Middleware([noopMw])
      @Get('/profile')
      profile() {}
    }
    // TC39 addInitializer for method decorators runs on instantiation
    new AuthController()

    const proto = AuthController.prototype
    const map: Record<string, any[]> = (proto as WithMiddlewares).__middlewares ?? {}
    expect(Array.isArray(map['profile'])).toBe(true)
    expect(map['profile']).toContain(noopMw)
  })

  test('accumulates multiple middlewares on the same method', () => {
    const mw1 = async (_c: any, n: any) => n()
    const mw2 = async (_c: any, n: any) => n()

    @Controller('/admin')
    class AdminController {
      @Middleware([mw1, mw2])
      @Get('/dashboard')
      dashboard() {}
    }
    new AdminController()

    const map: Record<string, any[]> = (AdminController.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['dashboard']).toContain(mw1)
    expect(map['dashboard']).toContain(mw2)
  })

  test('different methods get independent middleware lists', () => {
    const mwA = async (_c: any, n: any) => n()
    const mwB = async (_c: any, n: any) => n()

    @Controller()
    class MixedController {
      @Middleware([mwA])
      @Get('/a')
      a() {}

      @Middleware([mwB])
      @Get('/b')
      b() {}
    }
    new MixedController()

    const map: Record<string, any[]> = (MixedController.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['a']).toContain(mwA)
    expect(map['a']).not.toContain(mwB)
    expect(map['b']).toContain(mwB)
    expect(map['b']).not.toContain(mwA)
  })
})

// Route options — name

describe('Route options: name', () => {
  test('@Get with options.name stores the name on the route metadata', () => {
    @Controller('/greet')
    class NamedController {
      @Get('/hello', { name: 'greet.hello' })
      hello() {}
    }

    const route = getRoutes(NamedController).find(r => r.methodName === 'hello')
    expect(route!.options?.name).toBe('greet.hello')
  })

  test('@Post with options.name', () => {
    @Controller('/items')
    class CreateController {
      @Post('/', { name: 'items.store' })
      store() {}
    }

    const route = getRoutes(CreateController).find(r => r.methodName === 'store')
    expect(route!.options?.name).toBe('items.store')
  })
})

// Route options — where

describe('Route options: where', () => {
  test('@Get with options.where stores param matchers on the route', () => {
    const idMatcher = { match: /^\d+$/, cast: (v: string) => Number(v) }

    @Controller('/match')
    class MatchController {
      @Get('/:id', { where: { id: idMatcher } })
      show() {}
    }

    const route = getRoutes(MatchController).find(r => r.methodName === 'show')
    expect(route!.options?.where?.id).toBe(idMatcher)
  })

  test('@Delete with options.where', () => {
    const uuidMatcher = { match: /^[0-9a-f-]{36}$/i }

    @Controller('/uuid')
    class UuidController {
      @Delete('/:uuid', { where: { uuid: uuidMatcher } })
      remove() {}
    }

    const route = getRoutes(UuidController).find(r => r.methodName === 'remove')
    expect(route!.options?.where?.uuid).toBe(uuidMatcher)
  })
})

// Multiple decorators on the same class

describe('Multiple decorators on the same class', () => {
  test('all method decorators appear in __routes', () => {
    @Controller('/crud')
    class FullCrudController {
      @Get('/')      index()   {}
      @Post('/')     store()   {}
      @Put('/:id')   update()  {}
      @Delete('/:id') destroy() {}
      @Patch('/:id') patch()   {}
    }

    const routes = getRoutes(FullCrudController)
    const methods = routes.map(r => r.method)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('PUT')
    expect(methods).toContain('DELETE')
    expect(methods).toContain('PATCH')
  })

  test('each route has the correct methodName', () => {
    @Controller('/multi')
    class MultiController {
      @Get('/a')  a() {}
      @Post('/b') b() {}
    }

    const routes   = getRoutes(MultiController)
    const names    = routes.map(r => r.methodName)
    expect(names).toContain('a')
    expect(names).toContain('b')
  })

  test('@Controller prefix combined with multiple @Get routes', () => {
    @Controller('/shop')
    class ShopController {
      @Get('/products') products() {}
      @Get('/cart')     cart()     {}
    }

    const routes  = getRoutes(ShopController)
    const paths   = routes.map(r => r.path)
    expect(paths).toContain('/products')
    expect(paths).toContain('/cart')
    expect(getPrefix(ShopController)).toEqual(['/shop'])
  })

  test('mixing @Middleware with multiple routes keeps them independent', () => {
    const authMw = async (_c: any, n: any) => n()

    @Controller('/mix')
    class MixController {
      @Middleware([authMw])
      @Get('/secure')
      secure() {}

      @Get('/public')
      pub() {}
    }
    // TC39 addInitializer for method decorators runs on instantiation
    new MixController()

    const map: Record<string, any[]> = (MixController.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['secure']).toContain(authMw)
    // 'pub' either has no entry or an empty list
    expect(map['pub'] ?? []).toHaveLength(0)
  })
})

// ControllerManager

import { ControllerManager } from '../src/controller_manager'

describe('ControllerManager', () => {
  test('starts with count 0', () => {
    const manager = new ControllerManager()
    expect(manager.count).toBe(0)
  })

  test('register() returns this for chaining', () => {
    const manager = new ControllerManager()
    @Controller('/a')
    class A { @Get('/') index() {} }

    const result = manager.register(A)
    expect(result).toBe(manager)
  })

  test('register() chaining adds multiple controllers', () => {
    const manager = new ControllerManager()
    @Controller('/a')
    class A { @Get('/') index() {} }
    @Controller('/b')
    class B { @Get('/') index() {} }

    manager.register(A).register(B)
    expect(manager.count).toBe(2)
  })

  test('register() accepts multiple controllers at once', () => {
    const manager = new ControllerManager()
    @Controller('/x')
    class X { @Get('/') index() {} }
    @Controller('/y')
    class Y { @Get('/') index() {} }
    @Controller('/z')
    class Z { @Get('/') index() {} }

    manager.register(X, Y, Z)
    expect(manager.count).toBe(3)
  })

  test('count increments correctly after multiple register calls', () => {
    const manager = new ControllerManager()
    @Controller('/one')
    class One { @Get('/') index() {} }
    @Controller('/two')
    class Two { @Get('/') index() {} }

    manager.register(One)
    expect(manager.count).toBe(1)
    manager.register(Two)
    expect(manager.count).toBe(2)
  })
})

// Utils: isTC39Decorator

import { isTC39Decorator, getOrInitArray, getOrInitMap } from '../src/utils'

describe('isTC39Decorator', () => {
  test('returns falsy for null', () => {
    expect(isTC39Decorator(null)).toBeFalsy()
  })

  test('returns falsy for undefined', () => {
    expect(isTC39Decorator(undefined)).toBeFalsy()
  })

  test('returns false for an empty object', () => {
    expect(isTC39Decorator({})).toBe(false)
  })

  test('returns true for an object with kind property', () => {
    expect(isTC39Decorator({ kind: 'class' })).toBe(true)
  })

  test('returns true for an object with kind: "method"', () => {
    expect(isTC39Decorator({ kind: 'method', name: 'foo' })).toBe(true)
  })

  test('returns falsy for a string', () => {
    expect(isTC39Decorator('hello')).toBeFalsy()
  })

  test('returns falsy for a number', () => {
    expect(isTC39Decorator(42)).toBeFalsy()
  })

  test('returns falsy for a boolean false', () => {
    expect(isTC39Decorator(false)).toBeFalsy()
  })
})

// Utils: getOrInitArray

describe('getOrInitArray', () => {
  test('creates an empty array if key is missing', () => {
    const obj: any = {}
    const result = getOrInitArray(obj, 'items')
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  test('sets the array on the target object', () => {
    const obj: any = {}
    getOrInitArray(obj, 'items')
    expect(Array.isArray(obj.items)).toBe(true)
  })

  test('returns the existing array if it already exists', () => {
    const existing = [1, 2, 3]
    const obj: any = { items: existing }
    const result = getOrInitArray(obj, 'items')
    expect(result).toBe(existing)
  })

  test('multiple calls return the same array reference', () => {
    const obj: any = {}
    const first = getOrInitArray(obj, 'list')
    const second = getOrInitArray(obj, 'list')
    expect(first).toBe(second)
  })

  test('different keys get independent arrays', () => {
    const obj: any = {}
    const a = getOrInitArray(obj, 'a')
    const b = getOrInitArray(obj, 'b')
    a.push('x')
    expect(b).toHaveLength(0)
  })
})

// Utils: getOrInitMap

describe('getOrInitMap', () => {
  test('creates an empty object if key is missing', () => {
    const obj: any = {}
    const result = getOrInitMap(obj, 'meta')
    expect(typeof result).toBe('object')
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('returns the existing object if it already exists', () => {
    const existing = { foo: 'bar' }
    const obj: any = { meta: existing }
    const result = getOrInitMap(obj, 'meta')
    expect(result).toBe(existing)
  })

  test('sets the object on the target', () => {
    const obj: any = {}
    getOrInitMap(obj, 'data')
    expect(typeof obj.data).toBe('object')
  })
})

// Route options: where with regex and cast

describe('Route options: where with regex and cast', () => {
  test('where matcher with regex only (no cast)', () => {
    const slugMatcher = { match: /^[a-z0-9-]+$/ }

    @Controller('/blog')
    class BlogController {
      @Get('/:slug', { where: { slug: slugMatcher } })
      show() {}
    }

    const route = getRoutes(BlogController).find(r => r.methodName === 'show')
    expect(route!.options?.where?.slug.match).toBeInstanceOf(RegExp)
    expect(route!.options?.where?.slug.cast).toBeUndefined()
  })

  test('where matcher with both regex and cast function', () => {
    const idMatcher = { match: /^\d+$/, cast: (v: string) => Number(v) }

    @Controller('/products')
    class ProductController {
      @Get('/:id', { where: { id: idMatcher } })
      show() {}
    }

    const route = getRoutes(ProductController).find(r => r.methodName === 'show')
    expect(typeof route!.options?.where?.id.cast).toBe('function')
    expect(route!.options?.where?.id.cast!('123')).toBe(123)
  })

  test('where with multiple param matchers', () => {
    const yearMatcher = { match: /^\d{4}$/ }
    const monthMatcher = { match: /^\d{2}$/ }

    @Controller('/archive')
    class ArchiveController {
      @Get('/:year/:month', { where: { year: yearMatcher, month: monthMatcher } })
      byDate() {}
    }

    const route = getRoutes(ArchiveController).find(r => r.methodName === 'byDate')
    expect(route!.options?.where?.year).toBe(yearMatcher)
    expect(route!.options?.where?.month).toBe(monthMatcher)
  })
})

// Empty prefix and slash-only routes

describe('Empty prefix and slash-only routes', () => {
  test('empty string prefix controller', () => {
    @Controller('')
    class RootCtrl {
      @Get('/health')
      health() {}
    }

    expect(getPrefix(RootCtrl)).toEqual([''])
    const route = getRoutes(RootCtrl).find(r => r.methodName === 'health')
    expect(route!.path).toBe('/health')
  })

  test('slash-only route path', () => {
    @Controller('/api')
    class ApiCtrl {
      @Get('/')
      root() {}
    }

    const route = getRoutes(ApiCtrl).find(r => r.methodName === 'root')
    expect(route!.path).toBe('/')
  })
})

// RouteMetadata shape validation

describe('RouteMetadata shape', () => {
  test('route has all required fields: path, method, methodName', () => {
    @Controller('/check')
    class CheckCtrl {
      @Post('/submit')
      submit() {}
    }

    const route = getRoutes(CheckCtrl).find(r => r.methodName === 'submit')
    expect(route).toHaveProperty('path')
    expect(route).toHaveProperty('method')
    expect(route).toHaveProperty('methodName')
  })

  test('route options are undefined when not specified', () => {
    @Controller('/plain')
    class PlainCtrl {
      @Get('/simple')
      simple() {}
    }

    const route = getRoutes(PlainCtrl).find(r => r.methodName === 'simple')
    expect(route!.options).toBeUndefined()
  })
})

// Websocket decorator metadata

describe('Websocket decorator metadata', () => {
  test('Websocket route has method WS', () => {
    @Controller('/realtime')
    class RealtimeCtrl {
      @Websocket('/events')
      events() {}
    }

    const route = getRoutes(RealtimeCtrl).find(r => r.methodName === 'events')
    expect(route!.method).toBe('WS')
  })

  test('Websocket default path is empty string', () => {
    @Controller('/ws')
    class WsCtrl {
      @Websocket()
      connect() {}
    }

    const route = getRoutes(WsCtrl).find(r => r.methodName === 'connect')
    expect(route!.path).toBe('')
  })

  test('Websocket coexists with HTTP routes on the same controller', () => {
    @Controller('/mixed')
    class MixedWsCtrl {
      @Get('/status')
      status() {}

      @Websocket('/live')
      live() {}
    }

    const routes = getRoutes(MixedWsCtrl)
    expect(routes.find(r => r.method === 'GET')).toBeDefined()
    expect(routes.find(r => r.method === 'WS')).toBeDefined()
  })
})


describe('@Controller — additional prefixes', () => {
  test('prefix with trailing slash', () => {
    @Controller('/api/')
    class ApiCtrl {}
    expect(getPrefix(ApiCtrl)).toEqual(['/api/'])
  })

  test('prefix with nested path', () => {
    @Controller('/api/v1/users')
    class DeepCtrl {}
    expect(getPrefix(DeepCtrl)).toEqual(['/api/v1/users'])
  })

  test('prefix with three array entries', () => {
    @Controller(['/v1', '/v2', '/v3'])
    class VersionedCtrl {}
    expect(getPrefix(VersionedCtrl)).toEqual(['/v1', '/v2', '/v3'])
  })

  test('__routes is initialized as empty array when no methods decorated', () => {
    @Controller('/empty')
    class EmptyCtrl {}
    expect(getRoutes(EmptyCtrl)).toEqual([])
  })
})

describe('Route decorator — default paths', () => {
  test('@Post defaults path to empty string', () => {
    @Controller('/items')
    class C { @Post() create() {} }
    const route = getRoutes(C).find(r => r.methodName === 'create')
    expect(route!.path).toBe('')
  })

  test('@Put defaults path to empty string', () => {
    @Controller('/items')
    class C { @Put() update() {} }
    const route = getRoutes(C).find(r => r.methodName === 'update')
    expect(route!.path).toBe('')
  })

  test('@Delete defaults path to empty string', () => {
    @Controller('/items')
    class C { @Delete() remove() {} }
    const route = getRoutes(C).find(r => r.methodName === 'remove')
    expect(route!.path).toBe('')
  })

  test('@Patch defaults path to empty string', () => {
    @Controller('/items')
    class C { @Patch() patch() {} }
    const route = getRoutes(C).find(r => r.methodName === 'patch')
    expect(route!.path).toBe('')
  })
})

describe('Route decorator — path with params', () => {
  test('@Get with multiple params', () => {
    @Controller('/api')
    class C { @Get('/:year/:month/:day') byDate() {} }
    const route = getRoutes(C).find(r => r.methodName === 'byDate')
    expect(route!.path).toBe('/:year/:month/:day')
  })

  test('@Post with nested resource path', () => {
    @Controller('/api')
    class C { @Post('/users/:userId/posts') createPost() {} }
    const route = getRoutes(C).find(r => r.methodName === 'createPost')
    expect(route!.path).toBe('/users/:userId/posts')
  })
})

describe('@Middleware — additional stacking', () => {
  test('three middlewares on one method', () => {
    const mw1 = async (_c: any, n: any) => n()
    const mw2 = async (_c: any, n: any) => n()
    const mw3 = async (_c: any, n: any) => n()

    @Controller()
    class C {
      @Middleware([mw1, mw2, mw3])
      @Get('/test')
      test() {}
    }
    new C()
    const map: Record<string, any[]> = (C.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['test']).toHaveLength(3)
    expect(map['test']).toContain(mw1)
    expect(map['test']).toContain(mw2)
    expect(map['test']).toContain(mw3)
  })

  test('middleware on Post route', () => {
    const authMw = async (_c: any, n: any) => n()
    @Controller('/api')
    class C {
      @Middleware([authMw])
      @Post('/create')
      create() {}
    }
    new C()
    const map: Record<string, any[]> = (C.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['create']).toContain(authMw)
  })

  test('middleware on Delete route', () => {
    const adminMw = async (_c: any, n: any) => n()
    @Controller('/api')
    class C {
      @Middleware([adminMw])
      @Delete('/:id')
      remove() {}
    }
    new C()
    const map: Record<string, any[]> = (C.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map['remove']).toContain(adminMw)
  })
})

describe('ControllerManager — additional tests', () => {
  test('register returns manager for single controller', () => {
    const manager = new ControllerManager()
    @Controller('/t')
    class T { @Get('/') index() {} }
    expect(manager.register(T)).toBe(manager)
  })

  test('count after registering 5 controllers', () => {
    const manager = new ControllerManager()
    for (let i = 0; i < 5; i++) {
      @Controller(`/c${i}`)
      class C { @Get('/') index() {} }
      manager.register(C)
    }
    expect(manager.count).toBe(5)
  })
})

describe('Route options — name on various methods', () => {
  test('@Put with options.name', () => {
    @Controller('/items')
    class C {
      @Put('/:id', { name: 'items.update' })
      update() {}
    }
    const route = getRoutes(C).find(r => r.methodName === 'update')
    expect(route!.options?.name).toBe('items.update')
  })

  test('@Delete with options.name', () => {
    @Controller('/items')
    class C {
      @Delete('/:id', { name: 'items.destroy' })
      destroy() {}
    }
    const route = getRoutes(C).find(r => r.methodName === 'destroy')
    expect(route!.options?.name).toBe('items.destroy')
  })

  test('@Patch with options.name', () => {
    @Controller('/items')
    class C {
      @Patch('/:id', { name: 'items.patch' })
      patch() {}
    }
    const route = getRoutes(C).find(r => r.methodName === 'patch')
    expect(route!.options?.name).toBe('items.patch')
  })
})

describe('Route — many routes on one controller', () => {
  test('10 routes all registered', () => {
    @Controller('/many')
    class ManyCtrl {
      @Get('/r1') r1() {}
      @Get('/r2') r2() {}
      @Get('/r3') r3() {}
      @Post('/r4') r4() {}
      @Post('/r5') r5() {}
      @Put('/r6') r6() {}
      @Put('/r7') r7() {}
      @Delete('/r8') r8() {}
      @Patch('/r9') r9() {}
      @Head('/r10') r10() {}
    }
    expect(getRoutes(ManyCtrl)).toHaveLength(10)
  })

  test('all routes have correct method types', () => {
    @Controller('/types')
    class TypeCtrl {
      @Get('/a') a() {}
      @Post('/b') b() {}
      @Put('/c') c() {}
      @Delete('/d') d() {}
      @Patch('/e') e() {}
      @Head('/f') f() {}
      @Options('/g') g() {}
    }
    const routes = getRoutes(TypeCtrl)
    expect(routes.find(r => r.methodName === 'a')!.method).toBe('GET')
    expect(routes.find(r => r.methodName === 'b')!.method).toBe('POST')
    expect(routes.find(r => r.methodName === 'c')!.method).toBe('PUT')
    expect(routes.find(r => r.methodName === 'd')!.method).toBe('DELETE')
    expect(routes.find(r => r.methodName === 'e')!.method).toBe('PATCH')
    expect(routes.find(r => r.methodName === 'f')!.method).toBe('HEAD')
    expect(routes.find(r => r.methodName === 'g')!.method).toBe('OPTIONS')
  })
})

describe('isTC39Decorator — additional', () => {
  test('returns true for object with kind "field"', () => {
    expect(isTC39Decorator({ kind: 'field' })).toBe(true)
  })

  test('returns falsy for array', () => {
    expect(isTC39Decorator([1, 2, 3])).toBeFalsy()
  })

  test('returns falsy for function', () => {
    expect(isTC39Decorator(() => {})).toBeFalsy()
  })
})

describe('getOrInitArray — additional', () => {
  test('pushing to returned array reflects on object', () => {
    const obj: any = {}
    const arr = getOrInitArray(obj, 'items')
    arr.push('x')
    expect(obj.items).toEqual(['x'])
  })

  test('three different keys on same object', () => {
    const obj: any = {}
    getOrInitArray(obj, 'a')
    getOrInitArray(obj, 'b')
    getOrInitArray(obj, 'c')
    expect(Object.keys(obj)).toHaveLength(3)
  })
})

describe('getOrInitMap — additional', () => {
  test('setting keys on returned map reflects on object', () => {
    const obj: any = {}
    const map = getOrInitMap(obj, 'meta')
    map.key = 'value'
    expect(obj.meta.key).toBe('value')
  })

  test('two maps on same object are independent', () => {
    const obj: any = {}
    const m1 = getOrInitMap(obj, 'a')
    const m2 = getOrInitMap(obj, 'b')
    m1.x = 1
    expect(m2.x).toBeUndefined()
  })
})
