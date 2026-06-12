/**
 * Parser for `tekir build` flags. Built on `node:util`'s `parseArgs`
 * (stdlib, zero deps, also available in Bun) so we get the same flag
 * semantics as the rest of the Node ecosystem instead of a hand-rolled
 * scanner that breaks on edge cases like `--external -` or
 * `--define KEY="value with spaces"`.
 *
 * The only thing we add on top is the legacy bare `--sourcemap` form
 * (with no value) meaning `--sourcemap=linked`, kept for backwards
 * compatibility with earlier tekir versions.
 */

import { parseArgs, type ParseArgsConfig } from 'node:util'

export type SourcemapMode = 'linked' | 'inline' | 'external' | 'none'
export type ModuleFormat = 'esm' | 'cjs' | 'iife'

export interface MinifyOptions {
  syntax: boolean
  whitespace: boolean
  identifiers: boolean
}

export interface ParsedBuildArgs {
  compile: boolean
  outdir?: string
  outfile?: string
  target: string
  format?: ModuleFormat
  minify: boolean | MinifyOptions
  keepNames: boolean
  sourcemap?: SourcemapMode
  splitting: boolean
  bytecode: boolean
  noBundle: boolean
  externals: string[]
  defines: Record<string, string>
  pluginPaths: string[]
  drop: string[]
  env?: string
  publicPath?: string
  banner?: string
  footer?: string
  entryNaming?: string
  chunkNaming?: string
  assetNaming?: string
  metafileJson?: string
  metafileMd?: string
  execArgv?: string[]
  autoloadTsconfig: boolean
  autoloadPackageJson: boolean
  autoloadDotenv: boolean
  autoloadBunfig: boolean
  keepArtifacts: boolean
  unknown: string[]
}

const SOURCEMAP_MODES: ReadonlySet<string> = new Set(['linked', 'inline', 'external', 'none'])
const FORMAT_MODES: ReadonlySet<string> = new Set(['esm', 'cjs', 'iife'])

const PARSE_OPTIONS = {
  compile: { type: 'boolean' },
  outdir: { type: 'string' },
  outfile: { type: 'string' },
  target: { type: 'string' },
  format: { type: 'string' },
  minify: { type: 'boolean' },
  'no-minify': { type: 'boolean' },
  'minify-syntax': { type: 'boolean' },
  'minify-whitespace': { type: 'boolean' },
  'minify-identifiers': { type: 'boolean' },
  'keep-names': { type: 'boolean' },
  sourcemap: { type: 'string' },
  splitting: { type: 'boolean' },
  bytecode: { type: 'boolean' },
  'no-bundle': { type: 'boolean' },
  external: { type: 'string', multiple: true },
  define: { type: 'string', multiple: true },
  plugin: { type: 'string', multiple: true },
  drop: { type: 'string', multiple: true },
  env: { type: 'string' },
  'public-path': { type: 'string' },
  banner: { type: 'string' },
  footer: { type: 'string' },
  'entry-naming': { type: 'string' },
  'chunk-naming': { type: 'string' },
  'asset-naming': { type: 'string' },
  metafile: { type: 'string' },
  'metafile-md': { type: 'string' },
  'exec-argv': { type: 'string' },
  'autoload-tsconfig': { type: 'boolean' },
  'autoload-package-json': { type: 'boolean' },
  'no-autoload-dotenv': { type: 'boolean' },
  'no-autoload-bunfig': { type: 'boolean' },
  'keep-artifacts': { type: 'boolean' },
} satisfies NonNullable<ParseArgsConfig['options']>

export class BuildArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildArgsError'
  }
}

export function parseBuildArgs(argv: string[]): ParsedBuildArgs {
  // Legacy: bare `--sourcemap` (no value, no following mode) → linked.
  // parseArgs in strict mode would either consume the next token as the
  // value (corrupting positionals) or error, neither of which we want.
  const expanded: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--sourcemap') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--') || !SOURCEMAP_MODES.has(next)) {
        expanded.push('--sourcemap=linked')
        continue
      }
    }
    expanded.push(t)
  }

  let values: Record<string, any>
  let positionals: string[]
  try {
    const result = parseArgs({
      args: expanded,
      options: PARSE_OPTIONS,
      allowPositionals: true,
      strict: true,
    })
    values = result.values
    positionals = result.positionals
  } catch (err: any) {
    throw new BuildArgsError(err?.message ?? String(err))
  }

  if (values.sourcemap !== undefined && !SOURCEMAP_MODES.has(values.sourcemap)) {
    throw new BuildArgsError(`Invalid --sourcemap value: "${values.sourcemap}". Expected linked, inline, external, or none.`)
  }
  if (values.minify === true && values['no-minify'] === true) {
    throw new BuildArgsError('--minify and --no-minify cannot both be set.')
  }
  if (values.format !== undefined && !FORMAT_MODES.has(values.format)) {
    throw new BuildArgsError(`Invalid --format value: "${values.format}". Expected esm, cjs, or iife.`)
  }
  // --env accepts: "inline" | "disable" | "<PREFIX>*" (any string ending in *)
  if (values.env !== undefined) {
    const v = values.env as string
    if (v !== 'inline' && v !== 'disable' && !v.endsWith('*')) {
      throw new BuildArgsError(`Invalid --env value: "${v}". Expected "inline", "disable", or "<PREFIX>*".`)
    }
  }

  const defines: Record<string, string> = {}
  for (const d of (values.define ?? []) as string[]) {
    const eq = d.indexOf('=')
    if (eq === -1) throw new BuildArgsError(`Invalid --define format: "${d}". Expected KEY=VALUE.`)
    defines[d.slice(0, eq)] = d.slice(eq + 1)
  }

  // Resolve minification.
  //
  // Default behavior matches prior versions: minify is on unless the user
  // explicitly passes `--no-minify`. `--minify` is therefore a no-op for the
  // umbrella case but still meaningful as the "all on" switch when combined
  // with granular flags.
  //
  // Granular flags (`--minify-syntax`, `--minify-whitespace`,
  // `--minify-identifiers`) opt into the object form so users can pick a
  // subset (e.g. `--minify-syntax` alone for syntax-only minification). When
  // any granular flag is set, missing granular slots default to OFF so users
  // get exactly what they asked for; `--minify` together with one or more
  // granular flags fills in the rest as ON.
  //
  // `--no-minify` always wins, even alongside granular flags.
  const granularSet =
    values['minify-syntax'] !== undefined ||
    values['minify-whitespace'] !== undefined ||
    values['minify-identifiers'] !== undefined
  let minify: boolean | MinifyOptions
  if (values['no-minify'] === true) {
    minify = false
  } else if (granularSet) {
    const baseAllOn = values.minify === true
    minify = {
      syntax: values['minify-syntax'] === true || (values['minify-syntax'] === undefined && baseAllOn),
      whitespace: values['minify-whitespace'] === true || (values['minify-whitespace'] === undefined && baseAllOn),
      identifiers: values['minify-identifiers'] === true || (values['minify-identifiers'] === undefined && baseAllOn),
    }
  } else {
    minify = true
  }

  const execArgvRaw = values['exec-argv'] as string | undefined

  return {
    compile: values.compile === true,
    outdir: values.outdir as string | undefined,
    outfile: values.outfile as string | undefined,
    target: (values.target as string | undefined) ?? 'bun',
    format: values.format as ModuleFormat | undefined,
    minify,
    keepNames: values['keep-names'] === true,
    sourcemap: values.sourcemap as SourcemapMode | undefined,
    splitting: values.splitting === true,
    bytecode: values.bytecode === true,
    noBundle: values['no-bundle'] === true,
    externals: ((values.external ?? []) as string[]).slice(),
    defines,
    pluginPaths: ((values.plugin ?? []) as string[]).slice(),
    drop: ((values.drop ?? []) as string[]).slice(),
    env: values.env as string | undefined,
    publicPath: values['public-path'] as string | undefined,
    banner: values.banner as string | undefined,
    footer: values.footer as string | undefined,
    entryNaming: values['entry-naming'] as string | undefined,
    chunkNaming: values['chunk-naming'] as string | undefined,
    assetNaming: values['asset-naming'] as string | undefined,
    metafileJson: values.metafile as string | undefined,
    metafileMd: values['metafile-md'] as string | undefined,
    execArgv: execArgvRaw ? execArgvRaw.split(/\s+/).filter(Boolean) : undefined,
    autoloadTsconfig: values['autoload-tsconfig'] === true,
    autoloadPackageJson: values['autoload-package-json'] === true,
    autoloadDotenv: values['no-autoload-dotenv'] !== true,
    autoloadBunfig: values['no-autoload-bunfig'] !== true,
    keepArtifacts: values['keep-artifacts'] === true,
    unknown: positionals.slice(),
  }
}
