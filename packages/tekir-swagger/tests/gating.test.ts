import { test, expect, describe, afterEach } from 'bun:test'
import { swagger, buildOpenApiSpec, ApiHide, ApiSummary } from '../src/index'

// Minimal router stub that records registered GET routes.
function mockRouter() {
  const routes: string[] = []
  const route = { use() { return route } }
  return {
    routes,
    get(path: string, _handler: any) { routes.push(path); return route },
  }
}

// `process.env.NODE_ENV` is typed read-only; alias through a mutable record so
// the tests can set/restore it without changing behavior.
const env = process.env as Record<string, string | undefined>
const ORIG_ENV = env.NODE_ENV

describe('swagger() — production environment gate', () => {
  afterEach(() => {
    if (ORIG_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = ORIG_ENV
  })

  test('registers docs in development by default', () => {
    env.NODE_ENV = 'development'
    const r = mockRouter()
    swagger(r as any, {})
    expect(r.routes.length).toBeGreaterThan(0)
  })

  test('does NOT register docs in production without auth', () => {
    env.NODE_ENV = 'production'
    const r = mockRouter()
    swagger(r as any, {})
    expect(r.routes).toHaveLength(0)
  })

  test('registers in production when auth is configured', () => {
    env.NODE_ENV = 'production'
    const r = mockRouter()
    swagger(r as any, { auth: { username: 'a', password: 'b' } })
    expect(r.routes.length).toBeGreaterThan(0)
  })

  test('enabled:true force-registers in production', () => {
    env.NODE_ENV = 'production'
    const r = mockRouter()
    swagger(r as any, { enabled: true })
    expect(r.routes.length).toBeGreaterThan(0)
  })

  test('enabled:false disables even in development', () => {
    env.NODE_ENV = 'development'
    const r = mockRouter()
    swagger(r as any, { enabled: false })
    expect(r.routes).toHaveLength(0)
  })
})

// Build a fake trie node so buildOpenApiSpec can collect routes.
function trieWith(entries: Array<{ method: string; pattern: string; handler?: any }>) {
  const handlers = new Map()
  for (const e of entries) {
    handlers.set(e.method, {
      pattern: e.pattern,
      paramNames: [],
      handler: e.handler ?? (() => {}),
    })
  }
  // Each route on its own node keyed in a flat children map.
  const children = new Map<string, any>()
  entries.forEach((e, i) => {
    const h = new Map()
    h.set(e.method, { pattern: e.pattern, paramNames: [], handler: e.handler ?? (() => {}) })
    children.set(String(i), { handlers: h })
  })
  return { root: { children } }
}

describe('buildOpenApiSpec — hiding internal routes', () => {
  test('hidePaths string prefix excludes matching routes', () => {
    const router = { getTrie: () => trieWith([
      { method: 'GET', pattern: '/api/users' },
      { method: 'GET', pattern: '/admin/secret' },
    ]) }
    const spec = buildOpenApiSpec(router as any, { hidePaths: ['/admin'] })
    expect(spec.paths['/api/users']).toBeDefined()
    expect(spec.paths['/admin/secret']).toBeUndefined()
  })

  test('hidePaths RegExp excludes matching routes', () => {
    const router = { getTrie: () => trieWith([
      { method: 'GET', pattern: '/api/users' },
      { method: 'GET', pattern: '/debug/dump' },
    ]) }
    const spec = buildOpenApiSpec(router as any, { hidePaths: [/^\/debug/] })
    expect(spec.paths['/api/users']).toBeDefined()
    expect(spec.paths['/debug/dump']).toBeUndefined()
  })

  test('@ApiHide() handler is excluded from the spec', () => {
    const hidden = () => {}
    ApiHide()(hidden)
    const visible = () => {}
    ApiSummary('visible')(visible)
    const router = { getTrie: () => trieWith([
      { method: 'GET', pattern: '/api/secret', handler: hidden },
      { method: 'GET', pattern: '/api/public', handler: visible },
    ]) }
    const spec = buildOpenApiSpec(router as any, {})
    expect(spec.paths['/api/secret']).toBeUndefined()
    expect(spec.paths['/api/public']).toBeDefined()
  })

  test('no hidePaths means all routes are present', () => {
    const router = { getTrie: () => trieWith([
      { method: 'GET', pattern: '/admin/secret' },
    ]) }
    const spec = buildOpenApiSpec(router as any, {})
    expect(spec.paths['/admin/secret']).toBeDefined()
  })
})
