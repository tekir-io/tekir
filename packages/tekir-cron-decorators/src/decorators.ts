import type { ScheduleMetadata } from './types'

// Upper bound (exclusive of 0) for the `*/n` step form of each unit. A second
// or minute field accepts 0-59 and an hour field 0-23, so a step larger than
// the field's range produces a cron the scheduler can never match.
const EVERY_MAX: Record<string, number> = { s: 59, m: 59, h: 23 }

/**
 * Translate a human-readable interval like `30s`, `5m`, `1h` into a cron
 * expression. A value that already looks like a multi-field cron expression
 * (contains a space) is passed through untouched.
 *
 * @throws Error if the interval matches the `<number><unit>` shape but the
 *   value is out of range for that unit (e.g. `90s`, `25h`, `0m`), which would
 *   otherwise yield a cron that never fires.
 */
function parseEvery(interval: string): string {
  // Already a cron expression (multiple space-separated fields) — pass through.
  if (interval.includes(' ')) return interval

  const match = interval.match(/^(\d+)(s|m|h)$/)
  if (!match) {
    throw new Error(
      `[cron] @Every("${interval}") is not a valid interval. ` +
      `Use "<number><s|m|h>" (e.g. "30s", "5m", "1h") or a full cron expression.`,
    )
  }

  const [, value, unit] = match
  const n = Number(value)
  const max = EVERY_MAX[unit]

  if (n < 1 || n > max) {
    throw new Error(
      `[cron] @Every("${interval}") is out of range. ` +
      `The "${unit}" unit accepts 1-${max}; for longer intervals use a cron expression.`,
    )
  }

  switch (unit) {
    case 's': return `*/${n} * * * * *`
    case 'm': return `0 */${n} * * * *`
    case 'h': return `0 0 */${n} * * *`
    default: return interval
  }
}

// Validate a cron expression has a plausible shape (5 or 6 non-empty fields)
// before it reaches the scheduler, so typos fail at decoration time with the
// offending pattern named rather than silently never running.
function assertValidCron(pattern: string, label: string): void {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new Error(`[cron] ${label} requires a non-empty cron pattern.`)
  }
  const fields = pattern.trim().split(/\s+/)
  if (fields.length < 5 || fields.length > 6) {
    throw new Error(
      `[cron] ${label} got an invalid cron pattern "${pattern}" ` +
      `(expected 5 or 6 fields, got ${fields.length}).`,
    )
  }
}

/**
 * Class decorator that collects schedule metadata from methods decorated with @Schedule or @Every.
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @CronJob()
 * class CleanupJob {
 *   @Every('1h')
 *   async cleanExpiredTokens() { ... }
 * }
 * ```
 */
export function CronJob(): ClassDecorator {
  return (target: any) => {
    const schedules: ScheduleMetadata[] = []
    const seen = new Set<string>()

    // Walk the prototype chain so scheduled methods inherited from a base
    // class are collected too. Read each method via its descriptor to avoid
    // triggering prototype accessors (getters) as a side effect.
    let proto = target.prototype
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || seen.has(name)) continue
        const descriptor = Object.getOwnPropertyDescriptor(proto, name)
        if (!descriptor || typeof descriptor.value !== 'function') continue
        seen.add(name)
        const method = descriptor.value
        if (method.__cronSchedule) {
          schedules.push({
            name: method.__cronName || `${target.name}.${name}`,
            pattern: method.__cronSchedule,
            method: name,
          })
        }
      }
      proto = Object.getPrototypeOf(proto)
    }

    target.__schedules = schedules
    return target
  }
}

/**
 * Method decorator that registers a method to run on a cron schedule.
 * @param {string} pattern - A cron expression (e.g. '0 0 * * *' for daily at midnight)
 * @param {string} [name] - Optional name for the scheduled job
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Schedule('0 0 * * *', 'daily-cleanup')
 * async cleanup() { ... }
 * ```
 */
export function Schedule(pattern: string, name?: string) {
  assertValidCron(pattern, name ? `@Schedule("...", "${name}")` : '@Schedule')
  return (target: any, context?: any) => {
    if (context && typeof context === 'object' && 'kind' in context) {
      // TC39 method decorator
      target.__cronSchedule = pattern
      if (name) target.__cronName = name
      return target
    }
    // Legacy decorator
    const methodName = context as string
    target[methodName].__cronSchedule = pattern
    if (name) target[methodName].__cronName = name
  }
}

/**
 * Method decorator that registers a method to run at a fixed interval.
 * Shorthand for @Schedule with human-readable intervals.
 * @param {string} interval - Interval string (e.g. '30s', '5m', '1h') or a cron expression
 * @param {string} [name] - Optional name for the scheduled job
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Every('5m')
 * async syncData() { ... }
 * ```
 */
export function Every(interval: string, name?: string) {
  const pattern = parseEvery(interval)
  return Schedule(pattern, name)
}
