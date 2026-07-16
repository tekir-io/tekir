/* eslint-disable no-control-regex */
import { join } from 'path'
import { createServer } from 'http'
import { getLogger } from '@tekir/core'
import type { NextConfig } from './types'

/**
 * Integrate Next.js with a Tekir server. In dev mode, starts Next.js dev server and proxies requests.
 * In production, serves the pre-built Next.js application.
 *
 * @param {any} server - The Tekir server instance
 * @param {NextConfig} [config={}] - Next.js configuration options
 * @returns {void}
 *
 * @example
 * ```ts
 * import { next } from '@tekir/next'
 *
 * next(server, { dir: './frontend', turbopack: true })
 * ```
 */
export function next(server: any, config: NextConfig = {}) {
  const dir = config.dir || '.'
  const getIsDev = () => config.dev ?? process.env.NODE_ENV !== 'production'

  let nextPort: number | null = null
  let initialized = false
  let nextHttpServer: ReturnType<typeof createServer> | null = null
  let nextApp: any = null

  server.onStop?.(async () => {
    const httpServer = nextHttpServer
    nextHttpServer = null
    nextPort = null
    initialized = false
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
    if (typeof nextApp?.close === 'function') await nextApp.close()
    nextApp = null
  })

  async function initNext() {
    if (initialized) return
    initialized = true
    let started = false

    // The `tekir test` runner exports `TEKIR_RUNNER=test` before
    // launching the test command. Booting Next here would spin up its
    // own internal HTTP listener on a random localhost port, which is
    // dead weight under tests (and slow). The fallback handler still
    // gets registered below; it just no-ops because `nextPort` stays
    // null, which is the same path a prod build with no dev server
    // exercises.
    if (process.env.TEKIR_RUNNER === 'test') return

    const logger = getLogger()
    const absDir = join(process.cwd(), dir)

    try {
      const mod = await import('next')
      const createNext = mod.default || mod
      nextApp = createNext({
        dev: getIsDev(),
        dir: absDir,
        conf: config.conf,
        turbopack: config.turbopack,
      })
      await nextApp.prepare()
      const handler = nextApp.getRequestHandler()

      // Start internal HTTP server for Next.js
      const httpServer = createServer((req, res) => handler(req, res))
      nextHttpServer = httpServer
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        httpServer.once('error', onError)
        httpServer.listen(0, '127.0.0.1', () => {
          ;(httpServer as any).removeListener('error', onError)
          const addr = httpServer.address()
          nextPort = typeof addr === 'object' && addr ? addr.port : null
          resolve()
        })
      })
      started = true
    } catch (err: any) {
      if (nextHttpServer) {
        nextHttpServer.close()
        nextHttpServer = null
      }
      if (typeof nextApp?.close === 'function') await nextApp.close().catch(() => {})
      nextApp = null
      logger.error(`[next] Failed to start: ${err.message}`)
    } finally {
      // A transient startup failure should not wedge the app into a
      // permanent 503. Reset the latch (unless we are under the test runner,
      // which intentionally leaves nextPort null) so the next request retries.
      if (!started && process.env.TEKIR_RUNNER !== 'test') {
        initialized = false
      }
    }
  }

  // Register build hook
  server.onBuild(async () => {
    const logger = getLogger()
    const absDir = join(process.cwd(), dir)
    logger.info('[next] Building...')

    // Suppress all Next.js output, we log our own messages
    const origLog = console.log
    const origError = console.error
    const origWarn = console.warn
    const origStdoutWrite = process.stdout.write.bind(process.stdout)
    const origStderrWrite = process.stderr.write.bind(process.stderr)

    const seen = new Set<string>()
    const emit = (msg: string) => {
      if (seen.has(msg)) return
      if (/^\[[\s=]*\]$/.test(msg)) return
      if (/^\.\s*$/.test(msg)) return
      if (/^\.\.\s*$/.test(msg)) return
      seen.add(msg)
      origStdoutWrite(`\x1b[90m${new Date().toISOString()}\x1b[0m \x1b[32mINFO \x1b[0m [next] ${msg}\n`)
    }

    const capture = (chunk: string) => {
      const clean = chunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '')
      for (const line of clean.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) emit(trimmed)
      }
    }

    console.log = (...args: any[]) => capture(args.map(String).join(' '))
    console.warn = (...args: any[]) => capture(args.map(String).join(' '))
    console.error = (...args: any[]) => capture(args.map(String).join(' '))
    process.stdout.write = ((c: any) => { if (typeof c === 'string') capture(c); return true }) as any
    process.stderr.write = ((c: any) => { if (typeof c === 'string') capture(c); return true }) as any

    try {
      const nextBuild = await import('next/dist/build').then(m => m.default || m)
      // @ts-expect-error -- Next.js internal build API, positional args vary between versions
      await nextBuild(absDir, false, false, false, false, false, false, config.turbopack ?? false, undefined, undefined)
    } finally {
      console.log = origLog
      console.error = origError
      console.warn = origWarn
      process.stdout.write = origStdoutWrite
      process.stderr.write = origStderrWrite
    }
    logger.info('[next] Build complete')
  })

  const isBuildMode = process.argv.includes('build')
  if (!isBuildMode) initNext()

  server.fallback(async (req: Request) => {
    await initNext()
    if (!nextPort) {
      return new Response('{"error":"Next.js not ready"}', { status: 503, headers: { 'Content-Type': 'application/json' } })
    }

    const url = new URL(req.url)
    try {
      const nextUrl = `http://127.0.0.1:${nextPort}${url.pathname}${url.search}`
      const forwardedHeaders = sanitizeProxyHeaders(req.headers, nextPort)
      const res = await fetch(nextUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      })
      const headers = new Headers(res.headers)
      headers.delete('transfer-encoding')
      headers.delete('content-encoding')
      headers.delete('content-length')
      // Stream the response body straight through instead of buffering the
      // whole thing in memory; large downloads / SSE work without bloating RAM.
      return new Response(res.body, { status: res.status, headers })
    } catch (err: any) {
      // A failed fetch to the internal listener is an upstream/gateway
      // failure (Next crashed, connection refused, timeout), not a 404. Map
      // it to 502 so real "not found" only comes from Next itself.
      const logger = getLogger()
      logger.error(`[next] Proxy request failed: ${err?.message ?? err}`)
      return new Response('{"error":"Bad Gateway"}', { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
  })
}

/**
 * Strip hop-by-hop and authority-spoofing headers before forwarding a request
 * to the internal Next listener. The Tekir proxy talks to a localhost Next
 * server, so we never want callers to dictate the `Host` Next sees, claim
 * upstream X-Forwarded-* chains we did not actually produce, or smuggle
 * `Connection: upgrade` / `Transfer-Encoding` semantics into a plain fetch.
 */
export function sanitizeProxyHeaders(incoming: Headers, nextPort: number): Headers {
  const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'http2-settings',
    'content-length',
  ])
  const AUTHORITY = new Set([
    'host',
    'forwarded',
    'x-forwarded-host',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-forwarded-server',
    'x-real-ip',
    'x-original-url',
    'x-original-host',
  ])
  const out = new Headers()
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower) || AUTHORITY.has(lower)) return
    out.append(key, value)
  })
  out.set('host', `127.0.0.1:${nextPort}`)
  return out
}
