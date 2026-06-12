import { test, expect, describe, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { generateViteEmbed } from '../src/compile'
import { vite } from '../src/middleware'

const fixtures: string[] = []
afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
  delete (globalThis as any).__TEKIR_VITE_EMBED__
})

function makeFixture(name: string) {
  const root = join(import.meta.dir, `__fx_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(root, { recursive: true })
  fixtures.push(root)
  return root
}

// Drive the plugin's onResolve/onLoad hooks via a tiny mock so we can
// inspect generated content without invoking Bun.build.
function runPlugin(plugin: any) {
  const resolvers: { filter: RegExp; cb: any }[] = []
  const loaders: { filter: RegExp; ns?: string; cb: any }[] = []
  plugin.setup({
    onResolve: (opts: any, cb: any) => resolvers.push({ filter: opts.filter, cb }),
    onLoad: (opts: any, cb: any) => loaders.push({ filter: opts.filter, ns: opts.namespace, cb }),
  })
  const resolve = (path: string) => {
    for (const r of resolvers) if (r.filter.test(path)) return r.cb({ path })
    return null
  }
  const load = (path: string, namespace: string) => {
    for (const l of loaders) if (l.filter.test(path) && (!l.ns || l.ns === namespace)) return l.cb({ path, namespace })
    return null
  }
  return { resolve, load }
}

describe('generateViteEmbed', () => {
  test('throws when build output is missing', () => {
    const root = makeFixture('missing')
    expect(() => generateViteEmbed({ appRoot: root, buildDir: 'dist/client', userEntry: 'index.ts' })).toThrow(/build output not found/)
  })

  test('throws when build output is empty', () => {
    const root = makeFixture('empty')
    mkdirSync(join(root, 'dist', 'client'), { recursive: true })
    expect(() => generateViteEmbed({ appRoot: root, buildDir: 'dist/client', userEntry: 'index.ts' })).toThrow(/nothing to embed/)
  })

  test('returns virtual entrypoint + plugin and writes nothing to disk', () => {
    const root = makeFixture('happy')
    const dist = join(root, 'dist', 'client')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<!doctype html><html></html>')
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
    writeFileSync(join(dist, 'assets', 'app.css'), 'body{}')
    writeFileSync(join(root, 'index.ts'), '')

    const result = generateViteEmbed({ appRoot: root, buildDir: 'dist/client', userEntry: 'index.ts' })

    // No on-disk artifacts
    expect(existsSync(join(root, '.tekir'))).toBe(false)

    expect(result.entrypoint).toBe('tekir-virtual:vite-compile-entry')
    expect(typeof result.plugin?.setup).toBe('function')

    const { resolve, load } = runPlugin(result.plugin)

    // The two virtual specifiers resolve into our namespace
    const entryRes = resolve('tekir-virtual:vite-compile-entry')
    expect(entryRes?.namespace).toBe('tekir-vite')
    const embedRes = resolve('tekir-virtual:vite-embed')
    expect(embedRes?.namespace).toBe('tekir-vite')
    // Unrelated paths fall through
    expect(resolve('react')).toBe(null)

    // Wrapper module: hoists @tekir/vite, then imports the user entry
    const wrapper = load('tekir-virtual:vite-compile-entry', 'tekir-vite')
    expect(wrapper?.loader).toBe('ts')
    expect(wrapper?.resolveDir).toBe(root)
    expect(wrapper?.contents).toContain(`import 'tekir-virtual:vite-embed'`)
    expect(wrapper?.contents).toContain(`import * as __tekirViteMod from '@tekir/vite'`)
    expect(wrapper?.contents).toContain(`__TEKIR_FRONTEND_MOD_vite = __tekirViteMod`)
    expect(wrapper?.contents).toMatch(/await import\(".*index\.ts"\)/)

    // Embed module: one `with { type: 'file' }` import per dist file
    const embed = load('tekir-virtual:vite-embed', 'tekir-vite')
    const src: string = embed?.contents
    expect(embed?.resolveDir).toBe(root)
    expect(src).not.toContain('\\')
    expect(src.match(/^import a\d+ from /gm)?.length).toBe(3)
    expect(src).toContain(`["/index.html"`)
    expect(src).toContain(`["/assets/app.js"`)
    expect(src).toContain(`["/assets/app.css"`)
    expect(src).toContain(`['/'`) // root alias to index.html blob
    expect(src).toContain('__TEKIR_VITE_EMBED__')
  })

  test('respects custom buildDir', () => {
    const root = makeFixture('custom-builddir')
    const dist = join(root, 'build', 'spa')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<!doctype html>')
    writeFileSync(join(root, 'index.ts'), '')

    const result = generateViteEmbed({ appRoot: root, buildDir: 'build/spa', userEntry: 'index.ts' })
    const { load } = runPlugin(result.plugin)
    const embed = load('tekir-virtual:vite-embed', 'tekir-vite')
    expect(embed?.contents).toContain('build/spa/index.html')
  })

  test('handles absolute userEntry path', () => {
    const root = makeFixture('abs-entry')
    const dist = join(root, 'dist', 'client')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<!doctype html>')
    const userEntry = join(root, 'src', 'main.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(userEntry, '')

    const result = generateViteEmbed({ appRoot: root, buildDir: 'dist/client', userEntry })
    const { load } = runPlugin(result.plugin)
    const wrapper = load('tekir-virtual:vite-compile-entry', 'tekir-vite')
    expect(wrapper?.contents).toMatch(/await import\(".*\/src\/main\.ts"\)/)
  })
})

function mockServer() {
  const fallbacks: Function[] = []
  return {
    fallbacks,
    fallback(fn: Function) { fallbacks.push(fn) },
    onBuild(_fn: Function) {},
  }
}

describe('vite() — embed map runtime', () => {
  test('serves embedded asset when __TEKIR_VITE_EMBED__ is set', async () => {
    const root = makeFixture('runtime')
    const blobPath = join(root, 'asset.js')
    writeFileSync(blobPath, 'console.log("from-embed")')

    ;(globalThis as any).__TEKIR_VITE_EMBED__ = new Map<string, string>([
      ['/index.html', blobPath],
      ['/', blobPath],
      ['/app.js', blobPath],
    ])

    const server = mockServer()
    vite(server, { dev: false })
    const handler = server.fallbacks[0]

    const res = await handler(new Request('http://localhost/app.js'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('console.log("from-embed")')
  })

  test('SPA fallback returns index.html for unknown path', async () => {
    const root = makeFixture('spa')
    const indexPath = join(root, 'index.html')
    writeFileSync(indexPath, '<!doctype html><html><body>app</body></html>')

    ;(globalThis as any).__TEKIR_VITE_EMBED__ = new Map<string, string>([
      ['/index.html', indexPath],
      ['/', indexPath],
    ])

    const server = mockServer()
    vite(server, { dev: false })
    const handler = server.fallbacks[0]

    const res = await handler(new Request('http://localhost/some/deep/route'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('<body>app</body>')
  })

})
