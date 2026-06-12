import { join, resolve } from 'path'
import { readFile, fileExists, isDirectory, fileStat } from '@tekir/runtime'
import type { StaticConfig } from './types'
import { resolveSafePath, realPathContained } from './resolver'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'))
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Static file serving middleware with ETag support, cache headers, and directory traversal protection.
 * @param config - Configuration for root directory, cache control, dot files handling, and index file.
 */
export function serveStatic(config: StaticConfig = {}) {
  const dir = config.dir || 'public'
  const dotFiles = config.dotFiles || 'ignore'
  const maxAge = config.maxAge || 0
  const immutable = config.immutable || false
  const index = config.index || 'index.html'
  const useEtag = config.etag !== false
  const symlinks = config.symlinks || 'follow'

  return async (ctx: any, next: () => Promise<void>) => {
    const method = ctx.request?.method || ctx.request?.raw?.method || ''
    if (method !== 'GET' && method !== 'HEAD') return next()

    const rawPath = ctx.request?.path || new URL(ctx.request?.raw?.url || ctx.request?.url || '').pathname

    const root = resolve(process.cwd(), dir)
    const resolved = resolveSafePath(rawPath, root, dotFiles)
    if (!resolved.ok) {
      if (resolved.reason === 'malformed') {
        return new Response('Bad Request', { status: 400 })
      }
      if (resolved.reason === 'dotfile' && dotFiles === 'deny') {
        return new Response('Forbidden', { status: 403 })
      }
      return next()
    }
    let filePath = resolved.path!

    // Try index file for directories
    if (await isDirectory(filePath)) {
      filePath = join(filePath, index)
    }

    if (!(await fileExists(filePath)) || await isDirectory(filePath)) {
      return next()
    }

    // Hard isolation: refuse to serve a symlink that escapes the root.
    if (symlinks === 'deny' && !(await realPathContained(filePath, root))) {
      return next()
    }

    // The fileExists/readFile gap is a TOCTOU window: the file may vanish or
    // become unreadable between the checks. Catch the read error and fall
    // through instead of surfacing a 500 / unhandled rejection.
    let fileData: unknown
    try {
      fileData = await readFile(filePath)
    } catch {
      return next()
    }
    const headers: Record<string, string> = {
      'Content-Type': getMimeType(filePath),
    }

    if (maxAge > 0 || immutable) {
      let cc = maxAge > 0 ? `public, max-age=${maxAge}` : 'public'
      if (immutable) cc += ', immutable'
      headers['Cache-Control'] = cc
    }

    if (useEtag) {
      const stat = await fileStat(filePath)
      if (!stat) return next()
      headers['ETag'] = `"${stat.size}-${stat.mtimeMs}"`

      const ifNoneMatch = ctx.request?.header?.('if-none-match') || ctx.headers?.['if-none-match']
      if (ifNoneMatch === headers['ETag']) {
        return new Response(null, { status: 304, headers })
      }
    }

    return new Response(fileData as any, { headers })
  }
}
