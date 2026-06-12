import { test, expect, describe, beforeAll } from 'bun:test'
import { next } from '../src/middleware'
import { setContainer, App, TekirServer } from '@tekir/core'

// Initialize container with mock logger so getLogger() works
beforeAll(() => {
  const mockLogger: any = { info() {}, warn() {}, error() {}, debug() {} }
  const mockApp = new App()
  setContainer(mockApp, {} as TekirServer, mockLogger)
})

function mockServer() {
  const fallbacks: Function[] = []
  const buildHooks: Function[] = []
  return {
    fallbacks,
    buildHooks,
    fallback(fn: Function) { fallbacks.push(fn) },
    onBuild(fn: Function) { buildHooks.push(fn) },
  }
}

describe('next()', () => {
  test('is exported and is a function', () => {
    expect(typeof next).toBe('function')
  })

  test('registers a fallback handler', () => {
    const server = mockServer()
    next(server, { dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('registers a build hook', () => {
    const server = mockServer()
    next(server, { dev: false })
    expect(server.buildHooks).toHaveLength(1)
  })

  test('accepts custom dir', () => {
    const server = mockServer()
    next(server, { dir: 'frontend', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts turbopack option', () => {
    const server = mockServer()
    next(server, { turbopack: true, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts conf option', () => {
    const server = mockServer()
    next(server, { conf: { reactStrictMode: true }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('fallback handler is async', () => {
    const server = mockServer()
    next(server, { dev: false })
    const result = server.fallbacks[0](new Request('http://localhost/test'))
    expect(result).toBeInstanceOf(Promise)
  })

  test('fallback returns error status', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback returns JSON content-type', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/x'))
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  test('fallback handles query strings', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/p?a=1'))
    expect([404, 503]).toContain(res.status)
  })
})

describe('NextConfig', () => {
  test('accepts all options together', () => {
    const server = mockServer()
    next(server, { dir: '.', dev: false, turbopack: true, conf: {} })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })
})


describe('next() config combinations', () => {
  test('dir with nested path', () => {
    const server = mockServer()
    next(server, { dir: 'apps/web/frontend', dev: false })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })

  test('dir with absolute-like path', () => {
    const server = mockServer()
    next(server, { dir: '/opt/app/next', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('turbopack false explicitly', () => {
    const server = mockServer()
    next(server, { turbopack: false, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('conf with multiple options', () => {
    const server = mockServer()
    next(server, { conf: { reactStrictMode: true, compress: true }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('conf with empty nested objects', () => {
    const server = mockServer()
    next(server, { conf: { images: {}, experimental: {} }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('dir + turbopack together', () => {
    const server = mockServer()
    next(server, { dir: 'web', turbopack: true, dev: false })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })

  test('dir + conf together', () => {
    const server = mockServer()
    next(server, { dir: 'web', conf: { basePath: '/app' }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('turbopack + conf together', () => {
    const server = mockServer()
    next(server, { turbopack: true, conf: { poweredByHeader: false }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })
})

describe('next() fallback handler paths', () => {
  test('fallback handles deeply nested path', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/a/b/c/d/e'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback handles path with file extension', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/assets/main.js'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback handles path with encoded characters', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/page%20name'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback handles path with hash', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/page#section'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback handles multiple query params', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/search?q=hello&page=2&sort=asc'))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback response body is valid JSON', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/test'))
    const body = await res.text()
    expect(() => JSON.parse(body)).not.toThrow()
  })
})

describe('next() build hook', () => {
  test('build hook is a function', () => {
    const server = mockServer()
    next(server, { dev: false })
    expect(typeof server.buildHooks[0]).toBe('function')
  })

  test('multiple next() calls register multiple hooks', () => {
    const server = mockServer()
    next(server, { dev: false })
    next(server, { dev: false })
    expect(server.fallbacks).toHaveLength(2)
    expect(server.buildHooks).toHaveLength(2)
  })

  test('build hooks are independent functions', () => {
    const server = mockServer()
    next(server, { dev: false })
    next(server, { dev: false })
    expect(server.buildHooks[0]).not.toBe(server.buildHooks[1])
  })
})

describe('next() server reference', () => {
  test('fallback handler receives Request object', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const req = new Request('http://localhost/api/data')
    const res = await server.fallbacks[0](req)
    expect(res).toBeDefined()
    expect(typeof res.status).toBe('number')
  })

  test('fallback handler returns a Response instance', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/'))
    expect(res).toBeInstanceOf(Response)
  })

  test('server object is not mutated beyond fallbacks and buildHooks', () => {
    const server = mockServer()
    const keys = Object.keys(server)
    next(server, { dev: false })
    expect(Object.keys(server)).toEqual(keys)
  })

  test('fallback for POST request', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/api', { method: 'POST' }))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback for PUT request', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/api', { method: 'PUT' }))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback for DELETE request', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/api', { method: 'DELETE' }))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback for PATCH request', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/api', { method: 'PATCH' }))
    expect([404, 503]).toContain(res.status)
  })

  test('fallback for HEAD request', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/api', { method: 'HEAD' }))
    expect([404, 503]).toContain(res.status)
  })

  test('multiple fallback registrations are independent', () => {
    const server = mockServer()
    next(server, { dev: false })
    next(server, { dev: false })
    next(server, { dev: false })
    expect(server.fallbacks).toHaveLength(3)
    expect(server.fallbacks[0]).not.toBe(server.fallbacks[1])
    expect(server.fallbacks[1]).not.toBe(server.fallbacks[2])
  })

  test('multiple build hook registrations are independent', () => {
    const server = mockServer()
    next(server, { dev: false })
    next(server, { dev: false })
    expect(server.buildHooks).toHaveLength(2)
    expect(server.buildHooks[0]).not.toBe(server.buildHooks[1])
  })

  test('fallback response has headers', async () => {
    const server = mockServer()
    next(server, { dev: false })
    const res = await server.fallbacks[0](new Request('http://localhost/test'))
    expect(res.headers).toBeDefined()
  })

  test('config with dir as dot', () => {
    const server = mockServer()
    next(server, { dir: '.', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('config with conf containing rewrites', () => {
    const server = mockServer()
    next(server, { conf: { rewrites: async () => [] }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('config with conf containing redirects', () => {
    const server = mockServer()
    next(server, { conf: { redirects: async () => [] }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('config with conf containing headers', () => {
    const server = mockServer()
    next(server, { conf: { headers: async () => [] }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })
})
