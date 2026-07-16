import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { realpath } from 'fs/promises'

import { fileResponse, fileExists, isDirectory } from '@tekir/runtime'

import { getLogger } from '@tekir/core'
import type { ViteConfig } from './types'

/**
 * Contain a request pathname under `root` for the prod/public static
 * fallback. Mirrors `@tekir/static`'s `resolveSafePath` so this fallback
 * gets the same hardening: a `try/catch` around `decodeURIComponent`, a NUL
 * byte filter, an `isAbsolute(rel)` check (Windows cross-drive paths like
 * `/C:/Windows/win.ini` come back from `relative()` as an absolute path on
 * another drive and do not start with `..`), and a dotfile guard so
 * `public/.env` or `dist/.env` are never served. Returns the absolute path
 * on success, `null` on any rejection.
 */
function safeStaticPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  // Reject any segment that begins with `.` (e.g. `.env`, `.git`). Split on
  // both separators so a `%5C`-encoded backslash cannot smuggle a dot
  // segment past a `/`-only split on Windows.
  for (const segment of decoded.split(/[\\/]+/)) {
    if (segment.startsWith('.') && segment !== '.' && segment !== '..') {
      return null
    }
  }

  const filePath = resolve(root, decoded.replace(/^\/+/, ''))
  const rel = relative(root, filePath)
  if (rel === '..' || rel.startsWith('..') || rel.startsWith('/') || isAbsolute(rel)) {
    return null
  }
  return filePath
}

/** Refuse symlink chains whose final target leaves the served directory. */
async function realPathContained(filePath: string, root: string): Promise<boolean> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)])
    const rel = relative(realRoot, realFile)
    return !(rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
  } catch {
    return false
  }
}

/**
 * Auto-discover the user's vite.config.[tj]s in `baseDir`. We pass the
 * absolute path explicitly because we override `root` (e.g. to
 * 'resources'), which makes Vite's default auto-discovery look in the
 * wrong directory and silently drop the user's plugins (React, Vue,
 * etc.), leading to broken production bundles like "React is not
 * defined" at runtime.
 *
 * `baseDir` defaults to `process.cwd()` for backward compat with
 * callers that do not yet pass `ctx.appRoot`. The whole point of
 * `appRoot` is so users do not need `process.chdir(import.meta.dir)`
 * in their entry file. Tekir gives the middleware the canonical
 * project dir directly.
 */
function discoverViteConfig(baseDir?: string): string | undefined {
  const dir = baseDir ?? process.cwd()
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return undefined
}

/**
 * Vite plugin that injects Tekir's structural defaults (`root` and
 * `build.outDir`) only when the user's `vite.config.ts` has not
 * already set them. We deliberately do not default a path alias:
 * every framework picks its own (`@` in Vue/Vite starters, `~` in
 * Nuxt, `$lib` in SvelteKit) and the conventions collide. `~` also
 * has special CSS-import semantics in some toolchains
 * (webpack/Tailwind PostCSS treat `~foo` as a node_modules lookup).
 * Tekir stays neutral and lets the user pick their own alias in
 * `vite.config.ts`.
 */
function tekirDefaultsPlugin(absRoot: string, absBuildDir: string) {
  return {
    name: 'tekir:defaults',
    config(userConfig: any) {
      const patch: any = {}
      if (!userConfig?.root) {
        patch.root = absRoot
      }
      if (!userConfig?.build?.outDir) {
        patch.build = { ...(userConfig?.build ?? {}), outDir: absBuildDir, emptyOutDir: true }
      }
      return patch
    },
  }
}

function createViteLogger() {
  // Resolve a logger lazily, per call, so this middleware never depends
  // on the tekir container being populated at the time `vite()` runs.
  // The previous shape captured `getLogger()` up-front, which threw
  // "Logger not initialized" whenever module init ordered vite()
  // before `setContainer()` — easy to hit in production bundles where
  // Bun's bundler may reorder side-effectful imports, or when a copy
  // of @tekir/core ends up duplicated in the bundle and the vite
  // middleware sees a different module-scope `_logger` than the one
  // tekir() populates. We try the container first (so log lines stay
  // routed through the user's configured logger when available) and
  // fall back to `console` otherwise; either way the dev gateway and
  // build hook never crash on logging.
  const safeGet = () => {
    try { return getLogger() } catch { return null }
  }
  const clean = (msg: string) => msg.replace(/\n/g, '').trim()
  const out = (level: 'info' | 'warn' | 'error', msg: string) => {
    const l = safeGet()
    if (l) (l as any)[level](`[vite] ${clean(msg)}`)
    else console[level](`[vite] ${clean(msg)}`)
  }
  return {
    hasWarned: false,
    info(msg: string) { out('info', msg) },
    warn(msg: string) { this.hasWarned = true; out('warn', msg) },
    warnOnce(msg: string) { this.hasWarned = true; out('warn', msg) },
    error(msg: string) { out('error', msg) },
    clearScreen() {},
    hasErrorLogged(_err: any) { return false },
  }
}

interface SetupCtx {
  configStore?: {
    get?: <T = any>(key: string, defaultValue?: T) => T
    register?: (name: string, value: any) => void
  }
  appRoot?: string
}

/**
 * Integrate Vite with a Tekir server.
 *
 * Dev mode (gateway architecture): Vite owns the user-configured app
 * port and is the public-facing dev server. Tekir's HTTP server moves
 * to a free port picked via `get-port`. Vite proxies API paths
 * (`config.proxyPaths`, default `['/api']`) to Tekir; everything else
 * Vite serves directly. HMR works natively because the browser hits
 * Vite directly with no HTTP-only proxy in between.
 *
 * Prod mode: no Vite. Tekir HTTP server stays on the user port and
 * `server.fallback()` serves the build output (`dist/client/`) plus
 * the SPA index.html fallback.
 *
 * @param server The Tekir server instance.
 * @param config Vite-specific config.
 * @param ctx Tekir-injected context. `configStore` lets us read
 *   `app.port` and rewrite it to the auto-picked backend port.
 *   `appRoot` is the project root the user passed to
 *   `tekir({ appRoot })`, used for vite.config / public / dist
 *   resolution so the user does not need `process.chdir` in their
 *   entry file.
 *
 * @example
 * ```ts
 * vite(server, { root: 'resources', plugins: [react()] })
 * ```
 */
export async function vite(server: any, config: ViteConfig = {}, ctx: SetupCtx = {}) {
  const root = config.root || 'resources'
  const buildDir = config.buildDir || 'dist/client'
  const proxyPaths = config.proxyPaths ?? ['/api']
  const getIsDev = () => config.dev ?? process.env.NODE_ENV !== 'production'

  // `appRoot` is the canonical project dir Tekir was instantiated
  // against. We use it everywhere we used to use `process.cwd()` so
  // users do not need `process.chdir(import.meta.dir)` in their entry
  // for config discovery to work when launched from a different cwd
  // (turbo, pm2, etc.). Falls back to cwd if Tekir did not pass it
  // (older core version, kept for back-compat).
  const appRoot = ctx?.appRoot ?? process.cwd()

  const absRoot = join(appRoot, root)
  const absBuildDir = join(appRoot, buildDir)
  const defaultsPlugin = tekirDefaultsPlugin(absRoot, absBuildDir)

  // Register build hook (always; runs only when `tekir build` is invoked).
  server.onBuild(async () => {
    process.env.VITE_CJS_IGNORE_WARNING = 'true'
    const { build } = await import('vite')
    let logger: any
    try { logger = getLogger() } catch { logger = console }
    logger.info('[vite] Building...')
    const buildLogger = createViteLogger()
    await build({
      configFile: discoverViteConfig(appRoot),
      customLogger: buildLogger,
      plugins: [defaultsPlugin, ...(config.plugins ?? [])],
      css: config.css,
      define: config.define,
      ssr: config.ssr,
      optimizeDeps: config.optimizeDeps,
      envPrefix: 'VITE_',
      envDir: appRoot,
    })
    logger.info(`[vite] Build output: ${buildDir}`)
  })

  const isBuildMode = process.argv.includes('build')
  // The `tekir test` runner exports `TEKIR_RUNNER=test` before handing
  // control to the test runner. The dev gateway opens its own listener
  // on `app.port`, which would race with `@tekir/testing`'s
  // random-port `createTestApp` and collide if two tests run in the
  // same process. Skipping the gateway here keeps the canonical user
  // entry shape (`frontend: { type: 'vite' }` unconditional) without a
  // per-app `process.env.NODE_ENV === 'test' ? undefined : ...` ternary.
  // The build hook (`server.onBuild`) and prod fallback are still
  // registered; they don't bind anything, so they're safe under tests.
  const isTestRunner = process.env.TEKIR_RUNNER === 'test'

  // Dev mode: flip the architecture. Vite is the gateway on `app.port`;
  // Tekir moves to an auto-picked port that Vite proxies into.
  if (getIsDev() && !isBuildMode && !isTestRunner) {
    const { default: getPort } = await import('get-port')
    const configStore = ctx?.configStore
    const userPort = configStore?.get?.('app.port', 3000) ?? 3000

    // Pick a free port for Tekir's HTTP server. We avoid 5173 (Vite's
    // own default) and the user's port. `get-port` does an OS-level
    // ephemeral probe (`net.listen(0)`), so multiple Tekir apps on one
    // machine each get unique ports.
    const tekirPort = await getPort({ exclude: [userPort, 5173] })

    // Rewrite `app.port` BEFORE `server.start()` reads it (start runs
    // after this setup returns). Tekir HTTP server will bind
    // `tekirPort` instead of `userPort`.
    if (configStore?.register) {
      const appCfg = configStore.get?.('app', {}) ?? {}
      configStore.register('app', { ...appCfg, port: tekirPort })
    }

    process.env.VITE_CJS_IGNORE_WARNING = 'true'
    const { createServer } = await import('vite')

    // Build proxy table: every prefix in `proxyPaths` forwards to the
    // Tekir backend. `changeOrigin: true` so the backend sees its own
    // host (avoids cookie domain weirdness); `ws: true` so any upgrade
    // requests on `/api` (Server-Sent Events / WebSockets the user's
    // routes might use) work too.
    const proxy: Record<string, any> = {}
    for (const p of proxyPaths) {
      proxy[p] = {
        target: `http://localhost:${tekirPort}`,
        changeOrigin: true,
        ws: true,
      }
    }

    const viteServer = await createServer({
      // root, build.outDir come from `tekirDefaultsPlugin` (only
      // applied where the user did not already set them in their
      // vite.config.ts). User plugins are added after so they can
      // override anything if they really want to.
      configFile: discoverViteConfig(appRoot),
      appType: 'spa',
      customLogger: createViteLogger(),
      plugins: [defaultsPlugin, ...(config.plugins ?? [])],
      css: config.css,
      define: config.define,
      ssr: config.ssr,
      optimizeDeps: config.optimizeDeps,
      envPrefix: 'VITE_',
      envDir: appRoot,
      // `strictPort: true` so if `userPort` is taken we fail loudly
      // instead of silently drifting to a different port (the user
      // explicitly asked for this port via `app.port`). HMR uses the
      // same port automatically when `hmr` is omitted, so the
      // browser's WS connect just works.
      server: {
        port: userPort,
        strictPort: true,
        proxy,
      },
    })
    await viteServer.listen()
    server.onStop?.(() => viteServer.close())

    let logger: any
    try { logger = getLogger() } catch { logger = console }
    logger.info(`[vite] gateway on http://localhost:${userPort} -> tekir http://localhost:${tekirPort}`)
  }

  // Prod fallback: no Vite. Tekir HTTP server stays on the user port.
  // We register a fallback to serve build output for any path the
  // router did not claim. This path is also used by compiled binaries
  // (the embed map fast path).
  const notFoundJson = () => new Response(
    '{"error":"Not Found"}',
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  )

  // Backend prefixes are owned by the router; if a request for a
  // proxied path reaches the fallback, the router did not match it
  // and the client wants a clean JSON 404, not the SPA shell. This
  // mirrors the dev gateway, where the same `proxyPaths` list is the
  // source of truth for what Vite forwards to the backend.
  const isBackendPath = (pathname: string) =>
    proxyPaths.some(p => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))

  server.fallback(async (req: Request) => {
    const url = new URL(req.url)

    if (isBackendPath(url.pathname)) return notFoundJson()

    const embed = (globalThis as any).__TEKIR_VITE_EMBED__ as Map<string, string> | undefined
    if (embed && !getIsDev()) {
      const blob = embed.get(url.pathname) || embed.get('/index.html')
      if (blob) return new Response(Bun.file(blob))
      return notFoundJson()
    }

    if (url.pathname !== '/') {
      const publicRoot = resolve(appRoot, 'public')
      const publicPath = safeStaticPath(publicRoot, url.pathname)
      if (
        publicPath &&
        await fileExists(publicPath) &&
        !(await isDirectory(publicPath)) &&
        await realPathContained(publicPath, publicRoot)
      ) {
        return fileResponse(publicPath)
      }
    }

    // Dev mode never reaches here for frontend assets (Vite is the
    // gateway). It only reaches this for backend requests Vite
    // proxied here that the router did not match. Return a clean
    // 404 so Vite forwards it to the client.
    if (getIsDev()) {
      return notFoundJson()
    }

    // Prod: serve from build output.
    const distRoot = resolve(appRoot, buildDir)
    if (!(await fileExists(distRoot))) {
      return notFoundJson()
    }
    const distFile = safeStaticPath(distRoot, url.pathname)
    // `!isDirectory` matters for the root path: when `url.pathname` is
    // `/`, `distFile` resolves to `distRoot` itself, which exists as a
    // directory. Without the guard `fileResponse(distRoot)` would try
    // to read the directory like a file and crash with EISDIR. The
    // SPA fallback below is what serves `index.html` for `/`.
    if (
      distFile &&
      await fileExists(distFile) &&
      !(await isDirectory(distFile)) &&
      await realPathContained(distFile, distRoot)
    ) {
      return fileResponse(distFile)
    }

    // SPA fallback: serve index.html for client-side routing.
    const indexPath = join(distRoot, 'index.html')
    if (await fileExists(indexPath) && await realPathContained(indexPath, distRoot)) {
      return fileResponse(indexPath)
    }
    return notFoundJson()
  })
}
