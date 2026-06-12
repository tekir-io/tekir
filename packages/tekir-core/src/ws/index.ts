// WebSocket support for Tekir — wraps Bun's native WebSocket API

import { Channel } from './channel'
import { ChannelManager } from './channel_manager'

export { Channel, ChannelManager }
export type { ChannelParams } from './channel'
export type { WsAuthResolver } from './channel_manager'
export { PresenceStore, type PresenceStoreInterface } from './presence'
export { createBroadcast, type Broadcast } from './broadcast'

export interface WsContext<T = any> {
  ws: ServerWebSocket<T>
  data: T
  message: string | Buffer
}

export interface WsHandler<T = any> {
  open?: (ws: ServerWebSocket<T>) => void | Promise<void>
  message?: (ws: ServerWebSocket<T>, message: string | Buffer) => void | Promise<void>
  close?: (ws: ServerWebSocket<T>, code: number, reason: string) => void | Promise<void>
  drain?: (ws: ServerWebSocket<T>) => void | Promise<void>
  upgrade?: (req: Request) => T | Promise<T>  // return data to attach to ws
}

export interface WsRoute<T = any> {
  path: string
  handler: WsHandler<T>
}

export interface ServerWebSocket<T = any> {
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
  data: T
  readyState: number
  readonly remoteAddress: string
  subscribe(topic: string): void
  unsubscribe(topic: string): void
  publish(topic: string, data: string | Buffer): void
  isSubscribed(topic: string): boolean
  cork(callback: () => void): void
}

/**
 * WebSocket manager — collects WS routes and produces Bun.serve websocket config.
 *
 * @example
 * ```ts
 * import { WsManager } from '@tekir/core'
 *
 * const wsm = server.ws()
 *
 * wsm.route('/ws/chat', {
 *   upgrade(req) {
 *     const url = new URL(req.url)
 *     return { room: url.searchParams.get('room') || 'general' }
 *   },
 *   open(ws) {
 *     ws.subscribe(ws.data.room)
 *     ws.publish(ws.data.room, `User joined`)
 *   },
 *   message(ws, msg) {
 *     ws.publish(ws.data.room, String(msg))
 *   },
 *   close(ws) {
 *     ws.publish(ws.data.room, `User left`)
 *   },
 * })
 * ```
 */
export class WsManager {
  private routes = new Map<string, WsHandler>()
  private channelManager: ChannelManager | null = null

  route<T = any>(path: string, handler: WsHandler<T>): this {
    this.routes.set(path, handler)
    return this
  }

  /**
   * Set the auth resolver for WebSocket channels.
   * Runs during upgrade — resolve user from token, cookie, or query param.
   *
   * @example
   * ```ts
   * // JWT from query string
   * wsm.channelAuth(async (req) => {
   *   const token = new URL(req.url).searchParams.get('token')
   *   return token ? await jwt.verify(token) : null
   * })
   *
   * // Database token from header
   * wsm.channelAuth(async (req) => {
   *   const token = req.headers.get('authorization')?.replace('Bearer ', '')
   *   return token ? await db.queryOne('SELECT u.* FROM users u JOIN tokens t ON t.user_id = u.id WHERE t.token = ?', [token]) : null
   * })
   * ```
   */
  channelAuth(resolver: (req: Request) => unknown | Promise<unknown>): this {
    if (!this.channelManager) {
      this.channelManager = new ChannelManager()
    }
    this.channelManager.setAuthResolver(resolver)
    return this
  }

  /** Register a channel class for the multiplexed /ws endpoint */
  channel(name: string, ChannelClass: new () => Channel): this {
    if (!this.channelManager) {
      this.channelManager = new ChannelManager()
    }
    this.channelManager.register(name, ChannelClass)
    return this
  }

  /** Get the ChannelManager instance (if channels are registered) */
  getChannelManager(): ChannelManager | null {
    return this.channelManager
  }

  hasRoutes(): boolean {
    return this.routes.size > 0 || this.channelManager !== null
  }

  // Build the fetch upgrade handler + websocket config for Bun.serve
  build() {
    // Auto-register channel endpoint if channels exist
    if (this.channelManager && !this.routes.has('/ws')) {
      this.routes.set('/ws', this.channelManager.buildHandler())
    }

    const routes = this.routes

    const upgradeHandler = async (req: Request, server: any): Promise<Response | undefined> => {
      const url = new URL(req.url)
      const path = url.pathname

      for (const [pattern, handler] of routes) {
        if (matchPath(pattern, path)) {
          let data: any = {}
          if (handler.upgrade) {
            data = await handler.upgrade(req)
          }
          data.__wsPath = pattern
          const success = server.upgrade(req, { data })
          if (success) return undefined // Bun handles the upgrade
          return new Response('WebSocket upgrade failed', { status: 500 })
        }
      }
      return undefined // not a WS route
    }

    // Wrap each handler call so a throw or rejected Promise from user code
    // does not become an unhandled rejection (which can crash the server).
    // Handlers may be sync or async; `Promise.resolve(...).catch` covers both.
    const safeCall = (fn: any, ...args: any[]) => {
      try {
        const r = fn(...args)
        if (r && typeof r.then === 'function') r.catch((err: any) => {

          console.error('[tekir:ws] handler error:', err)
        })
      } catch (err) {

        console.error('[tekir:ws] handler error:', err)
      }
    }

    const websocket = {
      open(ws: any) {
        const handler = routes.get(ws.data?.__wsPath)
        if (handler?.open) safeCall(handler.open.bind(handler), ws)
      },
      message(ws: any, message: any) {
        const handler = routes.get(ws.data?.__wsPath)
        if (handler?.message) safeCall(handler.message.bind(handler), ws, message)
      },
      close(ws: any, code: number, reason: string) {
        const handler = routes.get(ws.data?.__wsPath)
        if (handler?.close) safeCall(handler.close.bind(handler), ws, code, reason)
      },
      drain(ws: any) {
        const handler = routes.get(ws.data?.__wsPath)
        if (handler?.drain) safeCall(handler.drain.bind(handler), ws)
      },
    }

    return { upgradeHandler, websocket }
  }
}

function matchPath(pattern: string, path: string): boolean {
  if (pattern === path) return true
  // Simple param matching: /ws/:room → /ws/general
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')
  if (patternParts.length !== pathParts.length) return false
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) continue
    if (patternParts[i] !== pathParts[i]) return false
  }
  return true
}
