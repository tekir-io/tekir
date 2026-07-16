import { test, expect, describe } from 'bun:test'
import { Router } from '../src/router/router'
import { TekirServer } from '../src/server/server'
import type { RouteHandler, MiddlewareFunction } from '../src/http/types'

// Helpers

const noop: RouteHandler = () => {}
const mw: MiddlewareFunction = async (_ctx, next) => next()

function freshRouter() {
  return new Router()
}

// HTTP method registration — get / post / put / delete / patch / any

describe('HTTP method helpers', () => {
  test('get() registers a GET route', () => {
    const r = freshRouter()
    r.get('/users', noop)
    r.compile()
    const m = r.match('GET', '/users')
    expect(m).not.toBeNull()
    expect(m!.route.pattern).toBe('/users')
  })

  test('post() registers a POST route', () => {
    const r = freshRouter()
    r.post('/users', noop)
    r.compile()
    expect(r.match('POST', '/users')).not.toBeNull()
  })

  test('put() registers a PUT route', () => {
    const r = freshRouter()
    r.put('/users/:id', noop)
    r.compile()
    const m = r.match('PUT', '/users/42')
    expect(m).not.toBeNull()
    expect(m!.params.id).toBe('42')
  })

  test('delete() registers a DELETE route', () => {
    const r = freshRouter()
    r.delete('/users/:id', noop)
    r.compile()
    expect(r.match('DELETE', '/users/1')).not.toBeNull()
  })

  test('patch() registers a PATCH route', () => {
    const r = freshRouter()
    r.patch('/items/:id', noop)
    r.compile()
    expect(r.match('PATCH', '/items/5')).not.toBeNull()
  })

  test('any() matches any HTTP method', () => {
    const r = freshRouter()
    r.any('/ping', noop)
    r.compile()
    // The trie stores it as 'ANY' and falls back for all methods
    expect(r.match('ANY', '/ping')).not.toBeNull()
  })

  test('returns a RouteBuilder for chaining', () => {
    const r = freshRouter()
    const builder = r.get('/x', noop)
    // RouteBuilder exposes .as(), .use(), .where()
    expect(typeof builder.as).toBe('function')
    expect(typeof builder.use).toBe('function')
    expect(typeof builder.where).toBe('function')
  })
})

// route() — multiple methods on one path

describe('route()', () => {
  test('registers the same handler under multiple methods', () => {
    const r = freshRouter()
    r.route('/health', ['GET', 'HEAD'], noop)
    r.compile()
    expect(r.match('GET',  '/health')).not.toBeNull()
    expect(r.match('HEAD', '/health')).not.toBeNull()
    expect(r.match('POST', '/health')).toBeNull()
  })

  test('returns a RouteBuilder for the first method', () => {
    const r = freshRouter()
    const builder = r.route('/x', ['GET', 'POST'], noop)
    expect(typeof builder.as).toBe('function')
  })
})

// group() with prefix

describe('group() with prefix', () => {
  test('prepends prefix to every route in the group', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/profile', noop)
      r.post('/login',  noop)
    }).prefix('/api/v1')
    r.compile()

    expect(r.match('GET',  '/api/v1/profile')).not.toBeNull()
    expect(r.match('POST', '/api/v1/login')).not.toBeNull()
    // Plain path must not exist
    expect(r.match('GET', '/profile')).toBeNull()
  })

  test('prefix without leading slash is normalised', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/items', noop)
    }).prefix('v2')
    r.compile()
    expect(r.match('GET', '/v2/items')).not.toBeNull()
  })

  test('nested groups accumulate prefixes', () => {
    const r = freshRouter()
    r.group(() => {
      r.group(() => {
        r.get('/ping', noop)
      }).prefix('/inner')
    }).prefix('/outer')
    r.compile()
    expect(r.match('GET', '/outer/inner/ping')).not.toBeNull()
  })

  test('group middleware is applied to all routes in the group', () => {
    const r = freshRouter()
    const log: MiddlewareFunction = async (_ctx, next) => next()
    r.group(() => {
      r.get('/x', noop)
    }).prefix('/g').use(log)
    r.compile()
    const m = r.match('GET', '/g/x')
    expect(m).not.toBeNull()
    expect(m!.route.middlewares).toContain(log)
  })

  test('group .as() prefixes route names', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/dashboard', noop).as('dashboard')
    }).prefix('/admin').as('admin')
    r.compile()
    // Named route should be accessible
    const url = r.makeUrl('admin.dashboard')
    expect(url).toBe('/admin/dashboard')
  })
})

// resource() — CRUD routes

describe('resource()', () => {
  class PostsController {
    index()   { return 'index'   }
    create()  { return 'create'  }
    store()   { return 'store'   }
    show()    { return 'show'    }
    edit()    { return 'edit'    }
    update()  { return 'update'  }
    destroy() { return 'destroy' }
  }

  test('registers all 7 standard CRUD routes', () => {
    const r = freshRouter()
    r.resource('posts', PostsController)
    r.compile()

    expect(r.match('GET',    '/posts')).not.toBeNull()           // index
    expect(r.match('GET',    '/posts/create')).not.toBeNull()    // create
    expect(r.match('POST',   '/posts')).not.toBeNull()           // store
    expect(r.match('GET',    '/posts/1')).not.toBeNull()         // show
    expect(r.match('GET',    '/posts/1/edit')).not.toBeNull()    // edit
    expect(r.match('PUT',    '/posts/1')).not.toBeNull()         // update
    expect(r.match('DELETE', '/posts/1')).not.toBeNull()         // destroy
  })

  test('.only() restricts to the given action names', () => {
    const r = freshRouter()
    r.resource('posts', PostsController).only(['index', 'show'])
    r.compile()

    expect(r.match('GET', '/posts')).not.toBeNull()
    expect(r.match('GET', '/posts/1')).not.toBeNull()
    expect(r.match('POST', '/posts')).toBeNull()
    expect(r.match('DELETE', '/posts/1')).toBeNull()
  })

  test('.except() excludes specified action names', () => {
    const r = freshRouter()
    r.resource('posts', PostsController).except(['create', 'edit'])
    r.compile()

    // The named 'create' route should not exist — makeUrl throws for unknown names
    expect(() => r.makeUrl('posts.create')).toThrow()
    // The named 'edit' route should not exist
    expect(() => r.makeUrl('posts.edit')).toThrow()
    // '/posts/1/edit' has no dedicated route (edit was excluded) so it won't match
    expect(r.match('GET', '/posts/1/edit')).toBeNull()
    // Other routes remain
    expect(r.match('GET', '/posts')).not.toBeNull()
  })

  test('.apiOnly() excludes create and edit routes', () => {
    const r = freshRouter()
    r.resource('posts', PostsController).apiOnly()
    r.compile()

    // The named 'create' route should not exist — makeUrl throws for unknown names
    expect(() => r.makeUrl('posts.create')).toThrow()
    // The named 'edit' route should not exist
    expect(() => r.makeUrl('posts.edit')).toThrow()
    // '/posts/1/edit' has no dedicated route (edit was excluded) so it won't match
    expect(r.match('GET', '/posts/1/edit')).toBeNull()
    // Other routes remain
    expect(r.match('GET', '/posts')).not.toBeNull()
    expect(r.match('POST', '/posts')).not.toBeNull()
  })

  test('names each route as <basePath>.<action>', () => {
    const r = freshRouter()
    r.resource('posts', PostsController)
    r.compile()
    // index route is named 'posts.index'
    const url = r.makeUrl('posts.index')
    expect(url).toBe('/posts')
  })
})

// useGlobal() — global middleware

describe('useGlobal()', () => {
  test('adds middleware to globalMiddlewares list', () => {
    const r = freshRouter()
    r.useGlobal(mw)
    expect(r.globalMiddlewares).toContain(mw)
  })

  test('accepts an array of middlewares', () => {
    const r = freshRouter()
    const m1: MiddlewareFunction = async (_c, n) => n()
    const m2: MiddlewareFunction = async (_c, n) => n()
    r.useGlobal([m1, m2])
    expect(r.globalMiddlewares).toContain(m1)
    expect(r.globalMiddlewares).toContain(m2)
  })

  test('returns this for chaining', () => {
    const r = freshRouter()
    expect(r.useGlobal(mw)).toBe(r)
  })
})

// useRouter() — router-level middleware

describe('useRouter()', () => {
  test('adds middleware to routerMiddlewares list', () => {
    const r = freshRouter()
    r.useRouter(mw)
    expect(r.routerMiddlewares).toContain(mw)
  })

  test('router middleware is prepended to every route after compile()', () => {
    const r = freshRouter()
    const routerMw: MiddlewareFunction = async (_c, n) => n()
    const routeMw: MiddlewareFunction  = async (_c, n) => n()
    r.useRouter(routerMw)
    r.get('/x', noop).use(routeMw)
    r.compile()
    const m = r.match('GET', '/x')
    expect(m!.route.middlewares[0]).toBe(routerMw)
    expect(m!.route.middlewares[1]).toBe(routeMw)
  })

  test('returns this for chaining', () => {
    const r = freshRouter()
    expect(r.useRouter(mw)).toBe(r)
  })
})

// where() — global param matcher

describe('where()', () => {
  test('stores the matcher and returns this for chaining', () => {
    const r = freshRouter()
    const result = r.where('id', { match: /^\d+$/ })
    expect(result).toBe(r)
  })

  test('global where matcher is applied to route handlers after compile()', () => {
    const r = freshRouter()
    r.where('id', { match: /^\d+$/ })

    let calledWith: any = null
    r.get('/posts/:id', (ctx: any) => { calledWith = ctx })
    r.compile()

    // Simulate a match: the wrapped handler should reject non-numeric id
    const m = r.match('GET', '/posts/abc')
    expect(m).not.toBeNull()
    // The handler itself will reject; simulate calling it with a fake ctx
    const fakeCtx: any = {
      params: { id: 'abc' },
      response: { notFound: (body: any) => new Response(JSON.stringify(body), { status: 404 }) },
    }
    const result = m!.route.handler(fakeCtx)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
  })

  test('global where casts param if cast function is provided', () => {
    const r = freshRouter()
    r.where('id', { match: /^\d+$/, cast: (v) => Number(v) })

    let capturedCtx: any = null
    r.get('/items/:id', (ctx: any) => { capturedCtx = ctx })
    r.compile()

    const m = r.match('GET', '/items/7')
    const fakeCtx: any = {
      params: { id: '7' },
      response: { notFound: (b: any) => new Response(JSON.stringify(b), { status: 404 }) },
    }
    m!.route.handler(fakeCtx)
    expect(capturedCtx?.params.id).toBe(7)
  })
})

// named() — lazy named middleware map


// on().json() — brisk route

describe('on().json()', () => {
  test('registers a GET route that returns the given data', () => {
    const r = freshRouter()
    r.on('/health').json({ status: 'ok' })
    r.compile()
    const m = r.match('GET', '/health')
    expect(m).not.toBeNull()
    const result = m!.route.handler({} as any)
    expect(result).toEqual({ status: 'ok' })
  })

  test('returns a RouteBuilder', () => {
    const r = freshRouter()
    const builder = r.on('/x').json({})
    expect(typeof builder.as).toBe('function')
  })
})

// on().redirect() — brisk route

describe('on().redirect()', () => {
  test('registers a GET route that returns a 302 redirect response', () => {
    const r = freshRouter()
    r.on('/old').redirect('/new')
    r.compile()
    const m = r.match('GET', '/old')
    expect(m).not.toBeNull()
    const res = m!.route.handler({} as any) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/new')
  })

  test('uses custom status code when supplied', () => {
    const r = freshRouter()
    r.on('/gone').redirect('/elsewhere', 301)
    r.compile()
    const m = r.match('GET', '/gone')
    const res = m!.route.handler({} as any) as Response
    expect(res.status).toBe(301)
  })
})

describe('on().render()', () => {
  test('calls component function with props', () => {
    const r = freshRouter()
    const component = (props: any) => ({ html: `<h1>${props.title}</h1>` })
    r.on('/about').render(component, { title: 'About' })
    r.compile()
    const m = r.match('GET', '/about')
    expect(m).not.toBeNull()
    const result = m!.route.handler({} as any)
    expect(result).toEqual({ html: '<h1>About</h1>' })
  })
})

describe('on().redirectToPath()', () => {
  test('redirects to a path with 302', () => {
    const r = freshRouter()
    r.on('/legacy').redirectToPath('/modern')
    r.compile()
    const m = r.match('GET', '/legacy')
    const res = m!.route.handler({} as any) as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/modern')
  })
})

// makeUrl() — URL generation from named routes

describe('makeUrl()', () => {
  test('returns the plain path for a route with no params', () => {
    const r = freshRouter()
    r.get('/about', noop).as('about')
    r.compile()
    expect(r.makeUrl('about')).toBe('/about')
  })

  test('substitutes named params', () => {
    const r = freshRouter()
    r.get('/users/:id', noop).as('users.show')
    r.compile()
    expect(r.makeUrl('users.show', { id: '42' })).toBe('/users/42')
  })

  test('appends query string when qs is provided', () => {
    const r = freshRouter()
    r.get('/search', noop).as('search')
    r.compile()
    const url = r.makeUrl('search', {}, { q: 'hello', page: '2' })
    expect(url).toContain('q=hello')
    expect(url).toContain('page=2')
  })

  test('throws for an unknown named route', () => {
    const r = freshRouter()
    r.compile()
    expect(() => r.makeUrl('ghost')).toThrow('Route "ghost" not found')
  })

  test('removes unfilled optional params from URL', () => {
    const r = freshRouter()
    // Register with optional param
    r.get('/posts/:slug?', noop).as('posts.show')
    r.compile()
    const url = r.makeUrl('posts.show', {})
    expect(url).not.toContain(':slug')
  })
})

// compile()

describe('compile()', () => {
  test('makes previously registered routes matchable', () => {
    const r = freshRouter()
    r.get('/compile-me', noop)
    // Not matchable before compile
    expect(r.match('GET', '/compile-me')).toBeNull()
    r.compile()
    expect(r.match('GET', '/compile-me')).not.toBeNull()
  })

  test('processes pending resources during compile', () => {
    class ArticleController {
      index()   { return 'index'   }
      store()   { return 'store'   }
      show()    { return 'show'    }
      update()  { return 'update'  }
      destroy() { return 'destroy' }
    }
    const r = freshRouter()
    r.resource('articles', ArticleController).apiOnly()
    r.compile()
    expect(r.match('GET', '/articles')).not.toBeNull()
  })

  test('processes pending groups during compile', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/me', noop)
    }).prefix('/user')
    r.compile()
    expect(r.match('GET', '/user/me')).not.toBeNull()
  })

  test('router-level middleware is attached to compiled route', () => {
    const r = freshRouter()
    const m1: MiddlewareFunction = async (_c, n) => n()
    r.useRouter(m1)
    r.get('/t', noop)
    r.compile()
    const match = r.match('GET', '/t')
    expect(match!.route.middlewares).toContain(m1)
  })
})

// Lifecycle Hooks — via TekirServer.handle()

function createServer() {
  const server = new TekirServer()
  const router = server.getRouter()
  return { server, router }
}

function req(path: string, method = 'GET') {
  return new Request(`http://localhost${path}`, { method })
}

describe('Lifecycle hooks — onRequest', () => {
  test('onRequest runs before route handler', async () => {
    const { server, router } = createServer()
    const order: string[] = []

    router.onRequest((ctx) => { order.push('onRequest') })
    router.get('/test', () => { order.push('handler'); return { ok: true } })

    const res = await server.handle(req('/test'))
    expect(res.status).toBe(200)
    expect(order).toEqual(['onRequest', 'handler'])
  })

  test('onRequest returning Response short-circuits handler', async () => {
    const { server, router } = createServer()
    let handlerCalled = false

    router.onRequest(() => new Response('blocked', { status: 403 }))
    router.get('/test', () => { handlerCalled = true; return { ok: true } })

    const res = await server.handle(req('/test'))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('blocked')
    expect(handlerCalled).toBe(false)
  })

  test('multiple onRequest hooks run in order', async () => {
    const { server, router } = createServer()
    const order: number[] = []

    router.onRequest(() => { order.push(1) })
    router.onRequest(() => { order.push(2) })
    router.get('/test', () => ({ ok: true }))

    await server.handle(req('/test'))
    expect(order).toEqual([1, 2])
  })
})

describe('Lifecycle hooks — onBeforeHandle', () => {
  test('onBeforeHandle runs after onRequest, before handler', async () => {
    const { server, router } = createServer()
    const order: string[] = []

    router.onRequest(() => { order.push('onRequest') })
    router.onBeforeHandle(() => { order.push('onBeforeHandle') })
    router.get('/test', () => { order.push('handler'); return { ok: true } })

    await server.handle(req('/test'))
    expect(order).toEqual(['onRequest', 'onBeforeHandle', 'handler'])
  })

  test('onBeforeHandle returning Response short-circuits handler', async () => {
    const { server, router } = createServer()
    let handlerCalled = false

    router.onBeforeHandle(() => new Response('early', { status: 200 }))
    router.get('/test', () => { handlerCalled = true; return { ok: true } })

    const res = await server.handle(req('/test'))
    expect(await res.text()).toBe('early')
    expect(handlerCalled).toBe(false)
  })
})

describe('Lifecycle hooks — onAfterHandle', () => {
  test('onAfterHandle runs after handler', async () => {
    const { server, router } = createServer()
    const order: string[] = []

    router.onAfterHandle(() => { order.push('onAfterHandle') })
    router.get('/test', () => { order.push('handler'); return { ok: true } })

    await server.handle(req('/test'))
    expect(order).toEqual(['handler', 'onAfterHandle'])
  })

  test('onAfterHandle can modify ctx.$result', async () => {
    const { server, router } = createServer()

    router.onAfterHandle((ctx) => {
      return Response.json({ modified: true })
    })
    router.get('/test', () => ({ original: true }))

    const res = await server.handle(req('/test'))
    const body = await res.json()
    expect(body.modified).toBe(true)
  })
})

describe('Lifecycle hooks — onAfterResponse', () => {
  test('onAfterResponse fires after response', async () => {
    const { server, router } = createServer()
    let fired = false

    router.onAfterResponse(() => { fired = true })
    router.get('/test', () => ({ ok: true }))

    await server.handle(req('/test'))
    // onAfterResponse is fire-and-forget, give it a tick
    await new Promise(r => setTimeout(r, 10))
    expect(fired).toBe(true)
  })
})

describe('response.redirect.back — compiled path', () => {
  test('honors same-origin referer', async () => {
    const { server, router } = createServer()
    router.get('/back', ({ response }) => response.redirect.back())

    const res = await server.handle(new Request('http://app.example/back', {
      headers: { referer: 'http://app.example/dashboard?tab=stats', host: 'app.example' },
    }))

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/dashboard?tab=stats')
  })

  test('cross-origin referer ignored, falls back to provided URL', async () => {
    const { server, router } = createServer()
    router.get('/back', ({ response }) => response.redirect.back('/login'))

    const res = await server.handle(new Request('http://app.example/back', {
      headers: { referer: 'http://evil.example/phish', host: 'app.example' },
    }))

    expect(res.headers.get('Location')).toBe('/login')
  })

  test('plain redirect still works on same handler family', async () => {
    const { server, router } = createServer()
    router.get('/r', ({ response }) => response.redirect('/somewhere', 301))

    const res = await server.handle(new Request('http://app.example/r'))
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/somewhere')
  })
})

describe('stateful response helpers — compiled path', () => {
  function stageLoginResponse(response: any) {
    response.header('X-Auth-Flow', 'login')
    response.cookie('access_token', 'db-token', { httpOnly: true, sameSite: 'Lax' })
  }

  test('preserves headers and cookies staged by a delegated helper', async () => {
    const { server, router } = createServer()
    router.post('/login', ({ response }: any) => {
      stageLoginResponse(response)
      return response.ok({ authenticated: true })
    })

    const res = await server.handle(new Request('http://x/login', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Auth-Flow')).toBe('login')
    expect(res.headers.get('Set-Cookie')).toContain('access_token=db-token')
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly')
  })

  test('exposes response methods that do not exist on the static fast helper', async () => {
    const { server, router } = createServer()
    router.get('/helpers', ({ response }: any) => {
      response.signedCookie('session', 'value', 'secret')
      return response.ok({
        attachment: typeof response.attachment,
        encryptedCookie: typeof response.encryptedCookie,
      })
    })

    const res = await server.handle(new Request('http://x/helpers'))
    expect(await res.json()).toEqual({ attachment: 'function', encryptedCookie: 'function' })
    expect(res.headers.get('Set-Cookie')).toContain('session=')
  })

  test('clearCookie is applied to the returned response', async () => {
    const { server, router } = createServer()
    router.post('/logout', ({ response }: any) => {
      response.clearCookie('access_token')
      return response.noContent()
    })

    const res = await server.handle(new Request('http://x/logout', { method: 'POST' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Set-Cookie')).toContain('access_token=; Max-Age=0; Path=/')
  })
})

describe('OPTIONS preflight on method-mismatched routes', () => {
  test('synthetic OPTIONS handler responds 204 even when path has only POST', async () => {
    const { server, router } = createServer()
    router.post('/login', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/login', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
  })

  test('synthetic OPTIONS runs global middleware so cors() can short-circuit', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any) => {
      const method = ctx.request?.method || ctx.request?.raw?.method
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': 'https://app.example',
            'Access-Control-Allow-Methods': 'POST',
          },
        })
      }
    })
    router.post('/login', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/login', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example' },
    }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example')
  })

  test('explicit OPTIONS handler is preserved (not overwritten by synthetic)', async () => {
    const { server, router } = createServer()
    router.post('/r', () => ({}))
    ;(router as any).route?.('/r', ['OPTIONS'], () => new Response('explicit', { status: 200 }))
    // Fallback to direct registration via .any() for the explicit OPTIONS:
    router.any('/explicit', ({ request }: any) => {
      if (request.method === 'OPTIONS') return new Response('explicit-any', { status: 200 })
      return new Response('any', { status: 200 })
    })

    const res = await server.handle(new Request('http://x/explicit', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('explicit-any')
  })
})

describe('ctx.request URL conveniences', () => {
  test('exposes path, host, hostname, protocol, origin, completeUrl', async () => {
    const { server, router } = createServer()
    let snapshot: any = null
    router.get('/foo/bar', ({ request }: any) => {
      snapshot = {
        path: request.path,
        host: request.host,
        hostname: request.hostname,
        protocol: request.protocol,
        origin: request.origin,
        completeUrl: request.completeUrl,
      }
      return { ok: true }
    })

    await server.handle(new Request('http://app.example:8080/foo/bar?x=1'))
    expect(snapshot).toEqual({
      path: '/foo/bar',
      host: 'app.example:8080',
      hostname: 'app.example',
      protocol: 'http:',
      origin: 'http://app.example:8080',
      completeUrl: 'http://app.example:8080/foo/bar?x=1',
    })
  })

  test('skips URL parse in the compiled handler when no URL props are used', async () => {
    const { server, router } = createServer()
    const originalURL = globalThis.URL
    // server.handle() always builds one URL for path matching, so the
    // baseline is 1 construction per request. Anything above that means
    // the compiled handler also parsed, which we want to avoid for
    // routes that only read `request.method` / `request.url`.
    let constructed = 0
    class CountingURL extends originalURL {
      constructor(input: string | URL, base?: string | URL) {
        constructed++
        super(input as any, base as any)
      }
    }
    ;(globalThis as any).URL = CountingURL
    try {
      router.get('/light', ({ request }: any) => ({ method: request.method, url: request.url }))
      await server.handle(new Request('http://x/light'))
      expect(constructed).toBe(1)
    } finally {
      ;(globalThis as any).URL = originalURL
    }
  })

  test('parses URL once in the compiled handler when URL props are used', async () => {
    const { server, router } = createServer()
    const originalURL = globalThis.URL
    let constructed = 0
    class CountingURL extends originalURL {
      constructor(input: string | URL, base?: string | URL) {
        constructed++
        super(input as any, base as any)
      }
    }
    ;(globalThis as any).URL = CountingURL
    try {
      // Reading `path` ten times should still parse only once thanks to the
      // upfront `_u` binding in the compiled handler.
      router.get('/heavy', ({ request }: any) => {
        let acc = ''
        for (let i = 0; i < 10; i++) acc += request.path
        return { len: acc.length }
      })
      await server.handle(new Request('http://x/heavy'))
      // 1 from server.handle() + 1 from the compiled handler = 2 total.
      expect(constructed).toBe(2)
    } finally {
      ;(globalThis as any).URL = originalURL
    }
  })
})

describe('ctx.$responseHeaders — framework merge', () => {
  test('headers written by middleware land on a plain JSON response', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any, next) => {
      ctx.$responseHeaders ??= new Headers()
      ctx.$responseHeaders.set('X-Trace-Id', 'abc')
      await next()
    })
    router.get('/x', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/x'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Trace-Id')).toBe('abc')
    expect(await res.json()).toEqual({ ok: true })
  })

  test('headers land on a handler-returned Response too', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any, next) => {
      ctx.$responseHeaders ??= new Headers()
      ctx.$responseHeaders.set('X-Trace-Id', 'def')
      await next()
    })
    router.get('/x', () => new Response('hi', { status: 201, headers: { 'X-Custom': '1' } }))

    const res = await server.handle(new Request('http://x/x'))
    expect(res.status).toBe(201)
    expect(res.headers.get('X-Custom')).toBe('1')
    expect(res.headers.get('X-Trace-Id')).toBe('def')
  })

  test('headers land on framework-handled errors (post-throw 500)', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any, next) => {
      ctx.$responseHeaders ??= new Headers()
      ctx.$responseHeaders.set('Access-Control-Allow-Origin', 'https://app.com')
      await next()
    })
    router.get('/boom', () => { throw new Error('boom') })

    const res = await server.handle(new Request('http://x/boom'))
    expect(res.status).toBe(500)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('Vary is appended (not overwritten) when both handler and middleware set it', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any, next) => {
      ctx.$responseHeaders ??= new Headers()
      ctx.$responseHeaders.set('Vary', 'Origin')
      await next()
    })
    router.get('/x', () => new Response('cached', { headers: { Vary: 'Accept-Encoding' } }))

    const res = await server.handle(new Request('http://x/x'))
    const vary = (res.headers.get('Vary') ?? '').toLowerCase()
    expect(vary).toContain('accept-encoding')
    expect(vary).toContain('origin')
  })
})

describe('Synthetic 404 fallback runs middleware', () => {
  test('unmatched path goes through global middleware before returning 404', async () => {
    const { server, router } = createServer()
    let middlewareSaw = false
    router.useGlobal(async (ctx: any, next) => {
      middlewareSaw = true
      ctx.$responseHeaders ??= new Headers()
      ctx.$responseHeaders.set('Access-Control-Allow-Origin', 'https://app.com')
      await next()
    })
    router.get('/known', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/non-existent'))
    expect(res.status).toBe(404)
    expect(middlewareSaw).toBe(true)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('matched routes still respond normally and bypass the 404 fallback', async () => {
    const { server, router } = createServer()
    router.get('/known', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/known'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('Lifecycle hooks — combined', () => {
  test('full lifecycle order: onRequest → onBeforeHandle → handler → onAfterHandle', async () => {
    const { server, router } = createServer()
    const order: string[] = []

    router.onRequest(() => { order.push('1-onRequest') })
    router.onBeforeHandle(() => { order.push('2-onBeforeHandle') })
    router.onAfterHandle(() => { order.push('4-onAfterHandle') })
    router.get('/test', () => { order.push('3-handler'); return { ok: true } })

    await server.handle(req('/test'))
    expect(order).toEqual(['1-onRequest', '2-onBeforeHandle', '3-handler', '4-onAfterHandle'])
  })

  test('hooks now fire for unmatched routes via the synthetic 404 fallback', async () => {
    // Before the synthetic-404 work, unmatched paths bypassed the entire
    // middleware chain so CORS, request logging, etc. silently dropped
    // off 404s and the browser saw "CORS error" instead of a real 404.
    // The synthetic fallback runs the chain so those hooks observe the
    // request and can stamp headers / log it / shape the response.
    const { server, router } = createServer()
    let hookFired = false

    router.onRequest(() => { hookFired = true })
    router.get('/exists', () => ({ ok: true }))

    const res = await server.handle(req('/nonexistent'))
    expect(res.status).toBe(404)
    expect(hookFired).toBe(true)
  })

  test('onRequest is chainable', () => {
    const router = freshRouter()
    const result = router.onRequest(() => {})
    expect(result).toBe(router)
  })

  test('onBeforeHandle is chainable', () => {
    const router = freshRouter()
    const result = router.onBeforeHandle(() => {})
    expect(result).toBe(router)
  })

  test('onAfterHandle is chainable', () => {
    const router = freshRouter()
    const result = router.onAfterHandle(() => {})
    expect(result).toBe(router)
  })

  test('onAfterResponse is chainable', () => {
    const router = freshRouter()
    const result = router.onAfterResponse(() => {})
    expect(result).toBe(router)
  })

  test('onError is chainable', () => {
    const router = freshRouter()
    const result = router.onError(() => {})
    expect(result).toBe(router)
  })
})

// Additional route matching tests

describe('route matching — additional', () => {
  test('match returns null for unregistered path', () => {
    const r = freshRouter()
    r.get('/exists', noop)
    r.compile()
    expect(r.match('GET', '/not-exists')).toBeNull()
  })

  test('match returns null for wrong method', () => {
    const r = freshRouter()
    r.get('/only-get', noop)
    r.compile()
    expect(r.match('POST', '/only-get')).toBeNull()
  })

  test('match with multiple params', () => {
    const r = freshRouter()
    r.get('/users/:userId/posts/:postId', noop)
    r.compile()
    const m = r.match('GET', '/users/5/posts/10')
    expect(m).not.toBeNull()
    expect(m!.params.userId).toBe('5')
    expect(m!.params.postId).toBe('10')
  })

  test('match with three nested params', () => {
    const r = freshRouter()
    r.get('/a/:x/b/:y/c/:z', noop)
    r.compile()
    const m = r.match('GET', '/a/1/b/2/c/3')
    expect(m).not.toBeNull()
    expect(m!.params.x).toBe('1')
    expect(m!.params.y).toBe('2')
    expect(m!.params.z).toBe('3')
  })

  test('PATCH method works', () => {
    const r = freshRouter()
    r.patch('/items/:id', noop)
    r.compile()
    const m = r.match('PATCH', '/items/99')
    expect(m).not.toBeNull()
    expect(m!.params.id).toBe('99')
  })

  test('route with static and param segments', () => {
    const r = freshRouter()
    r.get('/api/v2/users/:id/profile', noop)
    r.compile()
    const m = r.match('GET', '/api/v2/users/42/profile')
    expect(m).not.toBeNull()
    expect(m!.params.id).toBe('42')
  })

  test('two routes with same prefix different endings', () => {
    const r = freshRouter()
    r.get('/api/users', noop)
    r.get('/api/posts', noop)
    r.compile()
    expect(r.match('GET', '/api/users')).not.toBeNull()
    expect(r.match('GET', '/api/posts')).not.toBeNull()
    expect(r.match('GET', '/api/comments')).toBeNull()
  })
})

// Multiple middleware on same route

describe('multiple middleware on same route', () => {
  test('route can have multiple middlewares via use()', () => {
    const r = freshRouter()
    const m1: MiddlewareFunction = async (_c, n) => n()
    const m2: MiddlewareFunction = async (_c, n) => n()
    const m3: MiddlewareFunction = async (_c, n) => n()
    r.get('/x', noop).use(m1).use(m2).use(m3)
    r.compile()
    const match = r.match('GET', '/x')
    expect(match!.route.middlewares).toContain(m1)
    expect(match!.route.middlewares).toContain(m2)
    expect(match!.route.middlewares).toContain(m3)
  })

  test('group middleware + route middleware stacks correctly', () => {
    const r = freshRouter()
    const groupMw: MiddlewareFunction = async (_c, n) => n()
    const routeMw: MiddlewareFunction = async (_c, n) => n()
    r.group(() => {
      r.get('/x', noop).use(routeMw)
    }).prefix('/g').use(groupMw)
    r.compile()
    const m = r.match('GET', '/g/x')
    expect(m!.route.middlewares).toContain(groupMw)
    expect(m!.route.middlewares).toContain(routeMw)
  })

  test('router + group + route middleware all stack', () => {
    const r = freshRouter()
    const routerMw: MiddlewareFunction = async (_c, n) => n()
    const groupMw: MiddlewareFunction = async (_c, n) => n()
    const routeMw: MiddlewareFunction = async (_c, n) => n()
    r.useRouter(routerMw)
    r.group(() => {
      r.get('/deep', noop).use(routeMw)
    }).prefix('/api').use(groupMw)
    r.compile()
    const m = r.match('GET', '/api/deep')
    expect(m!.route.middlewares).toContain(routerMw)
    expect(m!.route.middlewares).toContain(groupMw)
    expect(m!.route.middlewares).toContain(routeMw)
  })
})

// Route names — conflicts and makeUrl

describe('route names — additional', () => {
  test('makeUrl with multiple params', () => {
    const r = freshRouter()
    r.get('/users/:userId/posts/:postId', noop).as('user.post')
    r.compile()
    expect(r.makeUrl('user.post', { userId: '5', postId: '10' })).toBe('/users/5/posts/10')
  })

  test('makeUrl with query string', () => {
    const r = freshRouter()
    r.get('/items', noop).as('items.list')
    r.compile()
    const url = r.makeUrl('items.list', {}, { page: '1', limit: '20' })
    expect(url).toContain('page=1')
    expect(url).toContain('limit=20')
  })

  test('makeUrl for resource routes', () => {
    class Ctrl {
      index() {} show() {} store() {} update() {} destroy() {} create() {} edit() {}
    }
    const r = freshRouter()
    r.resource('articles', Ctrl)
    r.compile()
    expect(r.makeUrl('articles.index')).toBe('/articles')
    expect(r.makeUrl('articles.show', { id: '7' })).toBe('/articles/7')
  })

  test('group .as() + route .as() concatenated', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/list', noop).as('list')
      r.get('/:id', noop).as('show')
    }).prefix('/items').as('items')
    r.compile()
    expect(r.makeUrl('items.list')).toBe('/items/list')
    expect(r.makeUrl('items.show', { id: '3' })).toBe('/items/3')
  })
})

// Route groups — nested prefixes

describe('nested route groups', () => {
  test('triple nesting', () => {
    const r = freshRouter()
    r.group(() => {
      r.group(() => {
        r.group(() => {
          r.get('/action', noop)
        }).prefix('/c')
      }).prefix('/b')
    }).prefix('/a')
    r.compile()
    expect(r.match('GET', '/a/b/c/action')).not.toBeNull()
  })

  test('nested groups with middleware', () => {
    const r = freshRouter()
    const outerMw: MiddlewareFunction = async (_c, n) => n()
    const innerMw: MiddlewareFunction = async (_c, n) => n()
    r.group(() => {
      r.group(() => {
        r.get('/endpoint', noop)
      }).prefix('/inner').use(innerMw)
    }).prefix('/outer').use(outerMw)
    r.compile()
    const m = r.match('GET', '/outer/inner/endpoint')
    expect(m).not.toBeNull()
    expect(m!.route.middlewares).toContain(outerMw)
    expect(m!.route.middlewares).toContain(innerMw)
  })

  test('group prefix is applied to all routes inside', () => {
    const r = freshRouter()
    r.group(() => {
      r.get('/one', noop)
      r.get('/two', noop)
    }).prefix('/grp')
    r.compile()
    expect(r.match('GET', '/grp/one')).not.toBeNull()
    expect(r.match('GET', '/grp/two')).not.toBeNull()
    expect(r.match('GET', '/one')).toBeNull()
  })
})

// Lifecycle hooks — additional

describe('Lifecycle hooks — additional', () => {
  test('onError hook is registered', () => {
    const { router } = createServer()
    let registered = false
    router.onError(() => { registered = true })
    expect(typeof router.onError).toBe('function')
  })

  test('POST method handled by server', async () => {
    const { server, router } = createServer()
    router.post('/data', () => ({ received: true }))
    const res = await server.handle(req('/data', 'POST'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  test('PUT method handled by server', async () => {
    const { server, router } = createServer()
    router.put('/data/:id', (ctx: any) => ({ id: ctx.params.id }))
    const res = await server.handle(req('/data/5', 'PUT'))
    expect(res.status).toBe(200)
  })

  test('DELETE method handled by server', async () => {
    const { server, router } = createServer()
    router.delete('/data/:id', () => ({ deleted: true }))
    const res = await server.handle(req('/data/1', 'DELETE'))
    expect(res.status).toBe(200)
  })

  test('PATCH method handled by server', async () => {
    const { server, router } = createServer()
    router.patch('/data/:id', () => ({ patched: true }))
    const res = await server.handle(req('/data/1', 'PATCH'))
    expect(res.status).toBe(200)
  })

  test('handler returning plain object is serialized as JSON', async () => {
    const { server, router } = createServer()
    router.get('/json', () => ({ key: 'value', num: 42 }))
    const res = await server.handle(req('/json'))
    const body = await res.json()
    expect(body.key).toBe('value')
    expect(body.num).toBe(42)
  })

  test('handler returning Response is passed through', async () => {
    const { server, router } = createServer()
    router.get('/raw', () => new Response('raw-body', { status: 201 }))
    const res = await server.handle(req('/raw'))
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('raw-body')
  })

  test('multiple routes register and match independently', async () => {
    const { server, router } = createServer()
    router.get('/a', () => ({ route: 'a' }))
    router.get('/b', () => ({ route: 'b' }))
    router.get('/c', () => ({ route: 'c' }))
    const resA = await server.handle(req('/a'))
    const resB = await server.handle(req('/b'))
    const resC = await server.handle(req('/c'))
    expect((await resA.json()).route).toBe('a')
    expect((await resB.json()).route).toBe('b')
    expect((await resC.json()).route).toBe('c')
  })
})
