import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tekir } from '../src'

/**
 * End-to-end tests for the `frontend: 'bun'` env exposure contract.
 *
 * tekir uses Bun's `import(htmlPath)` + HTMLBundle pattern so that
 * `bun build --compile` can embed every HTML page and its bundled assets
 * into a single executable. As a side-effect of this pattern, Bun does
 * NOT substitute `process.env.X` at bundle time. This suite pins that
 * behaviour so we catch any regression where a secret value (or even a
 * PUBLIC_* literal) could appear in the served bundle.
 *
 * If Bun later exposes a `define` / `env` hook for HTMLBundle routes, we
 * can add opt-in PUBLIC_* inlining and update these tests.
 */

const SECRETS = {
  DATABASE_URL: 'postgres://u:p@host/secret_db',
  APP_KEY: 'super-secret-app-key-should-never-leak',
  JWT_SECRET: 'jwt-secret-should-never-leak-123',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-7788-should-never-leak',
  STRIPE_SECRET_KEY: 'sk_test_STRIPE_MUST_NOT_LEAK',
}
const PUBLIC_VARS = {
  PUBLIC_API_URL: 'https://api.example.com',
  PUBLIC_APP_NAME: 'TekirTest',
}

const originalEnv: Record<string, string | undefined> = {}

let tmpRoot: string
let baseUrl: string
let tekirApp: any
let firstJsUrl = ''
let firstJsBody = ''
let indexHtml = ''

async function pickChunk(html: string, base: string) {
  const match = html.match(/src="([^"]+\.(?:js|mjs))"/i)
  if (!match) throw new Error('no chunk script in html')
  const url = new URL(match[1], base).toString()
  const body = await (await fetch(url)).text()
  return { url, body }
}

describe('Frontend env exposure (integration, frontend: "bun")', () => {
  beforeAll(async () => {
    for (const k of Object.keys({ ...SECRETS, ...PUBLIC_VARS })) {
      originalEnv[k] = process.env[k]
    }
    for (const [k, v] of Object.entries({ ...SECRETS, ...PUBLIC_VARS })) {
      process.env[k] = v
    }

    tmpRoot = join(import.meta.dir, '__env_fixture__')
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
    mkdirSync(join(tmpRoot, 'resources'), { recursive: true })

    writeFileSync(
      join(tmpRoot, 'resources', 'index.html'),
      `<!doctype html><html><head><title>t</title></head><body>
<div id="root"></div>
<script type="module" src="./main.ts"></script>
</body></html>`,
    )

    writeFileSync(
      join(tmpRoot, 'resources', 'main.ts'),
      // Reference each var so the bundler cannot tree-shake them out.
      // None of these values should end up in the served bundle.
      `const envSnapshot = {
  apiUrl: process.env.PUBLIC_API_URL,
  appName: process.env.PUBLIC_APP_NAME,
  db: process.env.DATABASE_URL,
  appKey: process.env.APP_KEY,
  jwt: process.env.JWT_SECRET,
  aws: process.env.AWS_SECRET_ACCESS_KEY,
  stripe: process.env.STRIPE_SECRET_KEY,
}
;(globalThis as any).__envSnapshot = envSnapshot
document.getElementById('root')!.textContent = JSON.stringify(envSnapshot)
`,
    )

    const port = 14800 + Math.floor(Math.random() * 200)
    baseUrl = `http://127.0.0.1:${port}`

    tekirApp = await tekir({
      appRoot: tmpRoot,
      config: { app: { name: 'envtest', port, env: 'production' } },
      frontend: { type: 'bun', root: 'resources' },
    })
    // This test needs a real listener to fetch served bundles, so opt
    // out of the `tekir test` runner's auto-skip via `force: true`.
    tekirApp.start({ force: true })

    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`${baseUrl}/`)
        if (r.status < 500) break
      } catch { /* spin */ }
      await new Promise((r) => setTimeout(r, 50))
    }

    indexHtml = await (await fetch(`${baseUrl}/`)).text()
    const picked = await pickChunk(indexHtml, baseUrl)
    firstJsUrl = picked.url
    firstJsBody = picked.body
  })

  afterAll(() => {
    try { tekirApp?.server?.stop?.() } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  // ── Baseline (server + bundler wiring works) ──────────────────────
  test('server serves the bundled index.html at /', async () => {
    expect(indexHtml.toLowerCase()).toContain('<html')
    expect(indexHtml).toMatch(/<script[^>]*src="[^"]+\.(?:js|mjs)"/)
  })

  test('a bundled JS chunk is reachable at the URL the HTML references', async () => {
    expect(firstJsUrl).toMatch(/\.(?:js|mjs)$/)
    expect(firstJsBody.length).toBeGreaterThan(0)
  })

  // ── Secret non-exposure ────────────────────────────────────────────
  test('DATABASE_URL never leaks to the bundle', () => {
    expect(firstJsBody).not.toContain(SECRETS.DATABASE_URL)
    expect(firstJsBody).not.toContain('secret_db')
  })

  test('APP_KEY never leaks to the bundle', () => {
    expect(firstJsBody).not.toContain(SECRETS.APP_KEY)
    expect(firstJsBody).not.toContain('super-secret-app-key')
  })

  test('JWT_SECRET never leaks to the bundle', () => {
    expect(firstJsBody).not.toContain(SECRETS.JWT_SECRET)
    expect(firstJsBody).not.toContain('jwt-secret-should-never-leak')
  })

  test('AWS_SECRET_ACCESS_KEY never leaks', () => {
    expect(firstJsBody).not.toContain(SECRETS.AWS_SECRET_ACCESS_KEY)
  })

  test('STRIPE_SECRET_KEY never leaks', () => {
    expect(firstJsBody).not.toContain(SECRETS.STRIPE_SECRET_KEY)
    expect(firstJsBody).not.toContain('sk_test_STRIPE')
  })

  test('the HTML response itself never contains any secret', () => {
    for (const secret of Object.values(SECRETS)) {
      expect(indexHtml).not.toContain(secret)
    }
  })

  test('PUBLIC_* values are also NOT inlined (current Bun HTMLBundle contract)', () => {
    // Bun's HTMLBundle pipeline does not do `process.env.X` substitution.
    // Nothing reaches the browser by default. If a future Bun release
    // enables substitution without a prefix filter, this test fires so we
    // can add explicit protection before secrets follow.
    expect(firstJsBody).not.toContain(PUBLIC_VARS.PUBLIC_API_URL)
    expect(firstJsBody).not.toContain(PUBLIC_VARS.PUBLIC_APP_NAME)
  })

  // ── Paranoia sweep across every served asset ──────────────────────
  test('NO served asset anywhere contains any secret value', async () => {
    const seen = new Set<string>([firstJsUrl, `${baseUrl}/`])
    const jsUrls = [...firstJsBody.matchAll(/["'](\/[^"']+\.(?:js|mjs|css))["']/g)].map((m) => new URL(m[1], baseUrl).toString())
    for (const u of jsUrls) seen.add(u)

    const bodies: string[] = []
    for (const u of seen) {
      const r = await fetch(u)
      if (r.status !== 200) continue
      bodies.push(await r.text())
    }

    for (const body of bodies) {
      for (const secret of Object.values(SECRETS)) {
        expect(body).not.toContain(secret)
      }
    }
  })
})
