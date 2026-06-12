import { test, expect, describe } from 'bun:test'
import { App } from '@tekir/core'
import {
  zodToJsonSchema,
  buildOpenApiSpec,
  ApiTag,
  ApiSummary,
  ApiBody,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  SwaggerProvider,
} from '../src/index'
import { z } from 'zod'


describe('zodToJsonSchema', () => {
  describe('primitives', () => {
    test('ZodString → { type: "string" }', () => {
      expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' })
    })

    test('ZodString with email check → format: "email"', () => {
      expect(zodToJsonSchema(z.string().email())).toEqual({ type: 'string', format: 'email' })
    })

    test('ZodString with url check → format: "uri"', () => {
      expect(zodToJsonSchema(z.string().url())).toEqual({ type: 'string', format: 'uri' })
    })

    test('ZodString with uuid check → format: "uuid"', () => {
      expect(zodToJsonSchema(z.string().uuid())).toEqual({ type: 'string', format: 'uuid' })
    })

    test('ZodString with min/max → minLength/maxLength', () => {
      const result = zodToJsonSchema(z.string().min(2).max(50))
      expect(result).toEqual({ type: 'string', minLength: 2, maxLength: 50 })
    })

    test('ZodNumber → { type: "number" }', () => {
      expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
    })

    test('ZodNumber with int → { type: "integer" }', () => {
      expect(zodToJsonSchema(z.number().int())).toEqual({ type: 'integer' })
    })

    test('ZodNumber with min/max → minimum/maximum', () => {
      const result = zodToJsonSchema(z.number().min(0).max(100))
      expect(result).toEqual({ type: 'number', minimum: 0, maximum: 100 })
    })

    test('ZodBoolean → { type: "boolean" }', () => {
      expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
    })

    test('ZodNull → { type: "string", nullable: true }', () => {
      expect(zodToJsonSchema(z.null())).toEqual({ type: 'string', nullable: true })
    })

    test('ZodAny → {}', () => {
      expect(zodToJsonSchema(z.any())).toEqual({})
    })

    test('ZodUnknown → {}', () => {
      expect(zodToJsonSchema(z.unknown())).toEqual({})
    })
  })

  describe('wrappers', () => {
    test('ZodOptional unwraps inner type', () => {
      expect(zodToJsonSchema(z.string().optional())).toEqual({ type: 'string' })
    })

    test('ZodNullable adds nullable: true', () => {
      expect(zodToJsonSchema(z.string().nullable())).toEqual({ type: 'string', nullable: true })
    })

    test('ZodDefault carries default value', () => {
      const result = zodToJsonSchema(z.string().default('hello'))
      expect(result.default).toBe('hello')
      expect(result.type).toBe('string')
    })

    test('ZodDefault with number', () => {
      const result = zodToJsonSchema(z.number().default(42))
      expect(result.default).toBe(42)
    })
  })

  describe('literals and enums', () => {
    test('ZodLiteral string', () => {
      expect(zodToJsonSchema(z.literal('admin'))).toEqual({ type: 'string', enum: ['admin'] })
    })

    test('ZodLiteral number', () => {
      expect(zodToJsonSchema(z.literal(1))).toEqual({ type: 'number', enum: [1] })
    })

    test('ZodLiteral boolean', () => {
      expect(zodToJsonSchema(z.literal(true))).toEqual({ type: 'boolean', enum: [true] })
    })

    test('ZodEnum → { type: "string", enum: [...values] }', () => {
      const result = zodToJsonSchema(z.enum(['a', 'b', 'c']))
      expect(result).toEqual({ type: 'string', enum: ['a', 'b', 'c'] })
    })

    test('ZodNativeEnum with string values', () => {
      enum Direction { Up = 'UP', Down = 'DOWN' }
      const result = zodToJsonSchema(z.nativeEnum(Direction))
      expect(result.type).toBe('string')
      expect(result.enum).toEqual(expect.arrayContaining(['UP', 'DOWN']))
    })

    test('ZodNativeEnum with numeric values → type: "string" (includes reverse mappings)', () => {
      enum Status { Active = 1, Inactive = 2 }
      const result = zodToJsonSchema(z.nativeEnum(Status))
      // TypeScript numeric enums have both forward and reverse mappings in Object.values,
      // so allNums check fails and type falls back to 'string'
      expect(result.type).toBe('string')
      expect(result.enum).toEqual(expect.arrayContaining([1, 2]))
    })
  })

  describe('complex types', () => {
    test('ZodArray → { type: "array", items: ... }', () => {
      const result = zodToJsonSchema(z.array(z.string()))
      expect(result).toEqual({ type: 'array', items: { type: 'string' } })
    })

    test('ZodArray of numbers', () => {
      const result = zodToJsonSchema(z.array(z.number()))
      expect(result).toEqual({ type: 'array', items: { type: 'number' } })
    })

    test('ZodObject → type, properties, required', () => {
      const result = zodToJsonSchema(
        z.object({ name: z.string(), age: z.number() })
      )
      expect(result.type).toBe('object')
      expect(result.properties).toEqual({ name: { type: 'string' }, age: { type: 'number' } })
      expect(result.required).toEqual(expect.arrayContaining(['name', 'age']))
    })

    test('ZodObject optional fields are not in required array', () => {
      const result = zodToJsonSchema(
        z.object({ name: z.string(), nickname: z.string().optional() })
      )
      expect(result.required).toContain('name')
      expect(result.required).not.toContain('nickname')
    })

    test('ZodObject with default fields are not in required array', () => {
      const result = zodToJsonSchema(
        z.object({ role: z.string().default('user') })
      )
      expect(result.required ?? []).not.toContain('role')
    })

    test('ZodObject nested', () => {
      const result = zodToJsonSchema(
        z.object({ address: z.object({ city: z.string() }) })
      )
      expect(result.properties!.address.type).toBe('object')
      expect(result.properties!.address.properties!.city).toEqual({ type: 'string' })
    })

    test('ZodUnion → { oneOf: [...] }', () => {
      const result = zodToJsonSchema(z.union([z.string(), z.number()])) as any
      expect(result.oneOf).toHaveLength(2)
      expect(result.oneOf[0]).toEqual({ type: 'string' })
      expect(result.oneOf[1]).toEqual({ type: 'number' })
    })

    test('ZodIntersection → { allOf: [...] }', () => {
      const A = z.object({ a: z.string() })
      const B = z.object({ b: z.number() })
      const result = zodToJsonSchema(z.intersection(A, B)) as any
      expect(result.allOf).toHaveLength(2)
    })

    test('ZodRecord → { type: "object", additionalProperties: ... }', () => {
      const result = zodToJsonSchema(z.record(z.string())) as any
      expect(result.type).toBe('object')
      expect(result.additionalProperties).toEqual({ type: 'string' })
    })

    test('ZodTuple → { type: "array", items: { oneOf: [...] } }', () => {
      const result = zodToJsonSchema(z.tuple([z.string(), z.number()])) as any
      expect(result.type).toBe('array')
      expect(result.items.oneOf).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    test('null input → {}', () => {
      expect(zodToJsonSchema(null)).toEqual({})
    })

    test('non-object input → {}', () => {
      expect(zodToJsonSchema('not a schema' as any)).toEqual({})
    })

    test('plain JSON schema object (no _def) passes through', () => {
      const plain = { type: 'string', format: 'email' }
      expect(zodToJsonSchema(plain)).toEqual(plain)
    })

    test('unknown Zod type → {}', () => {
      const fakeZod = { _def: { typeName: 'ZodSomethingUnknown' } }
      expect(zodToJsonSchema(fakeZod)).toEqual({})
    })
  })
})


const META_KEY = Symbol.for('__tekir_swagger_meta') // not exported; access via decorator side-effects

// Helper: apply a decorator to a plain function and read its hidden metadata.
// The decorators call applyMeta which calls getMeta(fn) and sets fn[META_KEY].
// We can read stored metadata by inspecting the function after applying the decorator.
function applyDecorator(decorator: Function, fn: Function): any {
  decorator(fn, undefined)
  // Retrieve the internal symbol by iterating own symbols
  const sym = Object.getOwnPropertySymbols(fn).find(s => s.toString().includes('tekir_swagger_meta'))
  return sym ? (fn as any)[sym] : undefined
}

describe('API Decorators', () => {
  test('@ApiTag stores tags on function', () => {
    const handler = function handler() {}
    ApiTag('Users')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].tags).toEqual(['Users'])
  })

  test('@ApiTag accumulates multiple calls', () => {
    const handler = function handler() {}
    ApiTag('A')(handler, undefined)
    ApiTag('B')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].tags).toEqual(['A', 'B'])
  })

  test('@ApiTag accepts multiple tags at once', () => {
    const handler = function handler() {}
    ApiTag('X', 'Y', 'Z')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].tags).toEqual(['X', 'Y', 'Z'])
  })

  test('@ApiSummary stores summary on function', () => {
    const handler = function handler() {}
    ApiSummary('Get all users')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].summary).toBe('Get all users')
  })

  test('@ApiBody converts zod schema and stores it', () => {
    const handler = function handler() {}
    ApiBody(z.object({ name: z.string() }))(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    const body = (handler as any)[sym].body
    expect(body.type).toBe('object')
    expect(body.properties.name).toEqual({ type: 'string' })
  })

  test('@ApiBody accepts plain JSON schema', () => {
    const handler = function handler() {}
    ApiBody({ type: 'object', properties: { id: { type: 'integer' } } })(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].body).toEqual({ type: 'object', properties: { id: { type: 'integer' } } })
  })

  test('@ApiResponse stores response with status', () => {
    const handler = function handler() {}
    ApiResponse(200, z.object({ id: z.number() }))(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    const responses = (handler as any)[sym].responses
    expect(responses).toHaveLength(1)
    expect(responses[0].status).toBe(200)
    expect(responses[0].schema.type).toBe('object')
  })

  test('@ApiResponse accumulates multiple responses', () => {
    const handler = function handler() {}
    ApiResponse(200, z.object({ id: z.number() }))(handler, undefined)
    ApiResponse(404, { type: 'object' })(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].responses).toHaveLength(2)
  })

  test('@ApiParam stores param name and options', () => {
    const handler = function handler() {}
    ApiParam('id', { type: 'integer', description: 'User ID' })(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    const params = (handler as any)[sym].params
    expect(params).toHaveLength(1)
    expect(params[0].name).toBe('id')
    expect(params[0].options.type).toBe('integer')
    expect(params[0].options.description).toBe('User ID')
  })

  test('@ApiParam with no options defaults to empty object', () => {
    const handler = function handler() {}
    ApiParam('slug')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    const params = (handler as any)[sym].params
    expect(params[0].options).toEqual({})
  })

  test('@ApiParam accumulates multiple params', () => {
    const handler = function handler() {}
    ApiParam('id')(handler, undefined)
    ApiParam('version')(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].params).toHaveLength(2)
  })

  test('@ApiBearerAuth sets bearerAuth: true', () => {
    const handler = function handler() {}
    ApiBearerAuth()(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    expect((handler as any)[sym].bearerAuth).toBe(true)
  })

  test('multiple decorators on the same function share metadata', () => {
    const handler = function handler() {}
    ApiTag('Users')(handler, undefined)
    ApiSummary('List users')(handler, undefined)
    ApiBearerAuth()(handler, undefined)
    const sym = Object.getOwnPropertySymbols(handler).find(s => s.toString().includes('tekir_swagger_meta'))!
    const meta = (handler as any)[sym]
    expect(meta.tags).toEqual(['Users'])
    expect(meta.summary).toBe('List users')
    expect(meta.bearerAuth).toBe(true)
  })
})


describe('buildOpenApiSpec', () => {
  // Build a minimal mock router that exposes getTrie()
  function makeRouter(routes: Array<{ method: string; pattern: string; paramNames?: string[]; handler?: any; name?: string }>) {
    const root: any = {
      handlers: new Map(
        routes.map(r => [
          r.method,
          { pattern: r.pattern, paramNames: r.paramNames || [], handler: r.handler || (() => {}), name: r.name },
        ])
      ),
      children: new Map(),
    }
    return {
      getTrie: () => ({ root }),
    }
  }

  test('returns valid OpenAPI 3.0.3 envelope with defaults', () => {
    const spec = buildOpenApiSpec(makeRouter([]), {})
    expect(spec.openapi).toBe('3.0.3')
    expect(spec.info.title).toBe('API Documentation')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.paths).toEqual({})
    expect(spec.components).toBeDefined()
  })

  test('custom title and version are reflected in info', () => {
    const spec = buildOpenApiSpec(makeRouter([]), { title: 'My API', version: '2.0.0' })
    expect(spec.info.title).toBe('My API')
    expect(spec.info.version).toBe('2.0.0')
  })

  test('description is included when provided', () => {
    const spec = buildOpenApiSpec(makeRouter([]), { description: 'Great API' })
    expect(spec.info.description).toBe('Great API')
  })

  test('description is omitted when not provided', () => {
    const spec = buildOpenApiSpec(makeRouter([]), {})
    expect(spec.info.description).toBeUndefined()
  })

  test('servers array is included when provided', () => {
    const spec = buildOpenApiSpec(makeRouter([]), {
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
    })
    expect(spec.servers).toHaveLength(1)
    expect(spec.servers![0].url).toBe('https://api.example.com')
  })

  test('servers is omitted when not provided', () => {
    const spec = buildOpenApiSpec(makeRouter([]), {})
    expect(spec.servers).toBeUndefined()
  })

  test('GET route is added to paths', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/users' }]), {})
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users'].get).toBeDefined()
  })

  test('POST route is added to paths', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'POST', pattern: '/users' }]), {})
    expect(spec.paths['/users'].post).toBeDefined()
  })

  test('ANY and WS methods are skipped', () => {
    const spec = buildOpenApiSpec(
      makeRouter([
        { method: 'ANY', pattern: '/any' },
        { method: 'WS', pattern: '/ws' },
        { method: 'GET', pattern: '/ok' },
      ]),
      {}
    )
    expect(spec.paths['/any']).toBeUndefined()
    expect(spec.paths['/ws']).toBeUndefined()
    expect(spec.paths['/ok']).toBeDefined()
  })

  test('path parameters are converted from :id to {id}', () => {
    const spec = buildOpenApiSpec(
      makeRouter([{ method: 'GET', pattern: '/users/:id', paramNames: ['id'] }]),
      {}
    )
    expect(spec.paths['/users/{id}']).toBeDefined()
    const op = spec.paths['/users/{id}'].get
    expect(op.parameters).toHaveLength(1)
    expect(op.parameters![0].name).toBe('id')
    expect(op.parameters![0].in).toBe('path')
    expect(op.parameters![0].required).toBe(true)
  })

  test('optional path parameter :id? is converted to {id}', () => {
    const spec = buildOpenApiSpec(
      makeRouter([{ method: 'GET', pattern: '/items/:slug?', paramNames: ['slug'] }]),
      {}
    )
    expect(spec.paths['/items/{slug}']).toBeDefined()
  })

  test('wildcard * is converted to {wildcard}', () => {
    const spec = buildOpenApiSpec(
      makeRouter([{ method: 'GET', pattern: '/files/*', paramNames: ['*'] }]),
      {}
    )
    expect(spec.paths['/files/{wildcard}']).toBeDefined()
  })

  test('tag is auto-derived from path', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/users' }]), {})
    expect(spec.paths['/users'].get.tags).toEqual(['Users'])
  })

  test('tag is auto-derived skipping api prefix', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/api/posts' }]), {})
    expect(spec.paths['/api/posts'].get.tags).toEqual(['Posts'])
  })

  test('@ApiTag metadata on handler is used for tags', () => {
    const handler = function handler() {}
    ApiTag('Custom')(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/stuff', handler }]), {})
    expect(spec.paths['/stuff'].get.tags).toEqual(['Custom'])
  })

  test('@ApiSummary metadata on handler is used for summary', () => {
    const handler = function handler() {}
    ApiSummary('Get all stuff')(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/stuff', handler }]), {})
    expect(spec.paths['/stuff'].get.summary).toBe('Get all stuff')
  })

  test('@ApiBearerAuth adds security scheme to components', () => {
    const handler = function handler() {}
    ApiBearerAuth()(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/secure', handler }]), {})
    expect(spec.components.securitySchemes?.bearerAuth).toBeDefined()
    expect(spec.components.securitySchemes!.bearerAuth.type).toBe('http')
    expect(spec.components.securitySchemes!.bearerAuth.scheme).toBe('bearer')
    expect(spec.paths['/secure'].get.security).toEqual([{ bearerAuth: [] }])
  })

  test('no bearer auth → securitySchemes is absent', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/open' }]), {})
    expect(spec.components.securitySchemes).toBeUndefined()
  })

  test('@ApiBody on POST adds requestBody', () => {
    const handler = function handler() {}
    ApiBody(z.object({ name: z.string() }))(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'POST', pattern: '/users', handler }]), {})
    const op = spec.paths['/users'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody!.required).toBe(true)
    expect(op.requestBody!.content['application/json'].schema.type).toBe('object')
  })

  test('@ApiBody on GET is not emitted as requestBody', () => {
    const handler = function handler() {}
    ApiBody(z.object({ name: z.string() }))(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/users', handler }]), {})
    expect(spec.paths['/users'].get.requestBody).toBeUndefined()
  })

  test('@ApiResponse adds responses object', () => {
    const handler = function handler() {}
    ApiResponse(200, z.object({ id: z.number() }))(handler, undefined)
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/items', handler }]), {})
    const responses = spec.paths['/items'].get.responses
    expect(responses['200']).toBeDefined()
    expect(responses['200'].description).toBe('OK')
    expect(responses['200'].content!['application/json'].schema.type).toBe('object')
  })

  test('no @ApiResponse → default 200: OK', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/items' }]), {})
    expect(spec.paths['/items'].get.responses['200']).toEqual({ description: 'OK' })
  })

  test('duplicate routes are deduplicated', () => {
    // Two routes with same method and pattern from trie traversal
    const root: any = {
      handlers: new Map([
        ['GET', { pattern: '/users', paramNames: [], handler: () => {} }],
        ['GET', { pattern: '/users', paramNames: [], handler: () => {} }], // same key overwrites in Map
      ]),
      children: new Map(),
    }
    const spec = buildOpenApiSpec({ getTrie: () => ({ root }) }, {})
    expect(Object.keys(spec.paths)).toHaveLength(1)
  })

  test('tags array is populated from all used tags', () => {
    // Use different methods so both routes survive in the same trie node Map
    const spec = buildOpenApiSpec(
      makeRouter([
        { method: 'GET', pattern: '/users' },
        { method: 'POST', pattern: '/posts' },
      ]),
      {}
    )
    const tagNames = spec.tags!.map(t => t.name)
    expect(tagNames).toContain('Users')
    expect(tagNames).toContain('Posts')
  })

  test('null router returns empty paths', () => {
    const spec = buildOpenApiSpec(null, { title: 'Empty' })
    expect(spec.paths).toEqual({})
  })

  test('router without getTrie returns empty paths', () => {
    const spec = buildOpenApiSpec({}, { title: 'Empty' })
    expect(spec.paths).toEqual({})
  })

  test('route name is used as operationId when available', () => {
    const spec = buildOpenApiSpec(
      makeRouter([{ method: 'GET', pattern: '/users', name: 'listUsers' }]),
      {}
    )
    expect(spec.paths['/users'].get.operationId).toBe('listUsers')
  })

  test('operationId is auto-generated when name is absent', () => {
    const spec = buildOpenApiSpec(makeRouter([{ method: 'GET', pattern: '/users' }]), {})
    expect(typeof spec.paths['/users'].get.operationId).toBe('string')
    expect(spec.paths['/users'].get.operationId.length).toBeGreaterThan(0)
  })
})


describe('SwaggerProvider', () => {
  test('is a class that can be instantiated', () => {
    const provider = new SwaggerProvider()
    expect(provider).toBeInstanceOf(SwaggerProvider)
  })

  test('accepts config in constructor', () => {
    const provider = new SwaggerProvider({ title: 'Test API', version: '3.0.0' })
    expect(provider).toBeInstanceOf(SwaggerProvider)
  })

  test('buildSpec returns a valid OpenAPI spec', () => {
    const provider = new SwaggerProvider({ title: 'Provider API', version: '1.2.3' })
    const root: any = { handlers: new Map(), children: new Map() }
    const spec = provider.buildSpec({ getTrie: () => ({ root }) })
    expect(spec.openapi).toBe('3.0.3')
    expect(spec.info.title).toBe('Provider API')
    expect(spec.info.version).toBe('1.2.3')
  })

  test('buildSpec with no config uses defaults', () => {
    const provider = new SwaggerProvider()
    const root: any = { handlers: new Map(), children: new Map() }
    const spec = provider.buildSpec({ getTrie: () => ({ root }) })
    expect(spec.info.title).toBe('API Documentation')
    expect(spec.info.version).toBe('1.0.0')
  })

  test('register resolves when config returns null gracefully', async () => {
    const provider = new SwaggerProvider()
    // `config('swagger')` returns null and no `router` is registered;
    // provider falls back to its constructor config and stores itself.
    const app = new App()
    app.instance('config', (_key: string) => null)
    await expect(provider.register(app)).resolves.toBeUndefined()
  })
})

describe('basic auth on /docs', () => {
  // Minimal router stub that captures registered routes and supports
  // chaining `.use()` to attach middlewares the way swagger() does.
  function makeFakeRouter() {
    const routes: Array<{ path: string; handler: any; middlewares: any[] }> = []
    function register(path: string, handler: any) {
      const entry = { path, handler, middlewares: [] as any[] }
      routes.push(entry)
      const chain = {
        use(mws: any[]) { entry.middlewares.push(...mws); return chain },
      }
      return chain
    }
    return {
      get: (p: string, h: any) => register(p, h),
      getTrie: () => ({ root: { handlers: new Map(), children: new Map() } }),
      routes,
    }
  }

  test('does NOT attach a middleware when auth is omitted', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, { path: '/docs' })
    for (const r of router.routes) expect(r.middlewares.length).toBe(0)
  })

  test('attaches a basic-auth middleware on every doc route when auth is set', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, {
      path: '/docs',
      auth: { username: 'admin', password: 'secret' },
    })
    expect(router.routes.length).toBeGreaterThanOrEqual(3)
    for (const r of router.routes) expect(r.middlewares.length).toBe(1)
  })

  test('middleware rejects requests without auth header (401 + WWW-Authenticate)', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, {
      path: '/docs',
      auth: { username: 'admin', password: 'secret' },
    })
    const mw = router.routes[0].middlewares[0]
    const ctx: any = { request: { headers: new Headers() }, $result: undefined }
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(ctx.$result.status).toBe(401)
    expect(ctx.$result.headers.get('www-authenticate')).toContain('Basic')
    expect(ctx.$result.headers.get('www-authenticate')).toContain('docs')
  })

  test('middleware accepts the matching credentials', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, {
      path: '/docs',
      auth: { username: 'kubilay', password: 'tekir' },
    })
    const mw = router.routes[0].middlewares[0]
    const credentials = 'Basic ' + Buffer.from('kubilay:tekir').toString('base64')
    const ctx: any = {
      request: { headers: new Headers({ Authorization: credentials }) },
      $result: undefined,
    }
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ctx.$result).toBeUndefined()
  })

  test('middleware rejects mismatched credentials', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, {
      path: '/docs',
      auth: { username: 'kubilay', password: 'tekir' },
    })
    const mw = router.routes[0].middlewares[0]
    const wrong = 'Basic ' + Buffer.from('kubilay:wrong').toString('base64')
    const ctx: any = {
      request: { headers: new Headers({ Authorization: wrong }) },
      $result: undefined,
    }
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(ctx.$result.status).toBe(401)
  })

  test('custom realm shows up in WWW-Authenticate', async () => {
    const { swagger } = await import('../src/ui')
    const router = makeFakeRouter()
    swagger(router as any, {
      path: '/docs',
      auth: { username: 'a', password: 'b', realm: 'tekir-admin' },
    })
    const mw = router.routes[0].middlewares[0]
    const ctx: any = { request: { headers: new Headers() }, $result: undefined }
    await mw(ctx, async () => {})
    expect(ctx.$result.headers.get('www-authenticate')).toContain('tekir-admin')
  })
})
