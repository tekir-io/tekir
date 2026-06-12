// Broadcast helper — send events to channel rooms from anywhere (controllers, jobs, etc.)

/**
 * Create a broadcast helper bound to a Bun Server instance.
 *
 * @example
 * ```ts
 * import { broadcast } from '#services'
 *
 * // From a controller
 * broadcast.to('chat', 'general').emit('message', { text: 'Hello everyone' })
 *
 * // From a queue job
 * broadcast.to('notifications', userId).emit('new-order', { orderId: 123 })
 * ```
 */
export function createBroadcast(getServer: () => any) {
  return {
    to(channel: string, room: string): BroadcastTarget {
      return new BroadcastTarget(getServer, channel, room)
    },
  }
}

export type Broadcast = ReturnType<typeof createBroadcast>

class BroadcastTarget {
  private topic: string

  constructor(
    private getServer: () => any,
    private channel: string,
    private room: string,
  ) {
    this.topic = `channel:${channel}:${room}`
  }

  /** Emit an event to all sockets in the room */
  emit(event: string, data?: unknown): void {
    const server = this.getServer()
    if (!server) throw new Error('Server not started — cannot broadcast')
    const payload = JSON.stringify({
      type: 'event',
      channel: this.channel,
      room: this.room,
      event,
      data,
    })
    server.publish(this.topic, payload)
  }
}
