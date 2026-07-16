import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'
import os from 'os'
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

// Build a fake appRoot with `public/` and `dist/client/` populated, then
// register the prod fallback against it and return the handler.
function setup() {
  const appRoot = join(os.tmpdir(), `tekir-vite-sec-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const pub = join(appRoot, 'public')
  const dist = join(appRoot, 'dist', 'client')
  mkdirSync(pub, { recursive: true })
  mkdirSync(dist, { recursive: true })
  // A secret next to the app root that traversal would try to reach.
  writeFileSync(join(appRoot, 'secret.txt'), 'TOP SECRET')
  // Dotfiles inside the served roots.
  writeFileSync(join(pub, '.env'), 'API_KEY=should-not-leak')
  writeFileSync(join(dist, '.env'), 'API_KEY=should-not-leak')
  // Legitimate assets.
  writeFileSync(join(pub, 'logo.png'), 'PNGDATA')
  symlinkSync(join(appRoot, 'secret.txt'), join(pub, 'leak.txt'))
  writeFileSync(join(dist, 'app.js'), 'console.log(1)')
  writeFileSync(join(dist, 'index.html'), '<html></html>')

  const server = mockServer()
  vite(server, { dev: false }, { appRoot })
  return { appRoot, handler: server.fallbacks[0] }
}

describe('vite prod fallback — path traversal', () => {
  let appRoot: string
  let handler: Function

  beforeEach(() => {
    const s = setup()
    appRoot = s.appRoot
    handler = s.handler
  })

  afterEach(() => {
    if (existsSync(appRoot)) rmSync(appRoot, { recursive: true, force: true })
  })

  const get = (path: string) => handler(new Request('http://localhost' + path))
  // For a blocked path we expect either a 404 JSON or the SPA index.html,
  // but never the secret/.env body.
  async function bodyOf(path: string): Promise<string> {
    const res = await get(path)
    return await res.text()
  }

  test('serves a legitimate public asset', async () => {
    expect(await bodyOf('/logo.png')).toBe('PNGDATA')
  })

  test('serves a legitimate dist asset', async () => {
    expect(await bodyOf('/app.js')).toBe('console.log(1)')
  })

  test('blocks ../ traversal to a file outside the root', async () => {
    expect(await bodyOf('/../secret.txt')).not.toContain('TOP SECRET')
  })

  test('blocks encoded %2e%2e traversal', async () => {
    expect(await bodyOf('/%2e%2e/secret.txt')).not.toContain('TOP SECRET')
  })

  test('blocks deep traversal', async () => {
    expect(await bodyOf('/../../../../secret.txt')).not.toContain('TOP SECRET')
  })

  test('does not serve public/.env', async () => {
    expect(await bodyOf('/.env')).not.toContain('should-not-leak')
  })

  test('does not serve dist/.env', async () => {
    // .env is not in public, so this falls through to dist; must still be blocked.
    expect(await bodyOf('/.env')).not.toContain('should-not-leak')
  })

  test('does not serve a nested dotfile', async () => {
    expect(await bodyOf('/assets/.env')).not.toContain('should-not-leak')
  })

  test('does not follow a public symlink outside the served root', async () => {
    expect(await bodyOf('/leak.txt')).not.toContain('TOP SECRET')
  })

  test('malformed percent-encoding does not throw (falls back)', async () => {
    const res = await get('/%')
    // Should resolve to the SPA index.html or a 404, never crash.
    expect([200, 404]).toContain(res.status)
  })

  test('null byte payload is blocked', async () => {
    expect(await bodyOf('/logo.png%00.txt')).not.toBe('PNGDATA')
  })

  test('Windows backslash dotfile bypass is blocked', async () => {
    expect(await bodyOf('/assets%5C.env')).not.toContain('should-not-leak')
  })
})
