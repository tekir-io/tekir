// ChannelManager — orchestrates channel registration, message dispatch, and presence

import { Channel, type ChannelParams } from './channel'
import { PresenceStore, type PresenceStoreInterface } from './presence'
import type { ServerWebSocket, WsHandler } from './index'

type ChannelClass = new () => Channel

/** Function to resolve user from a WS upgrade request (e.g. parse JWT from query/header) */
export type WsAuthResolver = (req: Request) => unknown | Promise<unknown>

let socketCounter = 0

export class ChannelManager {
  private channels = new Map<string, Channel>()
  private presenceStore: PresenceStoreInterface = new PresenceStore()
  private server: any = null
  private authResolver: WsAuthResolver | null = null

  /** Register a channel class */
  register(name: string, ChannelClass: ChannelClass): void {
    const instance = new ChannelClass()
    instance.name = name
    this.channels.set(name, instance)
  }

  /** Set the Bun Server reference (called after Bun.serve()) */
  setServer(server: any): void {
    this.server = server
    for (const ch of this.channels.values()) {
      ch._server = server
    }
  }

  /** Replace the presence store (e.g. with a Redis-backed implementation) */
  setPresenceStore(store: PresenceStoreInterface): void {
    this.presenceStore = store
  }

  /**
   * Set an auth resolver that runs during WebSocket upgrade.
   * The resolver receives the HTTP request and should return a user object or null.
   * The result is stored in ws.data.user.
   *
   * @example
   * ```ts
   * wsm.channelAuth(async (req) => {
   *   const token = new URL(req.url).searchParams.get('token')
   *   if (!token) return null
   *   return await verifyJwt(token)
   * })
   * ```
   */
  setAuthResolver(resolver: WsAuthResolver): void {
    this.authResolver = resolver
  }

  /** Get all registered channel names */
  channelNames(): string[] {
    return Array.from(this.channels.keys())
  }

  /** Build the WsHandler for the channel endpoint */
  buildHandler(): WsHandler {
    return {
      upgrade: async (req: Request) => {
        let user: unknown = null
        if (this.authResolver) {
          try { user = await this.authResolver(req) } catch { /* auth failed, user stays null */ }
        }
        return { __id: String(++socketCounter), __channels: new Set<string>(), user }
      },

      open: (_ws: ServerWebSocket) => {
        // nothing on open — client must send join messages
      },

      message: async (ws: ServerWebSocket, message: string | Buffer) => {
        const raw = typeof message === 'string' ? message : message.toString()
        let msg: any
        try {
          msg = JSON.parse(raw)
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
          return
        }

        const { type, channel: channelName, room, event, data, params } = msg

        if (!type || !channelName || !room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing type, channel, or room' }))
          return
        }

        // Bound channel/room identifier sizes so a hostile client cannot spray
        // arbitrarily long names to inflate presence/topic maps (memory DoS).
        const MAX_NAME = 256
        if (
          typeof channelName !== 'string' || channelName.length > MAX_NAME ||
          typeof room !== 'string' || room.length > MAX_NAME
        ) {
          ws.send(JSON.stringify({ type: 'error', message: 'Channel or room name too long' }))
          return
        }

        const channel = this.channels.get(channelName)
        if (!channel) {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown channel: ${channelName}` }))
          return
        }

        const topic = channel.topic(room)

        if (type === 'join') {
          await this.handleJoin(ws, channel, room, topic, params || {})
        } else if (type === 'leave') {
          await this.handleLeave(ws, channel, room, topic)
        } else if (type === 'event') {
          if (!ws.data.__channels.has(topic)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not joined to this channel room' }))
            return
          }
          await channel.onMessage(ws, event || '', data, room)
        } else {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }))
        }
      },

      close: async (ws: ServerWebSocket, _code: number, _reason: string) => {
        // Clean up all joined channel rooms
        if (!ws.data?.__channels) return
        for (const topic of ws.data.__channels) {
          const [, channelName, room] = topic.split(':')
          const channel = this.channels.get(channelName)
          if (!channel) continue

          ws.unsubscribe(topic)

          if (channel.presence) {
            const memberData = this.presenceStore.leave(topic, ws.data.__id)
            if (memberData) {
              const payload = JSON.stringify({
                type: 'presence:leave',
                channel: channelName,
                room,
                member: memberData,
              })
              if (this.server) this.server.publish(topic, payload)
            }
          }

          await channel.onLeave(ws, room)
        }
        ws.data.__channels.clear()
      },
    }
  }

  private async handleJoin(
    ws: ServerWebSocket,
    channel: Channel,
    room: string,
    topic: string,
    params: ChannelParams,
  ): Promise<void> {
    // Already joined?
    if (ws.data.__channels.has(topic)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Already joined' }))
      return
    }

    // Check requireAuth before channel-specific authorize
    if (channel.requireAuth && !ws.data.user) {
      ws.send(JSON.stringify({ type: 'denied', channel: channel.name, room, reason: 'Authentication required' }))
      return
    }

    // Authorize
    const allowed = await channel.authorize(ws, params)
    if (!allowed) {
      ws.send(JSON.stringify({ type: 'denied', channel: channel.name, room, reason: 'Unauthorized' }))
      return
    }

    // Subscribe to Bun topic
    ws.subscribe(topic)
    ws.data.__channels.add(topic)

    // Presence tracking
    if (channel.presence) {
      const memberData = channel.presenceData(ws)
      this.presenceStore.join(topic, ws.data.__id, memberData)

      // Notify others
      const joinPayload = JSON.stringify({
        type: 'presence:join',
        channel: channel.name,
        room,
        member: memberData,
      })
      ws.publish(topic, joinPayload) // everyone except self

      // Send current members to the joiner
      const syncPayload = JSON.stringify({
        type: 'presence:sync',
        channel: channel.name,
        room,
        members: this.presenceStore.members(topic),
      })
      ws.send(syncPayload)
    }

    // Confirm join
    ws.send(JSON.stringify({ type: 'joined', channel: channel.name, room }))

    // Call channel hook
    await channel.onJoin(ws, room)
  }

  private async handleLeave(
    ws: ServerWebSocket,
    channel: Channel,
    room: string,
    topic: string,
  ): Promise<void> {
    if (!ws.data.__channels.has(topic)) return

    ws.unsubscribe(topic)
    ws.data.__channels.delete(topic)

    if (channel.presence) {
      const memberData = this.presenceStore.leave(topic, ws.data.__id)
      if (memberData) {
        const payload = JSON.stringify({
          type: 'presence:leave',
          channel: channel.name,
          room,
          member: memberData,
        })
        if (this.server) this.server.publish(topic, payload)
      }
    }

    ws.send(JSON.stringify({ type: 'left', channel: channel.name, room }))
    await channel.onLeave(ws, room)
  }
}
