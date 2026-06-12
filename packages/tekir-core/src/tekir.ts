import { TekirServer } from './server/server'
import { App } from './app'
import { setContainer } from './container'
import { createConfigStore, type ConfigStore } from '@tekir/config'
import { createLogger, type Logger } from '@tekir/logger'
import { builtInCommands } from './cli/index'
import { captureCallerFile } from './loader'
import { join, isAbsolute, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

/**
 * The runtime environment the application is running in.
 * - `'web'`: HTTP server mode (default)
 * - `'console'`: CLI/artisan command mode
 * - `'test'`: test runner mode (NODE_ENV=test)
 */
export type Environment = 'web' | 'console' | 'test'

/**
 * Shape of `config/app.ts` for projects scaffolded with create-tekir-app.
 * All fields are optional, so apps can extend the object with their own keys
 * (for example `defaultLocale`, `timezone`, etc.) without losing autocomplete
 * on the framework-known fields.
 */
export interface AppConfig {
  /** Human-readable application name. */
  name?: string
  /** Application encryption key, used by sessions, signed cookies, JWTs. */
  key?: string
  /** HTTP port the server listens on. */
  port?: number
  /**
   * Network interface the server binds to. Defaults to `'0.0.0.0'` (all
   * interfaces). Set `'127.0.0.1'` to accept only local connections, or a
   * specific LAN/host address. Typically wired from an env var in
   * `config/app.ts`, e.g. `host: process.env.HOST ?? '0.0.0.0'`.
   */
  host?: string
  /** Alias for {@link host}, matching Bun.serve's option name. `host` wins if both are set. */
  hostname?: string
  /** Runtime environment label (`'production'`, `'development'`, etc.). */
  env?: string
  /** Override `tekir()`'s auto-detected runtime environment. */
  environment?: Environment
  /** Allow apps to add their own keys without losing type safety on the rest. */
  [key: string]: unknown
}

/**
 * Options passed to `app.start()` to configure server startup.
 * @example
 * app.start({ mode: 'production', callback: () => console.log('Ready!') })
 * // or simply:
 * app.start(() => console.log('Server running'))
 */
export interface StartOptions {
  /** Force `'production'` or `'development'` mode regardless of env config. */
  mode?: 'production' | 'development'
  /** Callback executed after the server starts listening. */
  callback?: () => void | Promise<void>
  /**
   * Bind the listener even when the process was launched via `tekir test`
   * (i.e. when `process.env.TEKIR_RUNNER === 'test'`). Off by default so
   * a user entry's top-level `app.start()` does not fight the test
   * runner; integration tests that need a real socket pass `true`.
   */
  force?: boolean
}

/**
 * Configuration options for creating a Tekir application via `tekir()`.
 * @example
 * const app = await tekir({
 *   appRoot: import.meta.dir,
 *   config: { app: { port: 4000 } },
 *   middleware: [cors(), bodyParser()],
 * })
 */
export interface TekirOptions {
  /**
   * Root directory of the application. When omitted, `tekir()` walks
   * the call stack to find the file that called it and uses its
   * `dirname`, falling back to `process.cwd()` only if no user frame
   * is recoverable. The auto-detection means most users do not need
   * to set this. `tekir()` from `admin/index.ts` resolves to the
   * `admin/` directory regardless of how the process was launched
   * (turbo from the repo root, pm2 from `/`, plain `bun run dev` from
   * any cwd).
   */
  appRoot?: string
  /** Override auto-detected environment (`'web'`, `'console'`, or `'test'`). */
  environment?: Environment
  /** Inline config object. Use instead of loading from `config/` directory. */
  config?: Record<string, any>
  /** Service providers to register (class constructors or instances). */
  providers?: (any | (new () => any))[]
  /** Server-level middleware applied to every incoming request. */
  middleware?: any[]
  /** Router-level middleware applied only to matched routes. */
  routerMiddleware?: any[]
  /**
   * Inline route registration. Runs after providers boot, so services are
   * available. Methods on the passed router are pre-bound so destructuring
   * works.
   * @example
   * routes: ({ get, post }) => {
   *   get('/health', () => ({ ok: true }))
   *   post('/users', async ({ body }) => createUser(body))
   * }
   */
  routes?: (router: ReturnType<TekirServer['getRouter']>) => void | Promise<void>
  /**
   * Path to an env-setup file (relative to `appRoot`, or absolute). Loaded
   * once at boot for its side effects. Skipped silently when the file does
   * not exist; never set, never scanned.
   */
  envFile?: string
  /**
   * Directory of config files (relative to `appRoot`, or absolute). Each
   * `*.{ts,js,mjs}` file is loaded into the config store. Skipped silently
   * when the directory does not exist; never set, never scanned.
   */
  configDir?: string
  /**
   * Directory containing `kernel.{ts,js,...}`, `routes.{ts,...}`,
   * `boot.{ts,...}`, `commands.{ts,...}` (relative to `appRoot`, or
   * absolute). Each file's default export is awaited with the booted
   * `TekirApp`. Skipped silently when the directory does not exist; never
   * set, never scanned.
   */
  startDir?: string
  /** Frontend framework integration (Vite, Next.js, or raw Bun). */
  frontend?: {
    type: 'vite' | 'next' | 'bun'
    [key: string]: any
  }
}

/**
 * The main application instance returned by `tekir()`.
 * Provides access to the HTTP server, router, logger, config, and lifecycle hooks.
 *
 * @example
 * const app = await tekir()
 * app.router.get('/hello', () => ({ message: 'Hello!' }))
 * app.start(() => console.log('Running'))
 */
export interface TekirApp {
  /** The IoC container holding all registered services. */
  app: App
  /** The underlying HTTP server instance. */
  server: TekirServer
  /** The application router for defining routes, groups, and resources. */
  router: ReturnType<TekirServer['getRouter']>
  /** The application logger (pino-compatible). */
  logger: Logger
  /** Read a config value: `config('app.port', 3000)`. */
  config: ConfigStore['get']
  /** The detected runtime environment (`'web'`, `'console'`, or `'test'`). */
  environment: Environment
  /** Retrieve a registered service by name with type inference. */
  service: <T extends object>(name: string) => T
  /** Register a callback to run after `app.start()`. Returns `this` for chaining. */
  onStart: (fn: () => void | Promise<void>) => TekirApp
  /** Register a callback to run on `app.shutdown()`. Returns `this` for chaining. */
  onShutdown: (fn: () => void | Promise<void>) => TekirApp
  /**
   * Start the HTTP server. Accepts either a callback or a `StartOptions` object.
   * @example
   * app.start(() => console.log('Listening on port 3000'))
   * app.start({ mode: 'production' })
   */
  start: (options?: StartOptions | (() => void | Promise<void>)) => void
  shutdown: () => Promise<void>
}

// Convert a filesystem path into something `import()` accepts on every
// platform. On Windows, Node ESM refuses to import a bare absolute path
// (`C:\...`); `pathToFileURL` produces a proper `file://` URL. Relative paths
// fall back to the old slash-normalized form.
function toPath(p: string): string {
  return isAbsolute(p) ? pathToFileURL(p).href : p.replace(/\\/g, '/')
}

async function loadStartDir(dir: string, ctx: any): Promise<void> {
  if (!existsSync(dir)) return

  const { readdirSync } = await import('fs')
  const files = readdirSync(dir)
    .filter(f => /\.(ts|tsx|js|jsx)$/.test(f))
    .map(f => f.replace(/\.(ts|tsx|js|jsx)$/, ''))
    .filter(f => f !== 'kernel')

  // boot first, routes last, rest in between
  const ordered = [
    ...files.filter(f => f === 'boot'),
    ...files.filter(f => f !== 'boot' && f !== 'routes').sort(),
    ...files.filter(f => f === 'routes'),
  ]

  for (const name of ordered) {
    await tryImport(dir, name, ctx)
  }
}

async function tryImport(dir: string, name: string, ctx?: any): Promise<any> {
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const full = join(dir, name + ext)
    if (existsSync(full)) {
      const mod = await import(toPath(full))
      if (ctx && typeof mod.default === 'function') await mod.default(ctx)
      return mod
    }
  }
  return null
}

function detectEnvironment(): Environment {
  // First positional arg, ignoring leading flags. Same shape we use in
  // the dispatcher: `./server --port 8080 migrate` should still resolve
  // to the `migrate` command (so 'console' environment), and
  // `./server --port 8080` (no command) stays 'web'.
  const cmd = process.argv.slice(2).find(a => !a.startsWith('-'))
  if (process.env.NODE_ENV === 'test') return 'test'
  if (cmd && !['serve', 'build'].includes(cmd)) return 'console'
  return 'web'
}



/**
 * Create and boot a new Tekir application. Loads env, config, providers,
 * middleware, routes, and returns a ready-to-start `TekirApp` instance.
 *
 * @param options - Application configuration (root dir, inline config, providers, middleware, frontend).
 * @returns A fully configured `TekirApp`. Call `app.start()` to begin listening.
 *
 * @example
 * ```ts
 * import { tekir } from '@tekir/core'
 *
 * const app = await tekir({ appRoot: import.meta.dir })
 *
 * app.router.get('/hello', () => ({ message: 'Hello World!' }))
 *
 * app.start(() => {
 *   console.log(`Server running at http://localhost:${process.env.PORT || 3000}`)
 * })
 * ```
 */
export async function tekir(options: TekirOptions = {}): Promise<TekirApp> {
  // Identify the dispatched command. We scan past leading flags so the
  // resolution holds for invocations where the operator put options
  // before the command word. The shape is identical in source mode
  // (`bun run index.ts --foo bar build`) and in compiled binaries
  // (`./server --port 8080 build`); in both, `process.argv[2]` is the
  // first user arg, but it can be a flag, so a positional `find` is
  // the right primitive instead of a fixed index.
  const cliCmd = process.argv.slice(2).find(a => !a.startsWith('-'))

  // Set NODE_ENV early so middleware that reads it at module init (vite,
  // logger pretty-print, etc.) sees the right mode before user code runs.
  //   - `tekir build`        forces 'production' regardless of shell.
  //   - `tekir serve` (no `--dev`) defaults to 'production' when the
  //     shell did not set it; the cli bin already exports
  //     NODE_ENV='development' before re-execing the watch child for
  //     `--dev`, so the dev path is preserved.
  if (cliCmd === 'build') {
    (process.env as any).NODE_ENV = 'production'
    // Mirror the cli bin's default for the raw `bun run index.ts build`
    // path (no @tekir/cli in the loop). Library code uses
    // `TEKIR_RUNNER === 'build'` to short-circuit eager module init
    // (Redis subscribers, queue workers, fs watchers, scheduler ticks)
    // so the bundler does not pay for connections it never uses.
    if (!process.env.TEKIR_RUNNER) (process.env as any).TEKIR_RUNNER = 'build'
  } else if (cliCmd === 'serve' && !process.env.NODE_ENV) {
    (process.env as any).NODE_ENV = 'production'
  }

  // `appRoot` resolution priority:
  //   1. Explicit `options.appRoot` (caller knows what they want).
  //   2. Auto-detect via stack inspection: walk frames upward from
  //      `tekir()` and pick the first user file. That is the entry
  //      that called us (e.g. `admin/index.ts`), so `dirname(callerFile)`
  //      is the right project root regardless of how the process was
  //      launched (turbo from repo root, pm2 from `/`, plain `bun run
  //      dev` from any cwd).
  //   3. `process.cwd()` as last-resort fallback when stack inspection
  //      cannot find a user frame (e.g. an inlined build artifact whose
  //      stack frames carry no source paths).
  // Same pattern `router.registerDir` uses to resolve `'./controllers'`
  // file-relative; extending it to the project root means users never
  // need a `process.chdir(import.meta.dir)` workaround.
  const callerFile = options.appRoot ? null : captureCallerFile(tekir)
  const appRoot = options.appRoot
    || (callerFile
      ? dirname(callerFile.startsWith('file://') ? fileURLToPath(callerFile) : callerFile)
      : process.cwd())
  const environment = options.environment || detectEnvironment()

  // Resolve any explicit autoload path (absolute, or relative to appRoot)
  // up-front so each step below can read directly off the resolved value.
  const resolvePath = (p: string) => isAbsolute(p) ? p : join(appRoot, p)
  const envFilePath = options.envFile ? resolvePath(options.envFile) : null
  const configDirPath = options.configDir ? resolvePath(options.configDir) : null
  const startDirPath = options.startDir ? resolvePath(options.startDir) : null

  // 1. Env: loaded only when the user opted in via `envFile`. Tekir does
  // not scan `<appRoot>/env.ts` or any sibling dir on its own; that pattern
  // collided with project-owned scripts named `env.ts` in the wild.
  if (envFilePath && existsSync(envFilePath)) {
    await import(toPath(envFilePath))
  }

  // 2. Config: each app gets its own config store
  const configStore = createConfigStore()
  if (configDirPath) {
    await configStore.loadDir(configDirPath)
  }
  if (options.config) {
    for (const [key, value] of Object.entries(options.config)) {
      configStore.register(key, value)
    }
  }
  const config = configStore.get

  // 3. Logger
  const logger = createLogger(config('logger', { level: 'info', pretty: true, name: 'tekir' }))

  // 4. App container + core services
  const app = new App()
  const server = new TekirServer()
  const router = server.getRouter()

  app.instance('logger', logger)
  app.instance('config', config)
  app.instance('server', server)
  app.instance('router', router)

  // 5. Module-scoped container (first tekir only, for lazy imports)
  setContainer(app, server, logger)

  const _onStart: (() => void | Promise<void>)[] = []
  const _onShutdown: (() => void | Promise<void>)[] = []

  const tekirApp: TekirApp = {
    app, server, router, logger, config, environment,
    service<T extends object>(name: string): T {
      let _cached: T
      return new Proxy({} as T, {
        get(_, prop) { return ((_cached ?? (_cached = app.use(name))) as any)[prop] },
      })
    },
    onStart(fn) { _onStart.push(fn); return tekirApp },
    onShutdown(fn) { _onShutdown.push(fn); return tekirApp },
    async start(options?) {
      const cb = typeof options === 'function' ? options : options?.callback
      const mode = typeof options === 'object' ? options.mode : undefined
      const force = typeof options === 'object' ? options.force : false
      // `tekir test` (the cli's test command) exports `TEKIR_RUNNER=test`
      // before handing control to the test runner. Any user entry that
      // is imported by a test file then short-circuits its top-level
      // `app.start()` call here, so the bind never fights the test
      // runner's lifecycle. Tests that genuinely want a real socket
      // (integration smoke tests, request fixtures) opt back in with
      // `app.start({ force: true })`. The lower-level `server.start()`
      // (used by `@tekir/testing`'s `createTestApp`) is unaffected.
      if (!force && process.env.TEKIR_RUNNER === 'test') return
      const port = config('app.port', 3000)
      // `app.host` controls the bind interface alongside `app.port`. Left
      // unset so the server's own default (`0.0.0.0`, all interfaces)
      // applies; set it to `127.0.0.1` for local-only, or a specific
      // address. Wire it from an env var in `config/app.ts` the same way
      // `port` is, e.g. `host: process.env.HOST ?? '0.0.0.0'`. `app.hostname`
      // is accepted as an alias (Bun.serve's spelling); `host` wins.
      const hostname = config<string | undefined>('app.host', undefined)
        ?? config<string | undefined>('app.hostname', undefined)
      const isDev = mode ? mode === 'development' : config('app.env', 'development') === 'development'
      // Read `app.idleTimeout` (seconds) from config so apps can ship a
      // server-wide setting alongside `port` without touching the server
      // instance directly. Falls through to the server's default (0, no
      // timeout) when unset, which keeps SSE and long-poll streams open.
      const idleTimeout = config<number | undefined>('app.idleTimeout', undefined)

      server.configure({
        port,
        development: isDev,
        ...(hostname !== undefined ? { hostname } : {}),
        ...(idleTimeout !== undefined ? { idleTimeout } : {}),
      })
      server.start()

      // Graceful shutdown in every mode (not just dev): catch SIGINT/SIGTERM
      // so providers (DB pools, queues) run their cleanup and in-flight
      // requests drain via `server.stop()` before the process exits. A guard
      // prevents double-shutdown if both signals fire.
      let shuttingDown = false
      const onSignal = async () => {
        if (shuttingDown) return
        shuttingDown = true
        try { await tekirApp.shutdown() } catch {}
        process.exit(0)
      }
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      for (const fn of _onStart) await fn()
      if (cb) await cb()
    },
    async shutdown() {
      for (const fn of _onShutdown) await fn()
      await app.shutdown()
      server.stop()
    },
  }

  // 6. Kernel (providers + middleware): loaded only when `startDir` is set.
  if (startDirPath) {
    await tryImport(startDirPath, 'kernel', tekirApp)
  }

  // 6b. Inline providers (for single-file apps)
  if (options.providers) {
    app.registerAll(options.providers)
  }

  // 6c. Frontend integration (from options or config)
  const frontendOpts = options.frontend || config('frontend')
  let viteMod: any = null
  if (frontendOpts) {
    const { type, ...frontendConfig } = frontendOpts

    if (type === 'bun') {
      // Native Bun fullstack. Use Bun's `import()` of HTML files so the
      // bundler embeds each page + its referenced assets directly into
      // the executable when `bun build --compile` is used. This is the
      // only pattern Bun currently supports for single-file executables
      // that ship a frontend.
      const frontendRoot = frontendConfig.root || 'resources'
      const absRoot = join(appRoot, frontendRoot)
      if (existsSync(absRoot)) {
        const { readdirSync } = await import('fs')
        const htmlFiles = readdirSync(absRoot).filter((f: string) => f.endsWith('.html'))
        for (const file of htmlFiles) {
          const fullPath = join(absRoot, file)
          const routePath = file === 'index.html' ? '/' : `/${file.replace('.html', '')}`
          const htmlModule = await import(toPath(fullPath))
          server.addStaticRoute(routePath, htmlModule.default || htmlModule)
        }
      }
    } else {
      const pkgMap: Record<string, string> = { vite: '@tekir/vite', next: '@tekir/next' }
      const pkg = pkgMap[type]
      if (!pkg) throw new Error(`Unknown frontend type: "${type}". Use "vite", "next", or "bun".`)
      // Compiled-binary path: when `bun build --compile` produces an
      // executable, the generated wrapper hands us the frontend module via
      // globalThis. createRequire below can't read package.json from disk
      // because there is no disk inside the bundle.
      let mod: any = (globalThis as any)[`__TEKIR_FRONTEND_MOD_${type}`]
      if (!mod) {
        try {
          const { createRequire } = await import('module')
          const appRequire = createRequire(join(appRoot, 'package.json'))
          mod = appRequire(pkg)
        } catch (_e: any) {
          throw new Error(`Frontend "${type}" requires "${pkg}" package. Run: bun add ${pkg}`)
        }
      }
      const setup = mod.vite || mod.next
      if (!setup) throw new Error(`Package "${pkg}" does not export a valid setup function`)
      // Pass a `ctx` argument so frontend setups (notably the vite
      // gateway mode) can read `app.port` from the configStore and
      // rewrite it to a backend port BEFORE `server.start()` reads
      // the value, plus access `appRoot` for vite.config / public /
      // dist resolution. The third arg is optional. Older setups
      // that take only `(server, config)` continue to work.
      await setup(server, frontendConfig, { configStore, appRoot })
      if (type === 'vite') viteMod = mod
    }
  }

  // 6d. Inline middleware + named middleware
  if (options.middleware) router.useGlobal(options.middleware)
  if (options.routerMiddleware) router.useRouter(options.routerMiddleware)

  // 6e. Early CLI commands that must run before providers boot
  if (cliCmd === 'generate:key') {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const key = Buffer.from(bytes).toString('base64')

    const envPath = join(appRoot, '.env')
    const { existsSync: envExists, readFileSync: readEnv, writeFileSync: writeEnv } = await import('fs')

    if (envExists(envPath)) {
      let content = readEnv(envPath, 'utf8')
      if (/^APP_KEY=.+/m.test(content)) {
        content = content.replace(/^APP_KEY=.+/m, `APP_KEY=${key}`)
        writeEnv(envPath, content)
        logger.info('APP_KEY replaced in .env')
      } else {
        writeEnv(envPath, content.trimEnd() + `\nAPP_KEY=${key}\n`)
        logger.info('APP_KEY added to .env')
      }
    } else {
      writeEnv(envPath, `APP_KEY=${key}\n`)
      logger.info('Created .env with APP_KEY')
    }

    // Do not print the generated secret. Logging it risks the key leaking into
    // CI output, log aggregators, or terminal scrollback. The .env write above
    // is the source of truth.
    logger.info('APP_KEY generated and written to .env')
    process.exit(0)
  }

  // 7. Boot providers
  await app.boot()

  // 8. Load all start/ files (except kernel which already loaded). Only
  // runs when the user opted in via `startDir`.
  if (startDirPath) {
    if (environment === 'web' || environment === 'test') {
      await loadStartDir(startDirPath, tekirApp)
    } else if (environment === 'console') {
      await tryImport(startDirPath, 'boot', tekirApp)
    }
  }

  // 9. Inline routes callback. Bind methods through a Proxy so destructuring
  // (`routes: ({ get, post }) => ...`) works without losing `this`.
  if (options.routes) {
    const boundRouter = new Proxy(router, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await options.routes(boundRouter)
  }

  // 10. CLI or server. Reuse the flag-aware command resolution from the
  // top of `tekir()` so the dispatch matches the early NODE_ENV setter
  // and stays correct whether the operator put options before or after
  // the command word (matters for compiled binaries especially).
  const allArgs = process.argv.slice(2)
  const commandName = cliCmd
  // Args forwarded to commands: everything except the command word
  // itself. Removes a single occurrence so flags surrounding the
  // command (`--foo build --bar`, `build --bar`, `--foo build`) all
  // collapse to the same `[--foo, --bar]` payload downstream.
  const cmdIdx = commandName ? allArgs.indexOf(commandName) : -1
  const args = cmdIdx >= 0 ? [...allArgs.slice(0, cmdIdx), ...allArgs.slice(cmdIdx + 1)] : allArgs

  if (commandName === 'build') {
    // `bun build --compile` produces a binary that embeds the entry but
    // not Bun's own bundler. Running `./server build` against such a
    // binary would call `Bun.build` over the embed virtual fs and either
    // fail outright or produce nonsense. Detect compiled binaries with
    // two signals:
    //   1. `Bun.main` contains the embed virtual-fs marker (`~BUN`,
    //      e.g. `B:/~BUN/root/srv` on Windows, `/~BUN/root/srv` on
    //      Unix). Source mode points at the real entry path on disk.
    //   2. `process.execPath` does not end with `bun` / `bun.exe`. In a
    //      compiled binary it points at the binary itself; in source
    //      mode it points at the Bun runtime.
    // Either signal alone is enough; the pair covers Bun versions that
    // shift one of them.
    const bunGlobal: any = (globalThis as any).Bun
    const mainStr: string = typeof bunGlobal?.main === 'string' ? bunGlobal.main : ''
    const mainSignal = mainStr.indexOf('~BUN') !== -1
    const exec = process.execPath || ''
    const lastFwd = exec.lastIndexOf('/')
    const lastBack = exec.lastIndexOf(String.fromCharCode(92))
    const lastSlash = lastFwd > lastBack ? lastFwd : lastBack
    const execBase = lastSlash >= 0 ? exec.slice(lastSlash + 1) : exec
    const execSignal = execBase !== 'bun' && execBase !== 'bun.exe'
    if (mainSignal || execSignal) {
      logger.error('`build` is not available inside a compiled binary. Run it from the project source instead.')
      process.exit(1)
    }

    (process.env as any).NODE_ENV = 'production'
    logger.info('Building for production...')
    await server.build()

    // `args` already has the `build` word removed by the dispatcher
    // up top, so it is just the flags the operator passed alongside.
    const buildArgs = args
    const hasOutdir = buildArgs.some(a => a === '--outdir' || a.startsWith('--outdir='))
    const hasCompile = buildArgs.includes('--compile')

    // Bare `bun run index.ts build` (no --compile, no --outdir) only warms
    // server.build() above. Skip Bun.build entirely in that case.
    if (!hasCompile && !hasOutdir) {
      logger.info('Build complete')
      process.exit(0)
    }

    const { runBuild } = await import('./build/runner')
    let buildEntry = process.argv[1] || 'index.ts'
    const extraPlugins: any[] = []
    const extraExternals: string[] = []
    let viteCleanupBuildDir: string | null = null

    const frontendType = frontendOpts?.type
    if (hasCompile && frontendType === 'next') {
      logger.error('Single executable is not supported with frontend "next" yet. Use "vite" or "bun".')
      process.exit(1)
    }

    if (hasCompile && frontendType === 'vite') {
      if (!viteMod || typeof viteMod.generateViteEmbed !== 'function') {
        logger.error('Compiling with frontend "vite" requires @tekir/vite >= the version that ships generateViteEmbed.')
        process.exit(1)
      }
      const buildDir = (frontendOpts as any)?.buildDir || 'dist/client'
      try {
        const result = viteMod.generateViteEmbed({ appRoot, buildDir, userEntry: buildEntry })
        buildEntry = result.entrypoint
        extraPlugins.push(result.plugin)
        viteCleanupBuildDir = buildDir
        logger.info(`Embedded Vite assets from ${buildDir}`)
      } catch (err: any) {
        logger.error(`Failed to embed Vite assets: ${err?.message || err}`)
        process.exit(1)
      }
      // Vite/Rollup are dev-time deps. Embedding them in the binary is dead
      // weight and rollup crashes on boot trying to dlopen platform-specific
      // native bindings that don't exist inside the packaged executable.
      extraExternals.push('vite', 'rollup', '@rollup/rollup-win32-x64-msvc', '@rollup/rollup-darwin-arm64', '@rollup/rollup-darwin-x64', '@rollup/rollup-linux-x64-gnu', '@rollup/rollup-linux-arm64-gnu', '@rollup/rollup-linux-arm64-musl', '@rollup/rollup-linux-x64-musl', 'esbuild', 'fsevents', 'lightningcss')
    }

    const ok = await runBuild(buildEntry, buildArgs, {
      extraPlugins,
      extraExternals,
      cwd: appRoot,
      logger,
    })
    if (!ok) process.exit(1)

    if (viteCleanupBuildDir && !buildArgs.includes('--keep-artifacts')) {
      const { rmSync, readdirSync } = await import('fs')
      const distAbs = join(appRoot, viteCleanupBuildDir)
      if (existsSync(distAbs)) rmSync(distAbs, { recursive: true, force: true })
      const parent = viteCleanupBuildDir.includes('/') ? viteCleanupBuildDir.split('/')[0] : null
      if (parent) {
        const parentAbs = join(appRoot, parent)
        try { if (existsSync(parentAbs) && readdirSync(parentAbs).length === 0) rmSync(parentAbs, { recursive: true, force: true }) } catch {}
      }
    }

    process.exit(0)
  }

  // `serve` (the only server command) returns the app without
  // auto-starting; the user's entry decides when to listen via
  // `app.start(...)`. Earlier releases shipped a separate `start` that
  // dispatched `tekirApp.start({mode:'production'})` itself in a
  // non-awaited tail, which double-bound the port whenever a user's
  // entry also called `app.start(callback)` — the typical shape, since
  // users want the start callback. Removed entirely so user code is
  // identical regardless of how the process was launched: dev, prod
  // local, raw bundle, or compiled binary.
  if (!commandName || commandName === 'serve') {
    return tekirApp
  }

  const commands = [...builtInCommands]

  // Provider-exposed commands: any provider class with a static `commands` array.
  // For example, @tekir/db's DatabaseProvider exposes its migrate commands here,
  // so apps don't need to wire them up by hand.
  for (const provider of tekirApp.app.getProviders()) {
    const ctor = (provider as any)?.constructor
    const exposed = ctor?.commands
    if (Array.isArray(exposed)) commands.push(...exposed)
  }

  // User-declared commands: only when `startDir` is set. The convention is
  // a single `start/commands.{ts,...}` whose default export is the command
  // list, so users keep their own folder layout for the actual command
  // classes and import them explicitly.
  if (startDirPath) {
    const userCmds = await tryImport(startDirPath, 'commands')
    if (userCmds) {
      const custom = userCmds.default || userCmds.commands || []
      commands.push(...custom)
    }
  }

  const command = commands.find(c => c.name === commandName)
  if (!command) {
    console.error(`Unknown command: ${commandName}`)
    const help = commands.find(c => c.name === 'help') as typeof commands[number]
    await help.run([], { tekir: tekirApp, appRoot, commands })
    process.exit(1)
  }

  await command.run(args, { tekir: tekirApp, appRoot, commands })
  process.exit(0)
}

export { getApp, getServer, getLogger, getRouter } from './container'
