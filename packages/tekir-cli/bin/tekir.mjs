#!/usr/bin/env bun
// tekir CLI bin. Shipped with a Bun shebang so the bin shim
// (npm/bun-generated, including Bun's `tekir.bunx` hint on Windows)
// routes through the Bun runtime by default. Bun is required because
// `tekir build` runs `Bun.build` directly, and because Bun is
// position-strict on its own `--env-file` flag, so `--env-file=...`
// tokens after the script path pass through to argv where this bin
// can filter them, while Node's runtime greedily parses the same flag
// everywhere in argv and hard-errors on a missing file before any user
// code runs.
//
// The bin file itself is plain Node-compatible ESM, so a Node-only user
// without Bun on PATH can still invoke it directly:
//   `node node_modules/@tekir/cli/bin/tekir.mjs --envfile=path serve`
// On that path the `--envfile` (no hyphen) alias bypasses Node's CLI
// parser; `--env-file` (hyphenated) is intercepted by Node's own
// runtime flag and is therefore Bun-only in practice. `tekir build`
// always requires Bun no matter how the bin is invoked.
//
// Entry resolution order (single rule, applies to every command):
//   1. `--entry <path>` flag, anywhere in argv.
//   2. `tekir.entry` field in the cwd's `package.json`.
//   3. First match among `index.ts`, `api/index.ts`, `app/index.ts`,
//      `src/index.ts`, `index.js`.
//
// The bin never treats a positional argument as the entry file; commands
// like `tekir make:controller User` would otherwise mistake their first
// arg for an entry path.
//
// Env files load in two ways, both feeding the same manual dotenv loader:
//   1. `tekir.envFiles` (string array) in the cwd's `package.json`.
//      Recommended for monorepo dev scripts that need many `.env`
//      files because the paths never enter the bin's argv.
//   2. `--env-file <path>` (multi) on the command line. Convenient for
//      one-off invocations.
//
// We deliberately do NOT defer to the runtime's native `--env-file`
// flag. Node 20.6+'s `--env-file` greedily parses the flag everywhere in
// argv (including after the script path) AND hard-errors on missing
// files. The combination breaks the moment a single optional `.env` in
// a monorepo dev script is absent, even when this bin would otherwise
// filter it out, because Node bails during its own argv parsing phase
// before the bin even runs. That failure mode is also why the
// recommended path for many `.env` files is `tekir.envFiles` in
// `package.json`: paths kept out of argv never trigger Node's parser.
// Bun is position-strict and silently skips missing files, but a tekir
// bin running under either runtime needs to behave the same way, so we
// own the loader.
import { existsSync, readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { isAbsolute, join, resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const isBun = typeof globalThis.Bun !== 'undefined'

// Marker passed to a re-exec'd child so it doesn't re-load env files the
// parent already applied (the child inherits process.env, so a second load
// would re-emit "not found" warnings and re-apply the same values).
const ENV_LOADED_MARKER = 'TEKIR_ENV_LOADED'

/**
 * Resolve an entry path against cwd and confine it under cwd. The entry is
 * `import()`-executed, and it can come from `--entry` or `package.json`
 * (`tekir.entry`), so a value pointing outside the project (e.g.
 * `../../evil.ts`) must be rejected rather than run.
 *
 * @param {string} entry - The raw entry path.
 * @returns {string} The absolute, confined entry path.
 */
function resolveEntryPath(entry) {
  const cwd = process.cwd()
  const abs = isAbsolute(entry) ? entry : resolve(cwd, entry)
  const rel = relative(cwd, abs)
  if (rel === '' || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    console.error(`[tekir] Refusing to load entry outside the project directory: ${entry}`)
    console.error(`  The entry must live under ${cwd}.`)
    process.exit(1)
  }
  return abs
}

/**
 * Pull `--entry`, `--envfile`, and `--env-file` (multi for the env
 * variants) out of argv. Everything else stays in `rest` in original
 * order so the in-app dispatcher and Bun.build see only their own flags.
 *
 * `--envfile` (no hyphen) is the recommended Node-host-safe spelling.
 * Node's CLI parser does not recognize the un-hyphenated form and lets
 * it pass through to the script's argv even when it appears after the
 * script path. The hyphenated `--env-file` is also accepted and routes
 * to the same loader, but on Node hosts Node's own `--env-file` parser
 * intercepts it first and hard-errors on a missing file before the bin
 * even runs, so it works mainly for Bun-direct invocations where the
 * runtime is position-strict and missing-tolerant.
 */
function extractTekirFlags(argv) {
  const rest = []
  const envFiles = []
  let entry
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === '--entry') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        console.error('[tekir] --entry requires a value.')
        process.exit(1)
      }
      entry = next
      i++
      continue
    }
    if (tok.startsWith('--entry=')) {
      entry = tok.slice('--entry='.length)
      if (!entry) {
        console.error('[tekir] --entry requires a value.')
        process.exit(1)
      }
      continue
    }
    if (tok === '--env-file' || tok === '--envfile') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        console.error(`[tekir] ${tok} requires a value.`)
        process.exit(1)
      }
      envFiles.push(next)
      i++
      continue
    }
    if (tok.startsWith('--env-file=') || tok.startsWith('--envfile=')) {
      const eq = tok.indexOf('=')
      const v = tok.slice(eq + 1)
      if (!v) {
        console.error(`[tekir] ${tok.slice(0, eq)} requires a value.`)
        process.exit(1)
      }
      envFiles.push(v)
      continue
    }
    rest.push(tok)
  }
  return { entry, envFiles, rest }
}

/**
 * Minimal `.env` loader. Matches the dotenv conventions Bun and Node use
 * for their own `--env-file` flag:
 *   - blank lines and `#` comments skipped
 *   - optional `export KEY=value` prefix
 *   - single- or double-quoted values are unwrapped
 *   - shell-provided env (anything already set when tekir started) wins;
 *     later files override earlier ones for the same key
 *
 * Caller passes `shellKeys` (a Set of keys that existed before any file
 * load) so the precedence rule is independent of load order.
 *
 * Missing files are warned and skipped (see the `--env-file` comment at
 * the top of this file for why we never delegate this to the runtime).
 */
function loadEnvFile(path, shellKeys) {
  if (!existsSync(path)) {
    console.warn(`[tekir] --env-file '${path}' not found, skipping`)
    return
  }
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch (err) {
    console.warn(`[tekir] Could not read --env-file '${path}': ${err.message}, skipping`)
    return
  }
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trimStart()
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))) {
      // Quoted value: take the content verbatim (a `#` inside quotes is part
      // of the value, not a comment).
      value = value.slice(1, -1)
    } else {
      // Unquoted value: strip a trailing inline `# comment` (must be preceded
      // by whitespace so a `#` inside a token like `pa#ss` stays intact).
      const hashIdx = value.search(/\s#/)
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trimEnd()
    }
    if (!shellKeys.has(key)) process.env[key] = value
  }
}

/**
 * Read the `tekir` field of the cwd's `package.json` once. Returns an
 * object with `entry?: string` and `envFiles?: string[]`, or null when
 * no package.json or no `tekir` block. Lookups elsewhere reuse this
 * cached value so we don't re-read the file three times in a row.
 */
function readTekirConfig() {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const cfg = pkg?.tekir
    if (cfg && typeof cfg === 'object') return cfg
  } catch {}
  return null
}

async function findEntry(explicit, cfg) {
  if (explicit) return explicit
  if (cfg?.entry && typeof cfg.entry === 'string') return cfg.entry

  for (const candidate of ['index.ts', 'api/index.ts', 'app/index.ts', 'src/index.ts', 'index.js']) {
    if (existsSync(candidate)) return candidate
  }

  console.error('[tekir] Could not find an entry file.')
  console.error('  Set `"tekir": { "entry": "<path>" }` in package.json,')
  console.error('  or pass `--entry <path>` on the command line,')
  console.error('  or place the entry at one of: index.ts, api/index.ts, app/index.ts, src/index.ts, index.js.')
  process.exit(1)
}

function usage(message) {
  if (message) console.error(message + '\n')
  console.error('Usage:')
  console.error('  tekir serve                        Start the server (in-process)')
  console.error('  tekir serve --dev                  Start with watch mode (NODE_ENV=development)')
  console.error('  tekir build --outdir <dir>         Plain Bun bundle (requires Bun)')
  console.error('  tekir build --compile              Single executable (requires Bun)')
  console.error('  tekir test [args]                  Run tests (`bun test` on Bun, `vitest run` on Node)')
  console.error('  tekir <command> [args]             Run a built-in / provider / user command')
  console.error('  tekir                              Alias for `tekir serve`')
  console.error('')
  console.error('Entry resolution (every command): --entry <path> > package.json `tekir.entry` >')
  console.error('  index.ts / api/index.ts / app/index.ts / src/index.ts / index.js. Use --entry')
  console.error('  only when none of those defaults match your project layout.')
  console.error('')
  console.error('Environment files: declare them in `package.json` (recommended for monorepo')
  console.error('  dev scripts) and/or pass `--env-file <path>` flags. The bin loads them itself,')
  console.error('  so paths in `package.json` never enter argv where Node\'s native `--env-file`')
  console.error('  parser would bail on a missing file:')
  console.error('')
  console.error('    "tekir": { "envFiles": ["a/.env", "b/.env"] }')
  console.error('')
  console.error('  Shell-provided env wins; later files override earlier ones; missing files are')
  console.error('  warned and skipped. `package.json` paths load first, then any `--env-file`')
  console.error('  flags from the command line.')
  console.error('')
  console.error('Build flags: --target, --format esm|cjs|iife, --minify / --no-minify,')
  console.error('  granular --minify-syntax / --minify-whitespace / --minify-identifiers,')
  console.error('  --keep-names, --sourcemap[=mode], --splitting, --no-bundle,')
  console.error('  --external <pkg> (multi), --define KEY=VALUE (multi), --plugin <path> (multi),')
  console.error('  --drop <name> (multi), --env inline|disable|<PREFIX>*, --public-path <url>,')
  console.error('  --banner <str>, --footer <str>,')
  console.error('  --entry-naming <pat>, --chunk-naming <pat>, --asset-naming <pat>,')
  console.error('  --metafile <path>, --metafile-md <path>.')
  console.error('Compile-only:    --outfile, --bytecode, --exec-argv, --autoload-tsconfig,')
  console.error('  --autoload-package-json, --no-autoload-dotenv, --no-autoload-bunfig.')
  console.error('')
  console.error('Runtime: bin runs under Bun and Node. `tekir build` requires Bun (the')
  console.error('  bundler is `Bun.build`); on Node hosts the bin re-execs itself under `bun`.')
  console.error('  `tekir serve --dev` uses `--watch` on whichever runtime is currently active.')
  console.error('  Compiled binaries (`tekir build --compile`) run commands directly:')
  console.error('  `./server routes`. The bin is not needed at runtime.')
  process.exit(1)
}

/**
 * Reshape `process.argv` so the in-app `tekir()` dispatcher sees the
 * request as if the user typed `<runtime> <entry> <command> [...args]`.
 * Then dynamically import the entry; its top-level `await tekir({...})`
 * call handles the command.
 */
async function runEntry(entry, command, args) {
  const absEntry = resolveEntryPath(entry)
  if (!existsSync(absEntry)) {
    console.error(`[tekir] Entry file not found: ${absEntry}`)
    process.exit(1)
  }
  process.argv = [process.argv[0], absEntry, ...(command ? [command] : []), ...args]
  await import(pathToFileURL(absEntry).href)
  // Don't `process.exit(0)` here. The entry typically:
  //   - starts an HTTP server (`Bun.serve` keeps the event loop alive
  //     on its own; `process.exit` would kill it the instant `import`
  //     resolved, which is exactly what happened with the canonical
  //     fire-and-forget `server.start().catch(...)` pattern)
  //   - runs a CLI command that calls `process.exit` itself (e.g. the
  //     in-app `tekir({...})` build dispatcher does this once the
  //     bundle finishes)
  //   - has top-level async work the user awaited
  // In every case the runtime exits naturally when the event loop
  // drains. Forcing an early exit here was racing with all three paths
  // and only helped the niche of a synchronous-only entry that left no
  // pending work, and Node/Bun would already exit from on their own.
}

/**
 * `Bun.build` is Bun-only. On Node we re-spawn the same bin under `bun`
 * with the original argv preserved; if Bun is not on PATH we print an
 * actionable error. The child inherits `process.env`, which the parent
 * has already populated from any `--env-file` flags, so env-bearing
 * builds work without passing the flag through.
 */
function ensureBunOrReexec() {
  if (isBun) return
  const result = spawnSync('bun', [process.argv[1] ?? '', ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === 'ENOENT') {
    console.error('[tekir] `tekir build` requires Bun (Bun.build is the bundler).')
    console.error('  Install Bun: https://bun.sh, or run via `bunx @tekir/cli build`.')
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}

const rawArgv = process.argv.slice(2)
const { entry: entryFlag, envFiles: cliEnvFiles, rest: argv } = extractTekirFlags(rawArgv)
const command = argv[0]
const tekirCfg = readTekirConfig()

// Preload env files into the parent process before any in-process import
// or subprocess spawn. `package.json.tekir.envFiles` loads first (so the
// JSON config sets the baseline), then any `--env-file` flags from the
// command line override or extend on top, matching the "later wins"
// dotenv precedence. Shell-provided env always wins both.
const jsonEnvFiles = Array.isArray(tekirCfg?.envFiles)
  ? tekirCfg.envFiles.filter(x => typeof x === 'string')
  : []
const allEnvFiles = [...jsonEnvFiles, ...cliEnvFiles]
// Skip loading when a parent process already did it (re-exec under Bun for
// `tekir build`). The child inherits process.env, so re-loading would only
// re-emit "not found" warnings and re-apply identical values.
if (allEnvFiles.length > 0 && !process.env[ENV_LOADED_MARKER]) {
  const shellKeys = new Set(Object.keys(process.env))
  for (const f of allEnvFiles) loadEnvFile(f, shellKeys)
  process.env[ENV_LOADED_MARKER] = '1'
}

if (!command) {
  const entry = await findEntry(entryFlag, tekirCfg)
  await runEntry(entry, undefined, [])
}

if (command === '-h' || command === '--help' || command === 'help') usage()

if (command === 'build') {
  // Tell library code that this process exists for bundling, not for
  // serving traffic. Eager side-effect modules (Redis subscribers,
  // queue workers, fs watchers, scheduler ticks) read `TEKIR_RUNNER`
  // and short-circuit when it equals `'build'`, the same way they do
  // for `'test'`. Use `??=` so an outer caller can pin the value first
  // (e.g. CI scripts wrapping `tekir build` with their own marker).
  process.env.TEKIR_RUNNER ??= 'build'
  ensureBunOrReexec()
  // From here on we are guaranteed to be running under Bun.
  //
  // The `tekir build` entry is parsed by `@tekir/core`'s build-entry
  // preparer, which extracts the top-level `await tekir({...})` call
  // and emits a temporary source containing only the imports and
  // declarations reachable from the call's argument expression. That
  // temp file is what gets imported here; `process.argv[1]` keeps the
  // original entry path so the in-app build dispatch bundles the real
  // file (the temp file is throwaway). Everything else in the user
  // entry — registerDir, route handlers, app.start callbacks, eager
  // service constructors, scheduler ticks, fs watchers — is dropped
  // for the duration of the build, so a hostile remote dependency
  // (Redis with no listener, queue server, ...) never blocks the
  // bundle. Entries we cannot parse statically (no literal `tekir()`
  // call, multiple calls, parse error) return `null` from
  // `generateBuildEntry`; in that case the cli falls through to a
  // plain full-entry import as a last resort.
  const entry = await findEntry(entryFlag, tekirCfg)
  const rest = argv.slice(1)
  const absEntry = resolveEntryPath(entry)
  let result = null
  try {
    const { generateBuildEntry } = await import('@tekir/core')
    result = await generateBuildEntry(absEntry)
  } catch {
    // @tekir/core not installed locally; fall through.
  }
  if (result && result.source) {
    const { writeFileSync, unlinkSync } = await import('fs')
    const { dirname } = await import('node:path')
    // Write the build-entry alongside the original file (not into
    // `os.tmpdir()`) so relative imports the user wrote (`import
    // './types'`, `import '../config/env'`, ...) resolve from the
    // expected directory. Bun resolves bare `./` specifiers relative
    // to the importing file; if the temp file lives elsewhere those
    // imports throw `Cannot find module './...'` even though the
    // dependency is right next to the original entry. The leading dot
    // in the filename hides it from most editors, and the
    // `${pid}-${timestamp}` suffix keeps parallel builds from racing
    // on the same path. Cleanup runs in a `finally` block; an orphan
    // would survive a hard crash but the pattern is easy to spot and
    // safe to delete by hand.
    const buildEntryPath = join(dirname(absEntry), `.tekir-build-entry-${process.pid}-${Date.now()}.ts`)
    let wrote = false
    try {
      writeFileSync(buildEntryPath, result.source)
      wrote = true
    } catch (err) {
      // A read-only source directory (CI, read-only mount) can't host the
      // temp build entry; fall back to a plain full-entry import instead of
      // crashing mid-build with a raw filesystem error.
      console.warn(`[tekir] Could not write temp build entry (${err.message}); building from the full entry instead.`)
    }
    if (wrote) {
      // The in-app build dispatcher calls `process.exit(0)` once
      // `Bun.build` resolves, which short-circuits any `try/finally`
      // unlink we'd schedule below. `process.on('exit')` runs
      // synchronously at the very end of the exit sequence and is
      // allowed to do filesystem work, so the temp file goes away on
      // every successful build. The handler also covers a non-zero exit
      // (build failure) since `process.exit(N)` fires the same event.
      process.on('exit', () => { try { unlinkSync(buildEntryPath) } catch {} })
      // `process.argv[1]` MUST stay on the original entry so the in-app
      // build dispatcher bundles the real file. We import the temp file
      // only to fire the `tekir({...})` call.
      process.argv = [process.argv[0], absEntry, command, ...rest]
      try {
        await import(pathToFileURL(buildEntryPath).href)
      } finally {
        try { unlinkSync(buildEntryPath) } catch {}
      }
    } else {
      await runEntry(entry, command, rest)
    }
  } else {
    await runEntry(entry, command, rest)
  }
}

// `tekir test` is a thin runner shim: it sets `NODE_ENV=test` and the
// `TEKIR_RUNNER=test` signal that `app.start()` listens for, then hands
// control to the runtime's native test command (`bun test` on Bun,
// `vitest` on Node). The signal is what lets a user entry's top-level
// `app.start()` short-circuit when imported from a test file, so the
// canonical entry shape becomes the unconditional `app.start(cb)` and
// the per-app `if (env !== 'test')` guard goes away. Integration tests
// that need a real socket pass `app.start({ force: true })` to opt back
// in. Forwarded args go to the runner verbatim (`tekir test --watch`,
// `tekir test path/to/file.test.ts`, etc.).
if (command === 'test') {
  const runner = isBun ? 'bun' : 'npx'
  // `--no-install` so a missing local vitest fails fast instead of npx
  // silently fetching it from the registry (unexpected network / wrong pkg).
  const runnerArgs = isBun ? ['test', ...argv.slice(1)] : ['--no-install', 'vitest', 'run', ...argv.slice(1)]
  const proc = spawn(runner, runnerArgs, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', TEKIR_RUNNER: 'test' },
  })
  proc.on('exit', code => process.exit(code ?? 0))
  // The spawn keeps the parent alive until `exit` fires; falling
  // through past this block would import the entry needlessly.
  await new Promise(() => {})
}

const entry = await findEntry(entryFlag, tekirCfg)
const rest = argv.slice(1)

// `tekir serve --dev` re-execs the entry with `<runtime> --watch` so file
// changes trigger a fresh boot. Watch-mode hot reload only works when the
// runtime drives the process from outside, so this is the one path that
// has to spawn a subprocess; in-app `tekir()` still receives `serve` as
// the command and starts the server normally inside it. The child
// inherits the parent's `process.env` (already populated from any
// `--env-file` flags), so `--env-file` is not forwarded to the runtime.
if (command === 'serve' && rest.includes('--dev')) {
  const watchRest = rest.filter(a => a !== '--dev')
  const runner = isBun ? 'bun' : 'node'
  const proc = spawn(runner, ['--watch', entry, 'serve', ...watchRest], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  })
  proc.on('exit', code => process.exit(code ?? 0))
} else {
  await runEntry(entry, command, rest)
}
