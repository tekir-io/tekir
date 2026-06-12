/**
 * Folder-based module loader. Imports every file in a directory and
 * returns the picked export from each one as an array. Use it instead of
 * a long list of explicit imports for things like controllers, cron
 * jobs, listeners, or commands.
 *
 * Works on both Bun and Node by combining `@tekir/runtime`'s
 * `readDirRecursive` (which uses `Bun.Glob` on Bun, `fs` on Node) with a
 * dynamic `import()` of each file's `file://` URL.
 *
 * @example Load all controllers and pass them to the router
 * ```ts
 * import { loadDir } from '@tekir/core'
 *
 * const controllers = await loadDir('app/controllers')
 * router.register(...controllers)
 * ```
 *
 * @example Custom picker (named export instead of default)
 * ```ts
 * const jobs = await loadDir('app/jobs', {
 *   pick: (mod) => mod.Job ?? mod.default,
 * })
 * ```
 *
 * Note: dynamic imports with computed paths cannot be statically traced
 * by `bun build --compile`. If you ship a single-executable build, keep
 * the explicit-imports list (or generate it from the directory at build
 * time). For `bun run` and `node` runtimes this loader works as-is.
 */

import { existsSync, statSync } from 'fs'
import { join, isAbsolute, basename, extname, dirname } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { readDirRecursive } from '@tekir/runtime'

export interface LoadDirOptions {
  /** Allowed file extensions. Defaults to `['.ts', '.tsx', '.js', '.jsx', '.mjs']`. */
  extensions?: string[]
  /** Skip files whose name (without extension) does not match this pattern. */
  match?: RegExp
  /** Skip files whose name (without extension) matches this pattern. */
  ignore?: RegExp
  /** Walk into subdirectories. Defaults to `false`. */
  recursive?: boolean
  /**
   * Pick the export(s) to return per file. The default tries (in order):
   * 1. `mod.default` if defined
   * 2. The single named export when there is exactly one
   * 3. A function whose static metadata looks decorator-tagged
   *    (`__prefix`, `__routes`, `__schedules`, `__listeners`)
   * 4. The first function-typed named export
   * 5. Falls through to the namespace `mod` itself
   *
   * That covers `export default Class`, `export class FooController`,
   * `export const handler = (router) => {...}`, and decorator-only files
   * without forcing the user to write a custom picker.
   */
  pick?: (mod: Record<string, unknown>, file: string) => unknown
  /** Drop entries where the picker returned `undefined` or `null`. Defaults to `true`. */
  filterEmpty?: boolean
  /** Sort the returned entries by filename (alphabetical). Defaults to `true`. */
  sort?: boolean
  /**
   * Base directory for resolving a relative `dir` argument. Accepts an
   * absolute filesystem path (a directory, or a file whose parent dir
   * is used) or a `file://` URL string — typically `import.meta.url`,
   * which is portable across Bun and Node ESM.
   *
   * Defaults to `process.cwd()`. The `*.registerDir()` wrappers on
   * router/cron/emitter automatically capture their caller's file via
   * stack inspection when `from` is omitted, so a relative
   * `registerDir('./controllers')` resolves against the caller's own
   * directory at runtime — the same way the AST inliner does at build
   * time.
   */
  from?: string | URL
}

/**
 * One entry in the result of {@link loadDirEntries}: the file the module
 * came from, the namespace import, and the picked export. Carries the
 * file path so callers (router/cron/emitter `registerDir`) can mention
 * the source file in their warnings.
 */
export interface LoadDirEntry<T = unknown> {
  file: string
  module: Record<string, unknown>
  picked: T
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

const DECORATOR_MARKERS = ['__prefix', '__routes', '__schedules', '__listeners'] as const

function defaultPick(mod: Record<string, unknown>): unknown {
  if (mod.default !== undefined) return mod.default

  const named = Object.entries(mod).filter(([key]) => key !== 'default')
  if (named.length === 0) return mod
  if (named.length === 1) return named[0][1]

  // Multiple named exports — prefer one whose static fields look like
  // decorator metadata (controllers, jobs, listeners). Falls back to the
  // first function-typed export, then the namespace as a last resort so
  // the caller's pattern matcher can decide what to do with it.
  for (const [, value] of named) {
    if (typeof value === 'function') {
      for (const marker of DECORATOR_MARKERS) {
        if ((value as any)[marker] !== undefined) return value
      }
    }
  }
  for (const [, value] of named) {
    if (typeof value === 'function') return value
  }
  return mod
}

/**
 * Load every module file in a directory and return their picked exports.
 *
 * @param dir Directory to load. Absolute paths are used as-is. Relative
 *   paths resolve against `options.from` (if provided) or the current
 *   working directory.
 * @param options See {@link LoadDirOptions}.
 * @returns Array of picked exports, one entry per imported file.
 */
export async function loadDir<T = unknown>(
  dir: string,
  options: LoadDirOptions = {},
): Promise<T[]> {
  const entries = await loadDirEntries<T>(dir, options)
  return entries.map(e => e.picked)
}

/**
 * Resolve `options.from` (if provided) to a directory we can use as the
 * base for relative `dir` resolution. Accepts:
 *   - `URL` instance (treated as `file://` URL → fs path, then dirname
 *     when it points at a file)
 *   - `file://` URL string (same as above)
 *   - absolute filesystem path (directory used directly, file's dirname
 *     used otherwise)
 * Returns `undefined` for any unparseable value so callers can fall
 * through to `process.cwd()`.
 */
function resolveBaseDir(from: string | URL | undefined): string | undefined {
  if (!from) return undefined
  let raw = typeof from === 'string' ? from : from.href
  if (raw.startsWith('file:')) {
    try { raw = fileURLToPath(raw) } catch { return undefined }
  }
  try {
    return statSync(raw).isDirectory() ? raw : dirname(raw)
  } catch {
    // Path may not exist yet; assume it was meant to be a file path so
    // its parent directory is the base. `existsSync(root)` later returns
    // false either way and the caller bails with a "no modules" warning.
    return dirname(raw)
  }
}

/**
 * @internal
 * Walk the call stack to find the file that called `boundary`. Used by
 * `*.registerDir()` so a relative path argument resolves against the
 * caller's own directory at runtime, matching the AST inliner's
 * file-relative resolution at build time.
 *
 * Both Bun and Node honor `Error.captureStackTrace(obj, fn)` to drop
 * frames at and above `fn` from the captured stack. The frame format
 * differs (Bun emits raw filesystem paths, Node emits `file://` URLs);
 * the parser accepts both. Returns `undefined` if no usable user frame
 * shows up — callers fall back to `process.cwd()` in that case.
 */
export function captureCallerFile(boundary: Function): string | undefined {
  const tmp: { stack?: string } = {}
  if (typeof (Error as any).captureStackTrace === 'function') {
    ;(Error as any).captureStackTrace(tmp, boundary)
  } else {
    tmp.stack = new Error().stack
  }
  if (!tmp.stack) return undefined
  for (const line of tmp.stack.split('\n')) {
    const path = parseStackFramePath(line)
    if (path) return path
  }
  return undefined
}

/**
 * Pull a real filesystem path out of a single stack-trace line if the
 * line refers to a user file. Engine internal frames (Bun's `native:1:11`
 * module-machinery markers, Node's `node:internal/...`, anonymous eval
 * frames) all return `null` so `captureCallerFile` can keep walking.
 *
 * The return value is required to look like an absolute filesystem path
 * (Unix `/` root or Windows drive letter) or a `file://` URL — anything
 * else is rejected as not-a-file. That blocks `native` (left over after
 * stripping the `:1:11` suffix), `<anonymous>`, and any other token the
 * engine might emit for non-file frames.
 */
function parseStackFramePath(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('at ')) return null
  const parenMatch = trimmed.match(/\(([^()]+)\)\s*$/)
  let raw = parenMatch ? parenMatch[1] : trimmed.slice(3)
  raw = raw.replace(/:\d+(?::\d+)?\s*$/, '')
  if (!raw) return null

  if (raw.startsWith('file:')) {
    try { return fileURLToPath(raw) } catch { return null }
  }

  // Reject Node/Bun synthetic module markers and anonymous frames.
  if (raw.startsWith('node:')) return null
  if (raw === 'native' || raw.startsWith('native:')) return null
  if (raw === '<anonymous>') return null

  // Real filesystem paths only: Unix root or Windows drive letter.
  const isAbsolutePath = raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)
  if (!isAbsolutePath) return null

  return raw
}

/**
 * Like {@link loadDir} but keeps the source file path on every result
 * so callers can mention it when something looks off (registerDir uses
 * this for "skipped <file>: unrecognized export shape" warnings).
 *
 * @param dir Directory to load. Absolute paths are used as-is. Relative
 *   paths resolve against `options.from` (if provided) or the
 *   current working directory.
 * @param options See {@link LoadDirOptions}.
 */
export async function loadDirEntries<T = unknown>(
  dir: string,
  options: LoadDirOptions = {},
): Promise<LoadDirEntry<T>[]> {
  let root: string
  if (isAbsolute(dir)) {
    root = dir
  } else {
    const base = resolveBaseDir(options.from) ?? process.cwd()
    root = join(base, dir)
  }
  if (!existsSync(root)) return []

  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const recursive = options.recursive ?? false
  const filterEmpty = options.filterEmpty ?? true
  const sort = options.sort ?? true
  const pick = options.pick ?? defaultPick

  let files = await readDirRecursive(root, { extensions })
  // Drop type-declaration siblings.
  files = files.filter(f => !f.endsWith('.d.ts'))

  if (!recursive) {
    // Non-recursive mode: keep only direct children of `root`.
    const rootLen = root.length + 1
    files = files.filter(f => {
      const rel = f.slice(rootLen)
      return !rel.includes('/') && !rel.includes('\\')
    })
  }

  if (options.match || options.ignore) {
    files = files.filter(f => {
      const name = basename(f, extname(f))
      if (options.match && !options.match.test(name)) return false
      if (options.ignore && options.ignore.test(name)) return false
      return true
    })
  }
  if (sort) files.sort()

  const out: LoadDirEntry<T>[] = []
  for (const file of files) {
    // `pathToFileURL` is required on Node ESM (Windows in particular);
    // Bun accepts both absolute paths and file:// URLs, so it stays safe.
    const mod = await import(pathToFileURL(file).href) as Record<string, unknown>
    const picked = pick(mod, file)
    if (filterEmpty && (picked === undefined || picked === null)) continue
    out.push({ file, module: mod, picked: picked as T })
  }
  return out
}
