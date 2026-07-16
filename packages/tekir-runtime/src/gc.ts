// Garbage collection hint — Bun.gc() on Bun, global.gc() on Node (--expose-gc), no-op otherwise

import { isBun } from './detect.js'

/**
 * Hint the runtime to run garbage collection.
 * Uses Bun.gc() on Bun, global.gc() on Node.js (requires --expose-gc flag), or no-op if unavailable.
 *
 * @returns {void}
 *
 * @example
 * ```ts
 * gc() // triggers GC if available
 * ```
 */
export function gc(): void {
  if (isBun() && (globalThis as any).Bun.gc) {
    (globalThis as any).Bun.gc(true)
    return
  }
  if (typeof (globalThis as any).gc === 'function') {
    (globalThis as any).gc()
  }
}
