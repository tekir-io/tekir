import { Emitter } from './emitter'

/**
 * A fake emitter for testing that records all emitted events instead of
 * dispatching them to handlers. Provides assertion helpers for verifying
 * which events were emitted.
 *
 * @typeParam Events - A record mapping event names to their payload types.
 *
 * @example
 * ```ts
 * const fake = new FakeEmitter<{ 'order:placed': { id: string } }>()
 * await fake.emit('order:placed', { id: '1' })
 * fake.assertEmitted('order:placed') // true
 * fake.getEmitted('order:placed')    // [{ id: '1' }]
 * ```
 */
export class FakeEmitter<Events extends Record<string, unknown>> extends Emitter<Events> {
  private _emitted: Array<{ event: string; data: unknown }> = []

  /**
   * Record an event emission without dispatching to real handlers.
   *
   * @param event - The event name.
   * @param data - The event payload.
   */
  async emit<K extends keyof Events & string>(event: K, data: Events[K]): Promise<void> { this._emitted.push({ event, data }) }

  /**
   * Check whether a specific event was emitted at least once.
   *
   * @param event - The event name to check.
   * @returns `true` if the event was emitted.
   */
  assertEmitted<K extends keyof Events & string>(event: K): boolean { return this._emitted.some(e => e.event === event) }

  /**
   * Check whether a specific event was emitted exactly `count` times.
   *
   * @param event - The event name to check.
   * @param count - The expected emission count.
   * @returns `true` if the event was emitted exactly `count` times.
   */
  assertEmittedCount<K extends keyof Events & string>(event: K, count: number): boolean { return this._emitted.filter(e => e.event === event).length === count }

  /**
   * Retrieve all payloads that were emitted for a specific event.
   *
   * @param event - The event name.
   * @returns An array of event payloads in emission order.
   */
  getEmitted<K extends keyof Events & string>(event: K): Events[K][] { return this._emitted.filter(e => e.event === event).map(e => e.data as Events[K]) }

  /**
   * Clear all recorded emissions, resetting the fake to a clean state.
   */
  reset(): void { this._emitted = [] }
}
