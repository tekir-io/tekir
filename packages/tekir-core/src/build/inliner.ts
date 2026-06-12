/**
 * Bun bundler plugin that turns `loadDir`/`registerDir` calls with literal
 * string paths into explicit static imports. Only runs during `tekir build
 * --compile` so single-executable binaries can include the auto-loaded
 * controllers, jobs, listeners, etc. that would otherwise miss the bundle.
 *
 * AST-based (oxc-parser) so it never confuses commented-out calls or
 * string literals for real call expressions.
 *
 * `oxc-parser` is an optional peer dependency. When the user runs
 * `--compile` without it installed, the build helper prints a friendly
 * install hint and skips the plugin (the binary will still run on
 * runtime fs, breaking on missing files; the warning makes that obvious).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, extname, isAbsolute, join, relative } from 'path'

interface CallSite {
  type: 'loadDir' | 'registerDir'
  start: number
  end: number
  path: string
}

/**
 * Build-time file read pattern site. The inliner reads `path` from disk
 * during the bundle and replaces the original call with a literal value
 * matching `shape`, so the resulting bundle has no runtime fs lookup
 * for these inputs and can run from any working directory.
 *
 * Shapes are determined by the call form:
 *   - sync-string:    `readFileSync(p, 'utf-8')` or with `{ encoding }`
 *   - sync-buffer:    `readFileSync(p)` (no encoding → returns Buffer)
 *   - async-string:   `await readFile(p, 'utf-8')` (from `fs/promises`)
 *   - async-buffer:   `await readFile(p)` (from `fs/promises`, no encoding)
 *   - bun-text:       `await Bun.file(p).text()`
 *   - bun-arraybuffer: `await Bun.file(p).arrayBuffer()`
 */
type FsReadShape = 'sync-string' | 'sync-buffer' | 'async-string' | 'async-buffer' | 'bun-text' | 'bun-arraybuffer'

interface FsReadCallSite {
  type: 'fsRead'
  start: number
  end: number
  path: string
  shape: FsReadShape
}

type Site = CallSite | FsReadCallSite

/**
 * Hard cap on individual file size to inline. Files larger than this
 * stay as runtime fs reads so the bundle does not bloat. Tweakable per
 * project via `tekir.inliner.maxInlineSize` once that config surface
 * lands; today it is a constant.
 */
const MAX_INLINE_SIZE = 1024 * 1024 // 1 MB

let parserCache: { parseSync: (filename: string, src: string) => any } | null = null

/**
 * Try to load `oxc-parser`. Returns `null` when it is not installed; the
 * caller is responsible for telling the user how to install it.
 */
async function tryLoadParser(): Promise<typeof parserCache> {
  if (parserCache) return parserCache
  try {
    // String-indirect import so TS does not require the dep at type level.
    const mod: any = await import('oxc-parser' as string)
    parserCache = { parseSync: mod.parseSync ?? mod.default?.parseSync }
    if (typeof parserCache.parseSync !== 'function') return null
    return parserCache
  } catch {
    return null
  }
}

const PRE_FILTER = /\b(?:loadDir|registerDir|readFileSync|readFile|Bun\.file)\s*\(/

const FS_SYNC_SOURCES = new Set(['fs', 'node:fs'])
const FS_ASYNC_SOURCES = new Set(['fs/promises', 'node:fs/promises'])

interface FsAliases {
  /** Local names bound to the sync `readFileSync` import (default or aliased). */
  syncRead: Set<string>
  /** Local names bound to the async `readFile` import from `fs/promises`. */
  asyncRead: Set<string>
  /** Local names that import the entire `fs` (or `node:fs`) namespace or default. */
  fsSyncNamespace: Set<string>
  /** Local names that import `fs/promises` as a namespace or default. */
  fsAsyncNamespace: Set<string>
}

/**
 * Scan the program's import declarations and record every binding that
 * could be the entry point for a recognizable fs read. Covers:
 *
 *   - named: `import { readFileSync } from 'fs'`
 *   - aliased: `import { readFileSync as rfs } from 'fs'`
 *   - namespace: `import * as fs from 'fs'`
 *   - default (Node ESM compat): `import fs from 'fs'`
 *
 * The async equivalents pull from `fs/promises` (or `node:fs/promises`).
 * Callback-style `readFile` from plain `fs` is intentionally NOT
 * tracked — its callback signature can't be represented as a literal.
 */
function collectFsAliases(program: any): FsAliases {
  const aliases: FsAliases = {
    syncRead: new Set(),
    asyncRead: new Set(),
    fsSyncNamespace: new Set(),
    fsAsyncNamespace: new Set(),
  }

  const body = program?.body
  if (!Array.isArray(body)) return aliases

  for (const node of body) {
    if (!node || node.type !== 'ImportDeclaration') continue
    const source = typeof node.source?.value === 'string' ? node.source.value : ''
    const isSync = FS_SYNC_SOURCES.has(source)
    const isAsync = FS_ASYNC_SOURCES.has(source)
    if (!isSync && !isAsync) continue

    const specifiers = Array.isArray(node.specifiers) ? node.specifiers : []
    for (const spec of specifiers) {
      const localName = spec.local?.name
      if (typeof localName !== 'string' || !localName) continue
      if (spec.type === 'ImportSpecifier') {
        const imported = spec.imported?.name
        if (isSync && imported === 'readFileSync') aliases.syncRead.add(localName)
        if (isAsync && imported === 'readFile') aliases.asyncRead.add(localName)
      } else if (spec.type === 'ImportNamespaceSpecifier' || spec.type === 'ImportDefaultSpecifier') {
        if (isSync) aliases.fsSyncNamespace.add(localName)
        if (isAsync) aliases.fsAsyncNamespace.add(localName)
      }
    }
  }

  return aliases
}

/** Pull a string-literal value from a node, handling both AST shapes oxc emits. */
function asStringLiteral(node: any): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value
  return null
}

/**
 * Inspect a `readFileSync` / `readFile` second argument and return
 * whether the call asks for a string ('text') or Buffer ('binary').
 * Returns `null` when the encoding is dynamic — those calls stay as
 * runtime fs lookups so we never silently change semantics.
 */
function detectEncoding(arg: any): 'text' | 'binary' | null {
  if (arg === undefined) return 'binary'
  const literal = asStringLiteral(arg)
  if (literal !== null) {
    const norm = literal.toLowerCase()
    if (norm === 'utf-8' || norm === 'utf8' || norm === 'ascii' || norm === 'latin1' || norm === 'binary' || norm === 'base64' || norm === 'hex') {
      return norm === 'binary' ? 'binary' : 'text'
    }
    return null
  }
  if (arg.type === 'ObjectExpression' && Array.isArray(arg.properties)) {
    let encoding: string | null = null
    let sawDynamic = false
    for (const prop of arg.properties) {
      if (prop.type !== 'Property' && prop.type !== 'ObjectProperty') continue
      if (prop.computed) { sawDynamic = true; break }
      const key = prop.key?.name ?? prop.key?.value
      if (key !== 'encoding') continue
      const val = asStringLiteral(prop.value)
      if (val === null) { sawDynamic = true; break }
      encoding = val.toLowerCase()
    }
    if (sawDynamic) return null
    if (encoding === null) return 'binary'
    if (encoding === 'utf-8' || encoding === 'utf8' || encoding === 'ascii' || encoding === 'latin1' || encoding === 'base64' || encoding === 'hex') return 'text'
    if (encoding === 'binary') return 'binary'
    return null
  }
  return null
}

/**
 * Detect a `Bun.file('literal').text()` or `.arrayBuffer()` chain. The
 * outer call is a `MemberExpression` whose object is a CallExpression
 * to `Bun.file(literal)`. Returns the literal path and which method
 * was invoked, or `null` when the chain doesn't match.
 */
function isBunFileChain(node: any): { path: string; method: 'text' | 'arrayBuffer' } | null {
  if (!node || node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null
  const method = callee.property?.name
  if (method !== 'text' && method !== 'arrayBuffer') return null
  const inner = callee.object
  if (!inner || inner.type !== 'CallExpression') return null
  const innerCallee = inner.callee
  if (!innerCallee || innerCallee.type !== 'MemberExpression' || innerCallee.computed) return null
  if (innerCallee.object?.type !== 'Identifier' || innerCallee.object.name !== 'Bun') return null
  if (innerCallee.property?.type !== 'Identifier' || innerCallee.property.name !== 'file') return null
  if (!Array.isArray(inner.arguments) || inner.arguments.length === 0) return null
  const path = asStringLiteral(inner.arguments[0])
  if (path === null) return null
  return { path, method }
}

/**
 * Classify a CallExpression as one of the recognized fs read shapes.
 * Returns `null` when the call is not a known fs read or when the
 * arguments aren't analyzable (dynamic path, dynamic encoding, ...).
 */
function classifyFsRead(node: any, aliases: FsAliases): { shape: FsReadShape; path: string } | null {
  if (!node || node.type !== 'CallExpression') return null

  // Bun.file(literal).text()/.arrayBuffer()
  const bun = isBunFileChain(node)
  if (bun) {
    return {
      shape: bun.method === 'text' ? 'bun-text' : 'bun-arraybuffer',
      path: bun.path,
    }
  }

  const callee = node.callee
  if (!callee) return null
  const args = Array.isArray(node.arguments) ? node.arguments : []
  if (args.length === 0) return null
  const path = asStringLiteral(args[0])
  if (path === null) return null

  let kind: 'sync' | 'async' | null = null

  if (callee.type === 'Identifier') {
    if (aliases.syncRead.has(callee.name)) kind = 'sync'
    else if (aliases.asyncRead.has(callee.name)) kind = 'async'
  } else if (callee.type === 'MemberExpression' && !callee.computed) {
    const obj = callee.object?.name
    const prop = callee.property?.name
    if (typeof obj === 'string' && typeof prop === 'string') {
      if (aliases.fsSyncNamespace.has(obj) && prop === 'readFileSync') kind = 'sync'
      else if (aliases.fsAsyncNamespace.has(obj) && prop === 'readFile') kind = 'async'
    }
  }

  if (!kind) return null

  const enc = detectEncoding(args[1])
  if (enc === null) return null

  if (kind === 'sync') return { shape: enc === 'text' ? 'sync-string' : 'sync-buffer', path }
  return { shape: enc === 'text' ? 'async-string' : 'async-buffer', path }
}

/**
 * Walk the AST and collect every recognizable inline target:
 *   - `loadDir('literal')` and `*.registerDir('literal')` calls (existing)
 *   - `readFileSync(literal, ...)`, `readFile(literal, ...)` (new)
 *   - `Bun.file(literal).text()` / `.arrayBuffer()` chains (new)
 *
 * Sites without a literal first argument or without an analyzable
 * encoding are skipped so the runtime fallback handles them.
 */
function findCallSites(source: string, filename: string, parseSync: (f: string, s: string) => any): Site[] {
  let result: any
  try {
    result = parseSync(filename, source)
  } catch {
    return []
  }
  const program = result?.program ?? result
  if (!program) return []

  const fsAliases = collectFsAliases(program)
  const fsEnabled = fsAliases.syncRead.size > 0 ||
    fsAliases.asyncRead.size > 0 ||
    fsAliases.fsSyncNamespace.size > 0 ||
    fsAliases.fsAsyncNamespace.size > 0
  const bunFileEnabled = source.includes('Bun.file')

  const sites: Site[] = []
  const seen = new WeakSet<object>()

  function visit(node: any) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)

    if (node.type === 'CallExpression') {
      const callee = node.callee
      let kind: 'loadDir' | 'registerDir' | null = null

      // bare call: loadDir('...')
      if (callee?.type === 'Identifier' && callee.name === 'loadDir') {
        kind = 'loadDir'
      }
      // member call: x.loadDir('...') or x.registerDir('...')
      else if (
        callee?.type === 'MemberExpression' &&
        callee.property?.type === 'Identifier' &&
        (callee.property.name === 'loadDir' || callee.property.name === 'registerDir') &&
        !callee.computed
      ) {
        kind = callee.property.name
      }

      if (kind && Array.isArray(node.arguments) && node.arguments.length > 0) {
        const arg = node.arguments[0]
        const literal = asStringLiteral(arg)
        if (literal !== null && typeof node.start === 'number' && typeof node.end === 'number') {
          sites.push({ type: kind, start: node.start, end: node.end, path: literal })
        }
      } else if ((fsEnabled || bunFileEnabled) && typeof node.start === 'number' && typeof node.end === 'number') {
        const fsRead = classifyFsRead(node, fsAliases)
        if (fsRead) {
          sites.push({ type: 'fsRead', start: node.start, end: node.end, path: fsRead.path, shape: fsRead.shape })
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      const value = (node as any)[key]
      if (Array.isArray(value)) {
        for (const child of value) visit(child)
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        visit(value)
      }
    }
  }

  visit(program)
  return sites
}

/**
 * List the eligible module files inside a directory, sorted, for the
 * inliner to import. Skips type-declaration siblings and matches the
 * default `loadDir` extension list.
 */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    let s
    try { s = statSync(full) } catch { continue }
    if (!s.isFile()) continue
    if (name.endsWith('.d.ts')) continue
    const ext = extname(name)
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) continue
    out.push(full)
  }
  return out.sort()
}

function toRel(target: string, from: string): string {
  let rel = relative(from, target).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

/**
 * Static analysis of a single controller file: find every public export
 * binding so the inliner can emit real ESM imports for each one. Going
 * through real bindings (not a runtime `import * as ns` probed via
 * `Object.keys`) is what keeps Bun's bundler tree-shaker from dropping
 * the exports: dynamic reflection is opaque to the shaker, which then
 * leaves the file's side effects (class body + decorator calls) but
 * reduces the namespace import to `var ns = {}`. The runtime picker
 * sees an empty object, returns it, and `register({})` either silently
 * drops the controller or throws "is not a constructor".
 *
 * The function returns whether the file has a default export and the
 * names of every named export, regardless of decorator. The runtime
 * picker is generic: it inspects each value's `__prefix`/`__routes`/
 * `__schedules`/`__listeners` static fields (the metadata any tekir
 * decorator stamps onto the class) to identify registry-tagged
 * candidates. The inliner does not need to know the user's decorator
 * names ahead of time; user-defined decorators that follow the same
 * metadata convention are picked up automatically.
 */
interface FileExports {
  hasDefault: boolean
  named: string[]
}

function readFileExports(filePath: string, parseSync: (f: string, s: string) => any): FileExports {
  let source: string
  try { source = readFileSync(filePath, 'utf-8') } catch { return { hasDefault: false, named: [] } }

  let result: any
  try { result = parseSync(filePath, source) } catch { return { hasDefault: false, named: [] } }
  const program = result?.program ?? result
  if (!program?.body) return { hasDefault: false, named: [] }

  let hasDefault = false
  const named: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    if (!name || name === 'default' || seen.has(name)) return
    seen.add(name)
    named.push(name)
  }

  for (const node of program.body) {
    if (!node) continue
    if (node.type === 'ExportDefaultDeclaration') {
      hasDefault = true
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue

    // `export class Foo {…}` / `export function bar() {…}` / `export const baz = …`
    if (node.declaration) {
      const decl = node.declaration
      if ((decl.type === 'ClassDeclaration' || decl.type === 'FunctionDeclaration') && decl.id?.name) {
        push(decl.id.name)
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations ?? []) {
          if (d.id?.type === 'Identifier') push(d.id.name)
        }
      }
    }
    // `export { Foo, Bar as Baz }`
    for (const spec of node.specifiers ?? []) {
      if (spec.type !== 'ExportSpecifier') continue
      const exported = spec.exported?.name
      if (typeof exported === 'string') push(exported)
    }
  }

  return { hasDefault, named }
}

/**
 * Apply the discovered call sites to the source text. Replacements run
 * in reverse position order so later edits do not shift earlier indices.
 * Each call becomes an immediately-resolved Promise yielding an array of
 * the picked exports, with the underlying imports hoisted to the top of
 * the file so the bundler sees them statically.
 */
/**
 * Build a per-call-site picker IIFE for the given module identifier.
 * Mirrors `defaultPick` from `loader.ts` so the build-time inliner
 * picks the same export the runtime `loadDir` would choose for the
 * same module: `mod.default` first, otherwise the single named export,
 * otherwise a decorator-tagged class, otherwise the first function-typed
 * named export, otherwise the namespace itself.
 *
 * Each registerDir/loadDir call site gets its OWN inline IIFE rather
 * than calling a shared helper, and the IIFE goes through reflection
 * APIs (`Object.prototype.hasOwnProperty.call`, `Object.keys`) so Bun's
 * bundler optimizer cannot statically resolve the module shape and
 * constant-fold the body down to `m.default ?? m`. A shared helper
 * (whether declared as `function ...` or even built via
 * `new Function("m", "<body>")`) gets aggressively inlined and folded
 * because Bun knows every call site's argument is a static namespace
 * import; a per-site IIFE keeps the body opaque per call.
 */
function buildPickerExpr(id: string): string {
  return [
    `(()=>{`,
    `const _m=${id};`,
    `if(_m==null)return _m;`,
    `if(typeof _m==="object"&&Object.prototype.hasOwnProperty.call(_m,"default")&&_m.default!==undefined)return _m.default;`,
    `if(typeof _m!=="object")return _m;`,
    `const _k=Object.keys(_m).filter((_x)=>_x!=="default");`,
    `if(_k.length===0)return _m;`,
    `if(_k.length===1)return _m[_k[0]];`,
    `for(let _i=0;_i<_k.length;_i++){`,
      `const _v=_m[_k[_i]];`,
      `if(typeof _v==="function"&&(_v.__prefix!==undefined||_v.__routes!==undefined||_v.__schedules!==undefined||_v.__listeners!==undefined))return _v;`,
    `}`,
    `for(let _j=0;_j<_k.length;_j++){`,
      `if(typeof _m[_k[_j]]==="function")return _m[_k[_j]];`,
    `}`,
    `return _m;`,
    `})()`,
  ].join('')
}

/**
 * Build a picker expression over an explicit list of ESM bindings rather
 * than a namespace. Used by the registry inliner: the file's default
 * export (if any) is bound to `defaultId` and each named export to one
 * of `namedIds`. We then choose the same export the runtime
 * `defaultPick` would pick, but on real bindings so Bun's bundler
 * shaker keeps every export alive.
 *
 * Selection mirrors `loader.ts` `defaultPick`:
 *   1. default binding when present (most common — class wrapped in
 *      `export default @Controller(...) class Foo {}`)
 *   2. exactly one named binding → that binding
 *   3. named binding whose value carries any tekir registry metadata
 *      (`__prefix` / `__routes` / `__schedules` / `__listeners`). This
 *      is what makes the picker generic across decorator names: any
 *      decorator that stamps one of those static fields qualifies, so
 *      user-defined `@Cron`, `@Subscribe`, etc. work without the
 *      inliner needing a hardcoded allowlist.
 *   4. first function/class-typed named binding
 *   5. first binding as a last resort
 */
function buildBindingPickerExpr(defaultId: string | null, namedIds: string[]): string {
  // Single binding shortcut: no picker needed, the binding is the value.
  if (defaultId && namedIds.length === 0) return defaultId
  if (!defaultId && namedIds.length === 1) return namedIds[0]

  const arr = `[${namedIds.join(',')}]`
  const pickFromArr = [
    `if(_a.length===0)return undefined;`,
    `if(_a.length===1)return _a[0];`,
    `for(let _i=0;_i<_a.length;_i++){`,
      `const _v=_a[_i];`,
      `if(typeof _v==="function"&&(_v.__prefix!==undefined||_v.__routes!==undefined||_v.__schedules!==undefined||_v.__listeners!==undefined))return _v;`,
    `}`,
    `for(let _j=0;_j<_a.length;_j++){`,
      `if(typeof _a[_j]==="function")return _a[_j];`,
    `}`,
    `return _a[0];`,
  ].join('')

  if (defaultId) {
    return [
      `(()=>{`,
      `const _d=${defaultId};`,
      `if(_d!==undefined)return _d;`,
      `const _a=${arr};`,
      pickFromArr,
      `})()`,
    ].join('')
  }
  return [
    `(()=>{`,
    `const _a=${arr};`,
    pickFromArr,
    `})()`,
  ].join('')
}

/**
 * Read the target file and produce a build-time literal that matches the
 * shape the original call would have returned. Returns `null` for any
 * condition that should skip the inline (file missing, file too large,
 * io error) — callers leave the original source intact in those cases
 * so the runtime fs lookup still happens.
 */
function buildFsReadReplacement(targetFile: string, shape: FsReadShape): string | null {
  if (!existsSync(targetFile)) return null
  let stat
  try { stat = statSync(targetFile) } catch { return null }
  if (!stat.isFile()) return null
  if (stat.size > MAX_INLINE_SIZE) return null

  let buffer: Buffer
  try { buffer = readFileSync(targetFile) } catch { return null }

  if (shape === 'sync-string' || shape === 'async-string' || shape === 'bun-text') {
    const text = buffer.toString('utf-8')
    const literal = JSON.stringify(text)
    if (shape === 'sync-string') return literal
    return `Promise.resolve(${literal})`
  }

  // Binary shapes — base64 round-trip keeps the content safe inside JS source.
  const b64 = buffer.toString('base64')
  if (shape === 'sync-buffer') {
    return `Buffer.from(${JSON.stringify(b64)},"base64")`
  }
  if (shape === 'async-buffer') {
    return `Promise.resolve(Buffer.from(${JSON.stringify(b64)},"base64"))`
  }
  // bun-arraybuffer: turn the Buffer into a fresh ArrayBuffer slice that
  // matches `Bun.file(...).arrayBuffer()`'s contract (the consumer expects
  // an `ArrayBuffer`, not a `Buffer`).
  return `Promise.resolve((function(){const _b=Buffer.from(${JSON.stringify(b64)},"base64");return _b.buffer.slice(_b.byteOffset,_b.byteOffset+_b.byteLength);})())`
}

function transformSource(source: string, sites: Site[], fileDir: string, parseSync?: (f: string, s: string) => any): string | null {
  if (sites.length === 0) return null

  let counter = 0
  const importLines: string[] = []
  const sorted = [...sites].sort((a, b) => b.start - a.start)
  let result = source
  let appliedFsReads = 0
  let appliedDirSites = 0

  for (const site of sorted) {
    if (site.type === 'fsRead') {
      const targetFile = isAbsolute(site.path) ? site.path : join(fileDir, site.path)
      const literal = buildFsReadReplacement(targetFile, site.shape)
      if (literal === null) continue
      const replacement = `(/* tekir inline-fs */ ${literal})`
      result = result.slice(0, site.start) + replacement + result.slice(site.end)
      appliedFsReads++
      continue
    }

    const targetDir = isAbsolute(site.path) ? site.path : join(fileDir, site.path)
    const files = listFiles(targetDir)
    // For each file we emit a direct ESM binding for every export it
    // declares: a default import when the file has `export default …`
    // and a named import for every named export. Going through real
    // bindings is what keeps Bun's bundler tree-shaker from dropping
    // the exports as unused. A runtime probe over `import * as ns` is
    // opaque to the shaker, which collapses the namespace to `var ns =
    // {}`; the picker then sees an empty object and `register(empty)`
    // either silently drops the controller or throws "is not a
    // constructor".
    //
    // The actual export selection still happens at runtime, but on the
    // collected bindings rather than on a namespace. Logic mirrors
    // `defaultPick` in `loader.ts`:
    //   1. default export when present
    //   2. exactly one named export
    //   3. a named export whose value carries any tekir registry
    //      metadata (`__prefix` / `__routes` / `__schedules` /
    //      `__listeners`) — generic, so user-defined decorators that
    //      stamp the same fields are picked up automatically
    //   4. first function/class-typed named export
    //   5. the namespace as a last resort
    // Without static parsing (no `parseSync`), we fall back to the
    // legacy `import * as ns + IIFE picker` shape so older callers
    // keep working.
    const elements: string[] = []
    for (const file of files) {
      const rel = JSON.stringify(toRel(file, fileDir))
      if (!parseSync) {
        const id = `__tekir_inline_${counter++}`
        importLines.push(`import * as ${id} from ${rel}`)
        elements.push(buildPickerExpr(id))
        continue
      }
      const exports = readFileExports(file, parseSync)
      if (!exports.hasDefault && exports.named.length === 0) {
        // No analyzable exports (file might be all re-export-from-other,
        // or analysis failed). Fall through to namespace import so the
        // runtime picker has a chance.
        const id = `__tekir_inline_${counter++}`
        importLines.push(`import * as ${id} from ${rel}`)
        elements.push(buildPickerExpr(id))
        continue
      }
      const idx = counter++
      const defaultId = exports.hasDefault ? `__tekir_default_${idx}` : null
      const namedIds = exports.named.map(n => ({ name: n, id: `__tekir_named_${idx}_${n}` }))
      if (defaultId) importLines.push(`import ${defaultId} from ${rel}`)
      if (namedIds.length > 0) {
        const namedClause = namedIds.map(b => `${b.name} as ${b.id}`).join(', ')
        importLines.push(`import { ${namedClause} } from ${rel}`)
      }
      elements.push(buildBindingPickerExpr(defaultId, namedIds.map(b => b.id)))
    }
    const arrayLiteral = `[${elements.join(', ')}]`
    // For loadDir we just need the resolved array; for registerDir we
    // pipe through the original expression's receiver. Replacing the
    // full call with an immediately-resolved Promise of the array works
    // for both because:
    //   await loadDir('x')          -> await Promise.resolve([...])  OK
    //   await router.registerDir(x) -> await router.__inlineRegister([...])  WRONG
    // For registerDir we need to keep the receiver. Detect the kind
    // and either drop the call (loadDir) or call register(...spread).
    const original = source.slice(site.start, site.end)
    let replacement: string
    if (site.type === 'loadDir') {
      replacement = `(/* tekir inline */ Promise.resolve(${arrayLiteral}))`
    } else {
      // registerDir: rewrite to receiver.register(...arr)
      // Find the receiver substring before `.registerDir`
      const dotIdx = original.lastIndexOf('.registerDir')
      if (dotIdx === -1) {
        // bare registerDir (no receiver) treats as loadDir-equivalent
        replacement = `(/* tekir inline */ Promise.resolve(${arrayLiteral}))`
      } else {
        const receiver = original.slice(0, dotIdx)
        replacement = `(/* tekir inline */ ${receiver}.register(...${arrayLiteral}))`
      }
    }
    result = result.slice(0, site.start) + replacement + result.slice(site.end)
    appliedDirSites++
  }

  if (importLines.length === 0 && appliedFsReads === 0 && appliedDirSites === 0) return null
  return importLines.length > 0 ? importLines.join('\n') + '\n' + result : result
}

/**
 * Build a Bun plugin that inlines `loadDir`/`registerDir` literal-string
 * calls. Returns `null` when `oxc-parser` is not available; the caller
 * surfaces an install hint to the user.
 */
export async function createInlinerPlugin(): Promise<any | null> {
  const parser = await tryLoadParser()
  if (!parser) return null
  const { parseSync } = parser

  return {
    name: 'tekir-inliner',
    setup(build: any) {
      build.onLoad({ filter: /\.[tj]sx?$/ }, async (args: { path: string }) => {
        let source: string
        try {
          source = await Bun.file(args.path).text()
        } catch {
          return
        }
        if (!PRE_FILTER.test(source)) return

        const sites = findCallSites(source, args.path, parseSync)
        if (sites.length === 0) return

        const transformed = transformSource(source, sites, dirname(args.path), parseSync)
        if (!transformed) return

        const ext = extname(args.path).slice(1) || 'ts'
        return { contents: transformed, loader: ext === 'mjs' ? 'js' : ext }
      })
    },
  }
}

/**
 * Test-only helpers exposed for the unit tests. The plugin itself uses
 * them through the closure above.
 */
export const __internal = { findCallSites, transformSource, listFiles, toRel }
