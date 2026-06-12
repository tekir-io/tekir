/**
 * Shared `Bun.build` runner used by both the `tekir` CLI bin and the
 * in-process `tekir()` build dispatcher. Single source of truth for flag
 * parsing, default externals, the autoload inliner, and `--plugin`
 * loading. Returns a boolean so callers can decide their own exit code
 * and run post-build cleanup (e.g. the Vite frontend's `dist/client`
 * removal).
 */

import { isAbsolute, join } from 'path'
import { pathToFileURL } from 'url'
import { parseBuildArgs, BuildArgsError, type ParsedBuildArgs } from './args'

const DEFAULT_EXTERNALS: readonly string[] = [
  'drizzle-kit',
  'pg',
  'mysql2',
  'better-sqlite3',
  '@electric-sql/pglite',
  'postgres',
  '@vercel/postgres',
  '@neondatabase/serverless',
  '@planetscale/database',
  '@libsql/client',
  '@aws-sdk/client-rds-data',
]

export interface RunBuildLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const consoleLogger: RunBuildLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
}

export interface RunBuildOptions {
  /** Extra Bun plugins added after the autoload inliner and user `--plugin`s. */
  extraPlugins?: any[]
  /** Extra externals merged with the framework defaults and `--external` flags. */
  extraExternals?: readonly string[]
  /** Working directory that resolves `--plugin` relative paths. Defaults to `process.cwd()`. */
  cwd?: string
  /** Logger sink. Defaults to `console`. */
  logger?: RunBuildLogger
  /** Override the parsed args directly (skips `parseBuildArgs`). */
  parsed?: ParsedBuildArgs
}

/**
 * Run `Bun.build` (or compile) for `entry` using the given CLI flags.
 * Returns `true` on success, `false` on any failure (parse, plugin load,
 * Bun.build error). Does not call `process.exit`; the caller decides.
 */
export async function runBuild(
  entry: string,
  argv: string[],
  options: RunBuildOptions = {},
): Promise<boolean> {
  const logger = options.logger ?? consoleLogger
  const cwd = options.cwd ?? process.cwd()

  let parsed: ParsedBuildArgs
  try {
    parsed = options.parsed ?? parseBuildArgs(argv)
  } catch (err: any) {
    if (err instanceof BuildArgsError) {
      logger.error(`[tekir build] ${err.message}`)
    } else {
      logger.error(`[tekir build] Failed to parse arguments: ${err?.message || err}`)
    }
    return false
  }

  for (const u of parsed.unknown) {
    logger.warn(`[tekir build] Unknown flag ignored: ${u}`)
  }

  if (!parsed.compile && !parsed.outdir) {
    logger.error('[tekir build] Provide --outdir <path> for a plain bundle, or --compile for a single executable.')
    return false
  }

  if (parsed.splitting && !parsed.outdir) {
    logger.error('[tekir build] --splitting requires --outdir <path>.')
    return false
  }

  const inlinerPlugin = await loadInlinerPlugin(parsed.compile ? '[--compile]' : '[build]', logger)
  let userPlugins: any[]
  try {
    userPlugins = await loadUserPlugins(parsed.pluginPaths, cwd)
  } catch (err: any) {
    logger.error(`[tekir build] ${err?.message || err}`)
    return false
  }

  const allPlugins = [
    ...(inlinerPlugin ? [inlinerPlugin] : []),
    ...(options.extraPlugins ?? []),
    ...userPlugins,
  ]

  const externals = [
    ...DEFAULT_EXTERNALS,
    ...(options.extraExternals ?? []),
    ...parsed.externals,
  ]

  const defines: Record<string, string> = {
    'process.env.NODE_ENV': '"production"',
    ...parsed.defines,
  }

  const buildPayload: any = {
    entrypoints: [entry],
    target: parsed.target,
    minify: parsed.minify,
    sourcemap: parsed.sourcemap,
    external: externals,
    define: defines,
  }
  if (allPlugins.length > 0) buildPayload.plugins = allPlugins

  // Module format / asset URL prefix / banner / footer / drop-list / env
  // mode / no-bundle / keep-names: pass-throughs to Bun.build. Bun's runtime
  // option surface is broader than the published TS types in some places, so
  // these go through the `any` payload without further validation; the parser
  // already rejects unknown values for `--format` and `--env`.
  if (parsed.format) buildPayload.format = parsed.format
  // Default `process.env.NODE_ENV` to "production" at bundle-load time
  // so apps run with `bun ./dist/index.js` (PM2, Docker, systemd, etc.)
  // see the right env without the operator having to remember
  // `NODE_ENV=production` on every command. Bracket access dodges the
  // `--define` substitution applied to `process.env.NODE_ENV` reads, so
  // the banner survives both the bundler's compile-time fold and any
  // user-provided `--banner` (we prepend, never overwrite). Runtime-set
  // values still win because the assignment is gated by `||=`.
  const envBanner = 'process.env["NODE_ENV"]||="production";'
  buildPayload.banner = parsed.banner !== undefined
    ? `${envBanner}${parsed.banner}`
    : envBanner
  if (parsed.footer !== undefined) buildPayload.footer = parsed.footer
  if (parsed.drop.length > 0) buildPayload.drop = parsed.drop
  if (parsed.env) buildPayload.env = parsed.env
  if (parsed.publicPath) buildPayload.publicPath = parsed.publicPath
  if (parsed.noBundle) buildPayload.bundle = false
  if (parsed.keepNames) buildPayload.keepNames = true

  // Naming controls. Bun.build accepts a single string (entry only) or an
  // object `{ entry, chunk, asset }`; we always emit the object form so any
  // combination of the three flags lands cleanly.
  if (parsed.entryNaming || parsed.chunkNaming || parsed.assetNaming) {
    const naming: { entry?: string; chunk?: string; asset?: string } = {}
    if (parsed.entryNaming) naming.entry = parsed.entryNaming
    if (parsed.chunkNaming) naming.chunk = parsed.chunkNaming
    if (parsed.assetNaming) naming.asset = parsed.assetNaming
    buildPayload.naming = naming
  }

  // `metafile` accepts boolean | string | { json, markdown }. Build the
  // tightest form that covers the user's flags so Bun writes the file(s)
  // itself instead of us re-implementing the serializer.
  if (parsed.metafileJson && parsed.metafileMd) {
    buildPayload.metafile = { json: parsed.metafileJson, markdown: parsed.metafileMd }
  } else if (parsed.metafileJson) {
    buildPayload.metafile = parsed.metafileJson
  } else if (parsed.metafileMd) {
    buildPayload.metafile = { markdown: parsed.metafileMd }
  }

  if (parsed.compile) {
    const compileOpts: any = {}
    if (parsed.target !== 'bun') compileOpts.target = parsed.target
    if (parsed.autoloadTsconfig) compileOpts.autoloadTsconfig = true
    if (parsed.autoloadPackageJson) compileOpts.autoloadPackageJson = true
    if (!parsed.autoloadDotenv) compileOpts.autoloadDotenv = false
    if (!parsed.autoloadBunfig) compileOpts.autoloadBunfig = false
    if (parsed.execArgv) compileOpts.execArgv = parsed.execArgv

    const outfile = parsed.outfile ?? 'server'
    if (!parsed.splitting) compileOpts.outfile = outfile
    if (parsed.bytecode) buildPayload.bytecode = true

    buildPayload.target = 'bun'
    buildPayload.compile = compileOpts

    if (parsed.splitting) {
      buildPayload.splitting = true
      buildPayload.outdir = parsed.outdir!
    }

    logger.info(`Compiling ${entry} → ${parsed.splitting ? `${parsed.outdir}/` : `./${outfile}`}`)
  } else {
    buildPayload.outdir = parsed.outdir!
    if (parsed.splitting) buildPayload.splitting = true
    logger.info(`Bundling ${entry} → ${parsed.outdir}/`)
  }

  const result = await Bun.build(buildPayload)
  if (!result.success) {
    for (const log of result.logs) logger.error(String(log))
    return false
  }

  if (parsed.metafileJson || parsed.metafileMd) {
    const dest = [parsed.metafileJson, parsed.metafileMd].filter(Boolean).join(', ')
    logger.info(`Wrote metafile to ${dest}`)
  }

  logger.info('Build complete')
  return true
}

async function loadInlinerPlugin(label: string, logger: RunBuildLogger): Promise<any | null> {
  try {
    const mod = await import('./inliner')
    const plugin = await mod.createInlinerPlugin()
    if (!plugin) {
      logger.warn(`${label} \`oxc-parser\` is not installed. \`loadDir('path')\` and \`*.registerDir('path')\` calls will not be inlined and the bundle will not contain the referenced files. Install: \`bun add -d oxc-parser\`.`)
    }
    return plugin
  } catch (err: any) {
    logger.warn(`${label} Failed to load tekir inliner: ${err?.message || err}. Continuing without autoload inlining.`)
    return null
  }
}

async function loadUserPlugins(paths: string[], cwd: string): Promise<any[]> {
  const plugins: any[] = []
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(cwd, p)
    const url = pathToFileURL(abs).href
    let mod: any
    try {
      mod = await import(url)
    } catch (err: any) {
      throw new Error(`Failed to load plugin "${p}": ${err?.message || err}`)
    }
    const plugin = mod.default || mod.plugin
    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`Plugin "${p}" must export a Bun plugin (default export).`)
    }
    plugins.push(plugin)
  }
  return plugins
}

export { parseBuildArgs, BuildArgsError } from './args'
export type { ParsedBuildArgs, SourcemapMode } from './args'
