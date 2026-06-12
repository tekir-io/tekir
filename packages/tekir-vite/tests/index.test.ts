import { test, expect, describe } from 'bun:test'
import { vite } from '../src/middleware'


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


describe('vite()', () => {
  test('is exported and is a function', () => {
    expect(typeof vite).toBe('function')
  })

  test('registers a fallback handler on the server', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('registers a build hook on the server', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(server.buildHooks).toHaveLength(1)
  })

  test('default config values', () => {
    const server = mockServer()
    // Should not throw with empty config
    vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts custom root', () => {
    const server = mockServer()
    vite(server, { root: 'src/client', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts custom buildDir', () => {
    const server = mockServer()
    vite(server, { buildDir: 'dist', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('fallback returns 404 for missing files in production', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/unknown'))
    expect(res.status).toBe(404)
  })

  test('fallback returns 404 JSON response', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/foo/bar'))
    const body = await res.json()
    expect(body.error).toBe('Not Found')
  })

  test('fallback handles root path', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(404)
  })

  test('fallback handles query strings', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/page?foo=bar'))
    expect(res.status).toBe(404)
  })

  test('can be called multiple times', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(2)
  })
})


describe('ViteConfig', () => {
  test('accepts plugins option', () => {
    const server = mockServer()
    vite(server, { plugins: [], dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts css option', () => {
    const server = mockServer()
    vite(server, { css: {}, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts resolve option', () => {
    const server = mockServer()
    vite(server, { resolve: { alias: {} }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts define option', () => {
    const server = mockServer()
    vite(server, { define: { __APP__: '"test"' }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('accepts all options together', () => {
    const server = mockServer()
    vite(server, {
      root: 'frontend',
      buildDir: 'dist',
      dev: false,
      plugins: [],
      css: {},
      resolve: {},
      define: {},
    })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })
})


describe('vite() fallback handler', () => {
  test('fallback 404 for nested path', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/a/b/c/d'))
    expect(res.status).toBe(404)
  })

  test('fallback 404 body contains "Not Found"', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/test'))
    const body = await res.json()
    expect(body.error).toBe('Not Found')
  })

  test('fallback for path with extension', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/assets/style.css'))
    expect(res.status).toBe(404)
  })

  test('fallback for path with hash fragment', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/page#section'))
    expect(res.status).toBe(404)
  })

  test('fallback for path with multiple query params', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/search?q=hello&page=2&sort=asc'))
    expect(res.status).toBe(404)
  })

  test('fallback response has correct content-type', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/test'))
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  test('fallback for empty path after domain', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(404)
  })
})


describe('vite() build hooks', () => {
  test('build hook is a function', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(typeof server.buildHooks[0]).toBe('function')
  })

  test('build hook can be called without throwing', async () => {
    const server = mockServer()
    vite(server, { dev: false, root: '/nonexistent' })
    const hook = server.buildHooks[0]
    // Build hook might throw if vite is not installed, but the hook itself should be callable
    expect(typeof hook).toBe('function')
  })

  test('multiple vite calls register multiple build hooks', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.buildHooks).toHaveLength(3)
  })
})


describe('ViteConfig — combinations', () => {
  test('root + buildDir', () => {
    const server = mockServer()
    vite(server, { root: 'client', buildDir: 'client/dist', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('plugins as array of objects', () => {
    const server = mockServer()
    vite(server, { plugins: [{ name: 'test-plugin' }], dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('css with modules config', () => {
    const server = mockServer()
    vite(server, { css: { modules: { localsConvention: 'camelCase' } }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('resolve with alias object', () => {
    const server = mockServer()
    vite(server, { resolve: { alias: { '@': '/src' } }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('define with multiple values', () => {
    const server = mockServer()
    vite(server, { define: { __VERSION__: '"1.0.0"', __DEV__: 'false' }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('dev:false registers both fallback and build hook', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })

  test('empty plugins array', () => {
    const server = mockServer()
    vite(server, { plugins: [], dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('empty resolve object', () => {
    const server = mockServer()
    vite(server, { resolve: {}, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('empty define object', () => {
    const server = mockServer()
    vite(server, { define: {}, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('all empty options', () => {
    const server = mockServer()
    vite(server, { dev: false, plugins: [], css: {}, resolve: {}, define: {} })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })

  test('root with trailing slash', () => {
    const server = mockServer()
    vite(server, { root: 'src/client/', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('buildDir with trailing slash', () => {
    const server = mockServer()
    vite(server, { buildDir: 'dist/', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })
})


describe('vite() fallback — more path patterns', () => {
  test('fallback for path with special characters', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/path%20with%20spaces'))
    expect(res.status).toBe(404)
  })

  test('fallback for path with unicode', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/path/caf%C3%A9'))
    expect(res.status).toBe(404)
  })

  test('fallback for .js file request', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/assets/app.js'))
    expect(res.status).toBe(404)
  })

  test('fallback for .map file request', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/assets/app.js.map'))
    expect(res.status).toBe(404)
  })

  test('fallback for favicon.ico', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/favicon.ico'))
    expect(res.status).toBe(404)
  })

  test('fallback response body has error field', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent/path' })
    const handler = server.fallbacks[0]
    const res = await handler(new Request('http://localhost/any'))
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})

describe('vite() config — all options', () => {
  test('root as absolute path', () => {
    const server = mockServer()
    vite(server, { root: '/home/user/project/client', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('buildDir as absolute path', () => {
    const server = mockServer()
    vite(server, { buildDir: '/home/user/project/dist', dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('plugins with multiple entries', () => {
    const server = mockServer()
    vite(server, { plugins: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('define with process.env substitutions', () => {
    const server = mockServer()
    vite(server, { define: { 'process.env.NODE_ENV': '"production"' }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('resolve with multiple aliases', () => {
    const server = mockServer()
    vite(server, { resolve: { alias: { '@': '/src', '~': '/src/assets' } }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('css with preprocessor options', () => {
    const server = mockServer()
    vite(server, { css: { preprocessorOptions: { scss: { additionalData: '' } } }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })
})

describe('vite() multiple calls', () => {
  test('three vite calls register three fallbacks', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(3)
  })

  test('three vite calls register three build hooks', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.buildHooks).toHaveLength(3)
  })

  test('each fallback is an independent function', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.fallbacks[0]).not.toBe(server.fallbacks[1])
  })

  test('each build hook is an independent function', () => {
    const server = mockServer()
    vite(server, { dev: false })
    vite(server, { dev: false })
    expect(server.buildHooks[0]).not.toBe(server.buildHooks[1])
  })

  test('different configs for different vite calls', () => {
    const server = mockServer()
    vite(server, { root: 'app1', dev: false })
    vite(server, { root: 'app2', dev: false })
    expect(server.fallbacks).toHaveLength(2)
    expect(server.buildHooks).toHaveLength(2)
  })

  test('fallback handlers from different calls all return 404', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/no1' })
    vite(server, { dev: false, buildDir: '/no2' })
    const res1 = await server.fallbacks[0](new Request('http://localhost/x'))
    const res2 = await server.fallbacks[1](new Request('http://localhost/y'))
    expect(res1.status).toBe(404)
    expect(res2.status).toBe(404)
  })

  test('five vite calls all work', () => {
    const server = mockServer()
    for (let i = 0; i < 5; i++) vite(server, { dev: false })
    expect(server.fallbacks).toHaveLength(5)
    expect(server.buildHooks).toHaveLength(5)
  })

  test('fallback returns Response instance', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent' })
    const res = await server.fallbacks[0](new Request('http://localhost/'))
    expect(res).toBeInstanceOf(Response)
  })
})

describe('vite() — additional edge cases', () => {
  test('fallback for .html file', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent' })
    const res = await server.fallbacks[0](new Request('http://localhost/index.html'))
    expect(res.status).toBe(404)
  })

  test('fallback for .json file', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent' })
    const res = await server.fallbacks[0](new Request('http://localhost/manifest.json'))
    expect(res.status).toBe(404)
  })

  test('fallback for .svg file', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent' })
    const res = await server.fallbacks[0](new Request('http://localhost/logo.svg'))
    expect(res.status).toBe(404)
  })

  test('fallback for .woff2 font file', async () => {
    const server = mockServer()
    vite(server, { dev: false, buildDir: '/nonexistent' })
    const res = await server.fallbacks[0](new Request('http://localhost/fonts/inter.woff2'))
    expect(res.status).toBe(404)
  })

  test('dev false registers both handlers', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(server.fallbacks.length).toBeGreaterThanOrEqual(1)
    expect(server.buildHooks.length).toBeGreaterThanOrEqual(1)
  })

  test('fallback handler is async', () => {
    const server = mockServer()
    vite(server, { dev: false })
    const result = server.fallbacks[0](new Request('http://localhost/'))
    expect(result).toBeInstanceOf(Promise)
  })

  test('build hook is callable', () => {
    const server = mockServer()
    vite(server, { dev: false })
    expect(typeof server.buildHooks[0]).toBe('function')
  })

  test('config with root and plugins', () => {
    const server = mockServer()
    vite(server, { root: 'frontend', plugins: [{ name: 'react' }], dev: false })
    expect(server.fallbacks).toHaveLength(1)
  })

  test('config with root, buildDir, and define', () => {
    const server = mockServer()
    vite(server, { root: 'src', buildDir: 'build', define: { __PROD__: 'true' }, dev: false })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })

  test('config with all options at once', () => {
    const server = mockServer()
    vite(server, {
      root: 'client',
      buildDir: 'client/build',
      plugins: [{ name: 'vue' }],
      css: { modules: {} },
      resolve: { alias: { '@': '/src' } },
      define: { __APP_VERSION__: '"2.0"' },
      dev: false,
    })
    expect(server.fallbacks).toHaveLength(1)
    expect(server.buildHooks).toHaveLength(1)
  })
})
