// HTTP Server — abstraction over Bun.serve() and Node.js http

import { isBun } from './detect'
import http from 'node:http'
import { Readable } from 'node:stream'

// `Headers.entries()` lives in the `DOM.Iterable` lib; some consumer
// tsconfigs only pull in `DOM`. `forEach` is on the base `Headers` type
// in plain `DOM`, so it stays portable across tsconfig setups.
function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((value, key) => { out[key] = value })
  return out
}

export interface ServeOptions {
  port: number
  hostname?: string
  fetch: (req: Request) => Response | Promise<Response>
  websocket?: any
  error?: (err: Error) => Response | Promise<Response>
  /** Max request body size in bytes for the Node fallback server. Defaults to 10 MB. */
  maxRequestBodySize?: number
  /** Socket idle timeout in milliseconds for the Node fallback server. Defaults to 120000. */
  idleTimeout?: number
}

const DEFAULT_MAX_BODY = 10 * 1024 * 1024 // 10 MB
const DEFAULT_IDLE_TIMEOUT = 120000 // 120 s

export interface RuntimeServer {
  port: number
  hostname: string
  stop(): void
  upgrade(req: Request, opts?: any): boolean
  publish(topic: string, data: string | Buffer): void
  ref(): void
  unref(): void
}

/**
 * Start an HTTP server. Uses Bun.serve() on Bun, node:http on Node.js.
 *
 * @param {ServeOptions} options - Server configuration including port, hostname, and fetch handler
 * @returns {RuntimeServer} A runtime-agnostic server handle with stop, upgrade, publish, ref, and unref methods
 *
 * @example
 * ```ts
 * const server = serve({
 *   port: 3000,
 *   fetch: (req) => new Response('Hello World'),
 * })
 * console.log(`Listening on port ${server.port}`)
 * ```
 */
export function serve(options: ServeOptions): RuntimeServer {
  if (isBun()) return serveBun(options)
  return serveNode(options)
}

function serveBun(options: ServeOptions): RuntimeServer {
  const bunConfig: any = {
    port: options.port,
    hostname: options.hostname || '0.0.0.0',
    fetch: options.fetch,
    websocket: options.websocket,
    error: options.error,
  }
  // Mirror the Node fallback's body limit / idle timeout onto Bun.serve so
  // the cap holds on both runtimes. Bun's idleTimeout is in seconds.
  if (options.maxRequestBodySize !== undefined) bunConfig.maxRequestBodySize = options.maxRequestBodySize
  if (options.idleTimeout !== undefined) bunConfig.idleTimeout = Math.ceil(options.idleTimeout / 1000)
  const server = (globalThis as any).Bun.serve(bunConfig)

  return {
    port: server.port,
    hostname: server.hostname,
    stop: () => server.stop(),
    upgrade: (req: Request, opts?: any) => server.upgrade(req, opts),
    publish: (topic: string, data: string | Buffer) => server.publish(topic, data),
    ref: () => server.ref?.(),
    unref: () => server.unref?.(),
  }
}

function serveNode(options: ServeOptions): RuntimeServer {
  const maxBody = options.maxRequestBodySize ?? DEFAULT_MAX_BODY
  const idleTimeout = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT

  // Pipe a Web Response to the Node response. Streams the body through
  // `Readable.fromWeb` so SSE / `ReadableStream` responses flush chunk by
  // chunk and large downloads never get buffered into memory.
  const writeResponse = async (nodeRes: any, response: Response) => {
    nodeRes.writeHead(response.status, headersToObject(response.headers))
    if (!response.body) { nodeRes.end(); return }
    const readable = Readable.fromWeb(response.body as any)
    // Abort the upstream stream if the client disconnects mid-response.
    nodeRes.on('close', () => { if (!nodeRes.writableEnded) readable.destroy() })
    try {
      for await (const chunk of readable) {
        if (!nodeRes.write(chunk)) {
          await new Promise<void>((resolve) => nodeRes.once('drain', resolve))
        }
      }
      nodeRes.end()
    } catch {
      if (!nodeRes.writableEnded) nodeRes.end()
    }
  }

  const server = http.createServer(async (nodeReq: any, nodeRes: any) => {
    try {
      const url = `http://${options.hostname || 'localhost'}:${options.port}${nodeReq.url}`
      const headers = new Headers()
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value as string)
      }

      // Reject oversized bodies early via the advertised Content-Length so a
      // hostile client cannot force us to read the whole payload first.
      const declaredLen = Number(nodeReq.headers['content-length'])
      if (Number.isFinite(declaredLen) && declaredLen > maxBody) {
        nodeRes.writeHead(413, { 'Content-Type': 'application/json' })
        nodeRes.end('{"error":"Payload Too Large"}')
        nodeReq.destroy()
        return
      }

      let body: any = undefined
      if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
        const chunks: Buffer[] = []
        let received = 0
        let tooLarge = false
        for await (const chunk of nodeReq) {
          received += chunk.length
          if (received > maxBody) { tooLarge = true; break }
          chunks.push(chunk)
        }
        if (tooLarge) {
          nodeRes.writeHead(413, { 'Content-Type': 'application/json' })
          nodeRes.end('{"error":"Payload Too Large"}')
          nodeReq.destroy()
          return
        }
        body = Buffer.concat(chunks)
      }

      const request = new Request(url, {
        method: nodeReq.method,
        headers,
        body,
      })

      const response = await options.fetch(request)
      await writeResponse(nodeRes, response)
    } catch (err: any) {
      try {
        if (options.error) {
          const errResponse = await options.error(err)
          await writeResponse(nodeRes, errResponse)
        } else if (!nodeRes.headersSent) {
          nodeRes.writeHead(500)
          nodeRes.end('Internal Server Error')
        } else if (!nodeRes.writableEnded) {
          nodeRes.end()
        }
      } catch {
        if (!nodeRes.writableEnded) nodeRes.end()
      }
    }
  })

  // Reap idle / slowloris connections instead of holding sockets open forever.
  server.requestTimeout = idleTimeout
  server.headersTimeout = idleTimeout
  ;(server as any).timeout = idleTimeout

  server.listen(options.port, options.hostname || '0.0.0.0')

  return {
    port: options.port,
    hostname: options.hostname || '0.0.0.0',
    stop: () => server.close(),
    upgrade: () => false, // WebSocket upgrade needs ws package on Node
    publish: () => {}, // No native pub/sub on Node
    ref: () => server.ref(),
    unref: () => server.unref(),
  }
}
