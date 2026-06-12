import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __internal } from '../src/build/inliner'

// `parseSync` is the only thing we need from oxc-parser. The build
// pipeline lazy-loads it, but unit tests pull it eagerly so a missing
// peer dep would surface here too.
const { parseSync } = await import('oxc-parser' as string) as any

describe('inliner — findCallSites', () => {
  const find = (src: string, file = 'test.ts') => __internal.findCallSites(src, file, parseSync)

  test('catches bare loadDir() with literal arg', () => {
    const sites = find(`await loadDir('core/controllers')`)
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ type: 'loadDir', path: 'core/controllers' })
  })

  test('catches member-call registerDir() with literal arg', () => {
    const sites = find(`await router.registerDir('core/controllers')`)
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ type: 'registerDir', path: 'core/controllers' })
  })

  test('catches multiple sites in one file', () => {
    const sites = find(`
      await router.registerDir('core/controllers')
      const jobs = await loadDir('core/jobs')
      await emitter.registerDir('core/listeners')
    `)
    expect(sites).toHaveLength(3)
    expect(sites.map(s => s.path)).toEqual([
      'core/controllers',
      'core/jobs',
      'core/listeners',
    ])
  })

  test('does NOT match comments containing the call pattern', () => {
    const sites = find(`
      // await loadDir('this-is-a-comment')
      /* router.registerDir('also-a-comment') */
      const real = 'noop'
    `)
    expect(sites).toHaveLength(0)
  })

  test('does NOT match string literals containing the call pattern', () => {
    const sites = find(`const s = "loadDir('foo')"; const t = 'router.registerDir("bar")'`)
    expect(sites).toHaveLength(0)
  })

  test('does NOT match calls with non-literal arguments', () => {
    const sites = find(`
      const path = 'core/controllers'
      await router.registerDir(path)
      await loadDir(getPath())
    `)
    expect(sites).toHaveLength(0)
  })

  test('does NOT match unrelated identifiers ending in registerDir', () => {
    const sites = find(`registerDirectory('foo'); router.registerDirectory('bar')`)
    expect(sites).toHaveLength(0)
  })

  test('does NOT match computed member access router["registerDir"]("x")', () => {
    const sites = find(`router["registerDir"]('foo')`)
    expect(sites).toHaveLength(0)
  })

  test('handles multi-line / weird formatting', () => {
    const sites = find(`
      await
        router
          .registerDir(
            'core/controllers'
          )
    `)
    expect(sites).toHaveLength(1)
    expect(sites[0].type).toBe('registerDir')
    expect(sites[0].path).toBe('core/controllers')
  })
})

describe('inliner — transformSource', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-inline-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('rewrites loadDir(\'literal\') into Promise.resolve(array of imports)', () => {
    mkdirSync(join(tmp, 'controllers'))
    writeFileSync(join(tmp, 'controllers', 'a.ts'), 'export default 1\n')
    writeFileSync(join(tmp, 'controllers', 'b.ts'), 'export default 2\n')

    const src = `const x = await loadDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!

    expect(out).toContain('import * as __tekir_inline_0 from "./controllers/a.ts"')
    expect(out).toContain('import * as __tekir_inline_1 from "./controllers/b.ts"')
    expect(out).toContain('Promise.resolve([')
    // Each call site emits its own IIFE picker so Bun's bundler optimizer
    // cannot statically resolve the module shape and fold a shared
    // helper into `m.default ?? m`. The reflection call into
    // `Object.prototype.hasOwnProperty.call(...)` is the canary that
    // survives folding — its presence in the output proves we did not
    // emit a bundler-foldable shape.
    expect(out).toContain('const _m=__tekir_inline_0;')
    expect(out).toContain('const _m=__tekir_inline_1;')
    expect(out).toContain('Object.prototype.hasOwnProperty.call(_m,"default")')
    // No shared helper should be emitted.
    expect(out).not.toContain('__tekir_pick')
  })

  test('rewrites registerDir to receiver.register(...arr)', () => {
    mkdirSync(join(tmp, 'jobs'))
    writeFileSync(join(tmp, 'jobs', 'cleanup.ts'), 'export default class {}\n')

    const src = `await cron.registerDir('jobs')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!

    expect(out).toContain('cron.register(')
  })

  test('returns null when there are no sites', () => {
    const out = __internal.transformSource('const x = 1', [], tmp)
    expect(out).toBeNull()
  })

  // ───────────────────────────────────────────────────────────────
  // The build-time picker, when given `parseSync`, emits real ESM
  // bindings (named/default imports) for every export instead of
  // routing through `import * as ns` + a runtime IIFE that walks
  // `Object.keys(ns)`. The latter is opaque to Bun's bundler shaker,
  // which then collapses the namespace import to `var ns = {}` and
  // leaves the runtime picker with nothing to pick. Going through
  // real bindings is what keeps the exports alive in the bundle.
  // ───────────────────────────────────────────────────────────────

  test('parseSync path: emits named import for single named export', () => {
    mkdirSync(join(tmp, 'controllers'))
    writeFileSync(
      join(tmp, 'controllers', 'todo.ts'),
      'export class TodoController { static __prefix = "/todos" }\n',
    )

    const src = `await router.registerDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp, parseSync)!

    // Real ESM named-import binding, not `import * as ns`.
    expect(out).toMatch(/import \{ TodoController as __tekir_named_0_TodoController \} from "\.\/controllers\/todo\.ts"/)
    expect(out).not.toContain('import * as __tekir_inline_0')
    // Single named export shortcut: emit the binding directly, no picker IIFE.
    expect(out).toContain('router.register(...[__tekir_named_0_TodoController])')
  })

  test('parseSync path: emits default import for default-exported class', () => {
    mkdirSync(join(tmp, 'controllers'))
    writeFileSync(
      join(tmp, 'controllers', 'home.ts'),
      'export default class HomeController { static __routes = [] }\n',
    )

    const src = `await router.registerDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp, parseSync)!

    expect(out).toMatch(/import __tekir_default_0 from "\.\/controllers\/home\.ts"/)
    // Default-only shortcut: bind directly, no picker IIFE.
    expect(out).toContain('router.register(...[__tekir_default_0])')
  })

  test('parseSync path: generic — picks decorator-stamped class WITHOUT name allowlist', () => {
    mkdirSync(join(tmp, 'controllers'))
    // Multiple named exports, none of them named in any framework
    // allowlist. The picker has to choose `Tagged` because it carries
    // tekir registry metadata (`__prefix`), even though the decorator
    // that stamped it could be a user-defined `@MyOwnRoute` the
    // inliner has never heard of.
    writeFileSync(
      join(tmp, 'controllers', 'mixed.ts'),
      [
        'export const helper = () => 1',
        'export class Untagged {}',
        'export class Tagged { static __prefix = "/x" }',
        'export const CONSTANT = 42',
      ].join('\n'),
    )

    const src = `await router.registerDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp, parseSync)!

    // Every named export gets a real binding so Bun's shaker can't drop them.
    expect(out).toContain('helper as __tekir_named_0_helper')
    expect(out).toContain('Untagged as __tekir_named_0_Untagged')
    expect(out).toContain('Tagged as __tekir_named_0_Tagged')
    expect(out).toContain('CONSTANT as __tekir_named_0_CONSTANT')

    // Pull the IIFE body and exercise it like the bundle would. The
    // exact picker output depends on the values bound at runtime, so
    // we substitute the named tokens with test fixtures.
    const iifeMatch = out.match(/\(\(\)=>\{const _a=\[([^\]]+)\];([\s\S]*?)\}\)\(\)/)
    expect(iifeMatch).not.toBeNull()
    const inner = iifeMatch![2]
    const pick = new Function('arr', `const _a = arr;${inner}`) as (a: any[]) => unknown

    const helper = () => 1
    class Untagged {}
    class Tagged { static __prefix = '/x' }
    const CONSTANT = 42
    expect(pick([helper, Untagged, Tagged, CONSTANT])).toBe(Tagged)

    // Same picker against a registry-tagged class created by ANY
    // user-defined decorator that stamps `__listeners` (or the other
    // generic field names): still wins. This is the whole point of
    // the generic strategy — no decorator-name allowlist.
    class CustomListener { static __listeners = [{ event: 'foo' }] }
    expect(pick([helper, Untagged, CustomListener, CONSTANT])).toBe(CustomListener)
  })

  test('parseSync path: default + named — default still wins', () => {
    mkdirSync(join(tmp, 'controllers'))
    writeFileSync(
      join(tmp, 'controllers', 'mix.ts'),
      [
        'export default class Main { static __routes = [] }',
        'export class Sidekick { static __prefix = "/side" }',
      ].join('\n'),
    )

    const src = `await router.registerDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp, parseSync)!

    expect(out).toMatch(/import __tekir_default_0 from/)
    expect(out).toMatch(/import \{ Sidekick as __tekir_named_0_Sidekick \} from/)
    // Picker IIFE returns default first (mirrors runtime defaultPick).
    expect(out).toContain('const _d=__tekir_default_0;')
    expect(out).toContain('if(_d!==undefined)return _d;')
  })

  test('per-site IIFE picker mirrors runtime defaultPick (named-export class)', () => {
    mkdirSync(join(tmp, 'controllers'))
    writeFileSync(join(tmp, 'controllers', 'a.ts'), 'export default 1\n')

    const src = `const x = await loadDir('controllers')`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!

    // The picker is emitted as a per-call-site IIFE that reads its
    // module via `const _m = <namespace>`. To exercise the same body
    // against arbitrary fixtures, extract the inner statements and
    // rebuild a callable via `new Function`. Build-time and runtime
    // must agree on the picked value — otherwise production bundles
    // silently load the wrong export.
    const iifeMatch = out.match(/\(\(\)=>\{const _m=__tekir_inline_0;([\s\S]*?)return _m;\}\)\(\)/)
    expect(iifeMatch).not.toBeNull()
    const inner = iifeMatch![1]
    const pick = new Function('arg', `const _m = arg;${inner}return _m;`) as (m: any) => unknown

    // Default export wins.
    expect(pick({ default: 'D', other: 'O' })).toBe('D')

    // Single named export → returned directly.
    class FooController { static __prefix = '/foo' }
    expect(pick({ FooController })).toBe(FooController)

    // Multiple named exports → decorator-tagged class wins.
    class Untagged {}
    class Tagged { static __routes = [] }
    expect(pick({ Untagged, Tagged })).toBe(Tagged)

    // Namespace fallback when nothing functional is exported.
    const ns = { a: 1, b: 2 }
    expect(pick(ns)).toBe(ns)
  })
})

// ─────────────────────────────────────────────────────────────────────
// fs read pattern inlining
// ─────────────────────────────────────────────────────────────────────

describe('inliner — fs read patterns', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-fsread-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('detects readFileSync(literal, "utf-8") as sync-string', () => {
    const src = `
      import { readFileSync } from 'fs'
      const data = readFileSync('./config.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'sync-string', path: './config.json' })
  })

  test('detects readFileSync(literal) (no encoding) as sync-buffer', () => {
    const src = `
      import { readFileSync } from 'fs'
      const data = readFileSync('./icon.bin')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'sync-buffer', path: './icon.bin' })
  })

  test('detects readFileSync(literal, { encoding: "utf-8" }) as sync-string', () => {
    const src = `
      import { readFileSync } from 'fs'
      const data = readFileSync('./x.json', { encoding: 'utf-8' })
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0].shape).toBe('sync-string')
  })

  test('detects async readFile from fs/promises', () => {
    const src = `
      import { readFile } from 'fs/promises'
      const data = await readFile('./x.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'async-string', path: './x.json' })
  })

  test('handles aliased imports: readFileSync as rfs', () => {
    const src = `
      import { readFileSync as rfs } from 'fs'
      const data = rfs('./y.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'sync-string', path: './y.json' })
  })

  test('handles namespace imports: import * as fs from "fs"', () => {
    const src = `
      import * as fs from 'fs'
      const data = fs.readFileSync('./y.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'sync-string', path: './y.json' })
  })

  test('handles default imports: import fs from "fs"', () => {
    const src = `
      import fs from 'fs'
      const data = fs.readFileSync('./y.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
  })

  test('detects Bun.file(literal).text() as bun-text', () => {
    const src = `
      const html = await Bun.file('./template.html').text()
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'bun-text', path: './template.html' })
  })

  test('detects Bun.file(literal).arrayBuffer() as bun-arraybuffer', () => {
    const src = `
      const buf = await Bun.file('./image.bin').arrayBuffer()
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const fsSites = sites.filter(s => s.type === 'fsRead')
    expect(fsSites).toHaveLength(1)
    expect(fsSites[0]).toMatchObject({ shape: 'bun-arraybuffer', path: './image.bin' })
  })

  test('skips non-literal path', () => {
    const src = `
      import { readFileSync } from 'fs'
      const path = './x.json'
      const data = readFileSync(path, 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    expect(sites.filter(s => s.type === 'fsRead')).toHaveLength(0)
  })

  test('skips dynamic encoding', () => {
    const src = `
      import { readFileSync } from 'fs'
      const enc = 'utf-8'
      const data = readFileSync('./x.json', enc)
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    expect(sites.filter(s => s.type === 'fsRead')).toHaveLength(0)
  })

  test('skips callback-style readFile from plain fs', () => {
    // `fs.readFile` (not from fs/promises) is callback-based; we can't
    // represent that as a literal so it stays a runtime fs lookup.
    const src = `
      import * as fs from 'fs'
      fs.readFile('./x.json', 'utf-8', (err, data) => {})
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    expect(sites.filter(s => s.type === 'fsRead')).toHaveLength(0)
  })

  test('inlines a small JSON file as a string literal', () => {
    writeFileSync(join(tmp, 'config.json'), JSON.stringify({ region: 'eu-west-1' }))
    const src = `
      import { readFileSync } from 'fs'
      const data = JSON.parse(readFileSync('./config.json', 'utf-8'))
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!
    expect(out).toContain('/* tekir inline-fs */')
    expect(out).toContain('eu-west-1')
    expect(out).not.toContain("readFileSync('./config.json'")
  })

  test('inlines a binary file as Buffer.from(base64)', () => {
    writeFileSync(join(tmp, 'icon.bin'), Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]))
    const src = `
      import { readFileSync } from 'fs'
      const buf = readFileSync('./icon.bin')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!
    expect(out).toContain('Buffer.from(')
    expect(out).toContain('"base64"')
  })

  test('inlines Bun.file(literal).text() as Promise.resolve(literal)', () => {
    writeFileSync(join(tmp, 'page.html'), '<h1>hi</h1>')
    const src = `const html = await Bun.file('./page.html').text()`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)!
    expect(out).toContain('Promise.resolve(')
    expect(out).toContain('<h1>hi</h1>')
    expect(out).not.toContain("Bun.file('./page.html')")
  })

  test('skips file that does not exist on disk (runtime fallback)', () => {
    const src = `
      import { readFileSync } from 'fs'
      const data = readFileSync('./missing.json', 'utf-8')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)
    // No imports were generated and the only site was skipped, so the
    // transformer leaves the source untouched (returns null).
    expect(out).toBeNull()
  })

  test('skips files larger than the inline threshold', () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0)
    writeFileSync(join(tmp, 'big.bin'), big)
    const src = `
      import { readFileSync } from 'fs'
      const data = readFileSync('./big.bin')
    `
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    const out = __internal.transformSource(src, sites, tmp)
    expect(out).toBeNull()
  })

  test('inliner pre-filter ignores files without any matching pattern', () => {
    const src = `const fileName = 'readFileSync(some-string)'`
    const sites = __internal.findCallSites(src, 'entry.ts', parseSync)
    expect(sites).toHaveLength(0)
  })
})
