import { resolve, relative, isAbsolute } from 'path'
import { realpath } from 'fs/promises'

export interface ResolveResult {
  /** Absolute resolved filesystem path, when `ok` is true. */
  path?: string
  /** Why resolution failed, when `ok` is false. */
  reason?: 'malformed' | 'traversal' | 'dotfile'
  /** Whether resolution succeeded. */
  ok: boolean
}

/**
 * Decode a request URL path, contain it under `root`, and apply a dot-segment
 * policy to **every** segment of the path (not just the trailing filename).
 *
 * This is shared between {@link serveStatic} middleware and the
 * {@link StaticProvider} fallback so traversal, malformed percent-encoding,
 * and dot-directory hits like `/.git/config` or `/.env/foo` are all
 * filtered with the same rules.
 *
 * @param pathname  - URL pathname (e.g. `'/assets/app.js'`).
 * @param root      - Resolved filesystem root directory.
 * @param dotFiles  - How to treat path segments that begin with `.`. `'allow'`
 *                    lets them through; `'ignore'` and `'deny'` both reject
 *                    here — the caller decides whether to translate that into
 *                    a 403 or a fall-through.
 */
export function resolveSafePath(
  pathname: string,
  root: string,
  dotFiles: 'allow' | 'ignore' | 'deny' = 'ignore',
): ResolveResult {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // Reject embedded NUL bytes (e.g. `/file.jpg%00.txt`). Modern fs calls
  // throw on NUL, but filtering here keeps the failure mode predictable
  // (400 instead of an unhandled read error) and defends against legacy
  // path-truncation tricks.
  if (decoded.includes('\0')) {
    return { ok: false, reason: 'malformed' }
  }

  if (dotFiles !== 'allow') {
    // Split on either separator. Without backslash coverage the dotfile
    // policy is byte-trivial to bypass on Windows: a request encoded as
    // `/assets%5C.git/config` decodes to `/assets\.git/config`, which a
    // `/`-only split sees as the single segment `assets\.git`. Windows
    // then resolves the backslash, so `.git/config` lands on disk
    // unfiltered. POSIX runtimes treat `\` as a literal character so the
    // extra split is a no-op there.
    for (const segment of decoded.split(/[\\/]+/)) {
      if (segment.startsWith('.') && segment !== '.' && segment !== '..') {
        return { ok: false, reason: 'dotfile' }
      }
    }
  }

  const filePath = resolve(root, decoded.replace(/^\/+/, ''))
  const rel = relative(root, filePath)
  // On Windows, a path that resolves to a different drive (e.g.
  // `D:\secret` while root is `C:\app\public`) comes back from
  // `relative()` as an absolute path on the other drive. `startsWith('..')`
  // misses that case, so check `isAbsolute(rel)` explicitly.
  if (rel === '..' || rel.startsWith('..') || rel.startsWith('/') || isAbsolute(rel)) {
    return { ok: false, reason: 'traversal' }
  }
  return { ok: true, path: filePath }
}

/**
 * Resolve symlinks in `filePath` and confirm the real target is still
 * contained under `root`. The string-level {@link resolveSafePath} cannot
 * see through a symlink that points outside the root (e.g.
 * `public/leak -> /etc`), so callers that need hard isolation run this
 * extra check before serving.
 *
 * Returns `true` when containment holds. A missing file (`ENOENT`) resolves
 * its existing parent components and is treated as contained, so this never
 * turns a normal 404 into a false traversal positive.
 *
 * @param filePath - Absolute path already vetted by {@link resolveSafePath}.
 * @param root     - Resolved filesystem root directory.
 */
export async function realPathContained(filePath: string, root: string): Promise<boolean> {
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    realRoot = root
  }
  let realFile: string
  try {
    realFile = await realpath(filePath)
  } catch {
    // File does not exist yet (or a component is missing): nothing escapes
    // because there is nothing to read. Containment is decided by the
    // string-level check that already passed.
    return true
  }
  const rel = relative(realRoot, realFile)
  return !(rel === '..' || rel.startsWith('..') || rel.startsWith('/') || isAbsolute(rel))
}
