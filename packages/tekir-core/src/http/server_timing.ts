// Server-Timing middleware — adds performance metrics to response headers
//
// The Server-Timing header lets you communicate backend performance metrics
// to the browser DevTools (Network tab → Timing).
//
// Usage in kernel.ts:
//   import { serverTiming } from '@tekir/core'
//   router.useRouter([serverTiming()])
//
// In controllers, add custom metrics:
//   ctx.timing.start('db')
//   const users = await User.all()
//   ctx.timing.end('db')
//
//   ctx.timing.add('cache', 2.5, 'Cache lookup')
//
// Response header:
//   Server-Timing: total;dur=12.5, db;dur=8.2, cache;dur=2.5;desc="Cache lookup"

export interface TimingEntry {
  name: string
  start?: number
  duration?: number
  description?: string
}

export class ServerTimingContext {
  private entries = new Map<string, TimingEntry>()
  private requestStart: number

  constructor() {
    this.requestStart = performance.now()
  }

  /** Start a named timer */
  start(name: string): void {
    this.entries.set(name, { name, start: performance.now() })
  }

  /** End a named timer */
  end(name: string): void {
    const entry = this.entries.get(name)
    if (entry && entry.start !== undefined) {
      entry.duration = performance.now() - entry.start
    }
  }

  /** Add a metric with a known duration */
  add(name: string, duration: number, description?: string): void {
    this.entries.set(name, { name, duration, description })
  }

  /** Get total request duration */
  get totalDuration(): number {
    return performance.now() - this.requestStart
  }

  /** Build the Server-Timing header value */
  toHeader(): string {
    const parts: string[] = []

    // Add total duration
    parts.push(`total;dur=${this.totalDuration.toFixed(1)}`)

    for (const entry of this.entries.values()) {
      let part = entry.name
      if (entry.duration !== undefined) part += `;dur=${entry.duration.toFixed(1)}`
      if (entry.description) part += `;desc="${entry.description}"`
      parts.push(part)
    }

    return parts.join(', ')
  }
}

/**
 * Server Timing middleware — tracks request timing and adds Server-Timing header.
 *
 * @example
 * router.useRouter([serverTiming()])
 *
 * // In handler:
 * async show(ctx) {
 *   ctx.timing.start('db')
 *   const user = await User.find(1)
 *   ctx.timing.end('db')
 *   return user
 * }
 *
 * // Browser DevTools shows:
 * // total: 12.5ms, db: 8.2ms
 */
export function serverTiming() {
  return async (ctx: any, next: () => Promise<void>) => {
    const timing = new ServerTimingContext()
    ctx.timing = timing

    await next()

    // Attach Server-Timing header to response
    const result = ctx.$result
    if (result instanceof Response) {
      result.headers.set('Server-Timing', timing.toHeader())
    } else if (result && typeof result === 'object' && !(result instanceof Response)) {
      // For JSON responses, wrap with header
      ctx.$result = Response.json(result, {
        headers: { 'Server-Timing': timing.toHeader(), 'Content-Type': 'application/json' },
      })
    }
  }
}

declare module './types' {
  interface HttpContext {
    timing: {
      start: (name: string) => void
      end: (name: string) => void
      add: (name: string, duration: number, description?: string) => void
    }
  }
}
