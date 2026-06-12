// In-memory presence store for tracking connected members per channel room

export interface PresenceStoreInterface {
  join(topic: string, socketId: string, data: Record<string, unknown>): void
  leave(topic: string, socketId: string): Record<string, unknown> | undefined
  members(topic: string): Record<string, unknown>[]
  count(topic: string): number
  clear(topic: string): void
}

export class PresenceStore implements PresenceStoreInterface {
  private store = new Map<string, Map<string, Record<string, unknown>>>()

  join(topic: string, socketId: string, data: Record<string, unknown>): void {
    let room = this.store.get(topic)
    if (!room) {
      room = new Map()
      this.store.set(topic, room)
    }
    room.set(socketId, data)
  }

  leave(topic: string, socketId: string): Record<string, unknown> | undefined {
    const room = this.store.get(topic)
    if (!room) return undefined
    const data = room.get(socketId)
    room.delete(socketId)
    if (room.size === 0) this.store.delete(topic)
    return data
  }

  members(topic: string): Record<string, unknown>[] {
    const room = this.store.get(topic)
    if (!room) return []
    return Array.from(room.values())
  }

  count(topic: string): number {
    return this.store.get(topic)?.size ?? 0
  }

  clear(topic: string): void {
    this.store.delete(topic)
  }
}
