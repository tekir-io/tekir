// Channel base class — extend this to define WebSocket channels

import type { ServerWebSocket } from './index'

export interface ChannelParams {
  [key: string]: unknown
}

/**
 * Base class for WebSocket channels. Extend this and register with `wsm.channel()`.
 *
 * @example
 * ```ts
 * import { Channel } from '@tekir/core'
 *
 * export class ChatChannel extends Channel {
 *   authorize(ws, params) {
 *     return !!ws.data.user // only authenticated users
 *   }
 *
 *   onJoin(ws, room) {
 *     this.broadcast(room, 'user:joined', { user: ws.data.user.name })
 *   }
 *
 *   onMessage(ws, event, data, room) {
 *     if (event === 'message') {
 *       this.broadcastExcept(ws, room, 'message', {
 *         text: data.text,
 *         user: ws.data.user.name,
 *       })
 *     }
 *   }
 *
 *   onLeave(ws, room) {
 *     this.broadcast(room, 'user:left', { user: ws.data.user.name })
 *   }
 * }
 * ```
 */
export abstract class Channel {
  /** Channel name — set automatically by ChannelManager */
  name = ''

  /** Enable presence tracking for this channel */
  presence = false

  /** Require authenticated user to join. Checked before authorize(). */
  requireAuth = false

  /** Bun Server reference — set by ChannelManager after boot */
  _server: any = null

  /**
   * Authorize a socket to join this channel. Return false to deny.
   * Override this to add auth logic.
   */
  authorize(_ws: ServerWebSocket, _params: ChannelParams): boolean | Promise<boolean> {
    return true
  }

  /**
   * Return the data that represents this member in presence tracking.
   * Override to customize — default returns ws.data.user or socket id.
   */
  presenceData(ws: ServerWebSocket): Record<string, unknown> {
    return ws.data?.user ? { ...ws.data.user } : { id: ws.data?.__id }
  }

  /** Called when a socket successfully joins a room */
  onJoin(_ws: ServerWebSocket, _room: string): void | Promise<void> {}

  /** Called when a socket sends an event to a room */
  onMessage(_ws: ServerWebSocket, _event: string, _data: unknown, _room: string): void | Promise<void> {}

  /** Called when a socket leaves a room (explicit or disconnect) */
  onLeave(_ws: ServerWebSocket, _room: string): void | Promise<void> {}

  /** Build the topic string for Bun's pub/sub */
  topic(room: string): string {
    return `channel:${this.name}:${room}`
  }

  /** Broadcast to all sockets in a room (including sender) */
  broadcast(room: string, event: string, data?: unknown): void {
    if (!this._server) return
    const payload = JSON.stringify({
      type: 'event',
      channel: this.name,
      room,
      event,
      data,
    })
    this._server.publish(this.topic(room), payload)
  }

  /** Broadcast to all sockets in a room except the sender */
  broadcastExcept(ws: ServerWebSocket, room: string, event: string, data?: unknown): void {
    const payload = JSON.stringify({
      type: 'event',
      channel: this.name,
      room,
      event,
      data,
    })
    ws.publish(this.topic(room), payload)
  }
}
