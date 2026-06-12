import type { ListenerMetadata, EventBinding } from './types'

function assertValidEvent(event: string, label: string): void {
  if (typeof event !== 'string' || event.trim() === '') {
    throw new Error(`[event] ${label} requires a non-empty event name.`)
  }
}

// Stamp an event binding onto a method function. A method can carry several
// bindings (e.g. two `@On('a')` `@On('b')`), so they accumulate in `__events`
// rather than the later decorator overwriting the earlier one. `__eventName` /
// `__eventOnce` are kept in sync (reflecting the first binding) for backward
// compatibility with anything reading them directly.
function addBinding(fn: any, binding: EventBinding): void {
  if (!Object.hasOwn(fn, '__events')) fn.__events = []
  fn.__events.push(binding)
  if (fn.__eventName === undefined) {
    fn.__eventName = binding.event
    fn.__eventOnce = binding.once
  }
}

function collectBindings(fn: any): EventBinding[] {
  if (Array.isArray(fn.__events) && fn.__events.length > 0) return fn.__events
  // Fallback for functions stamped by older callers that only set __eventName.
  if (fn.__eventName) return [{ event: fn.__eventName, once: fn.__eventOnce || false }]
  return []
}

/**
 * Class decorator that collects event listener metadata from decorated methods.
 * Methods decorated with @On or @Once are registered as event listeners.
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @Listener()
 * class UserListener {
 *   @On('user:created')
 *   async sendWelcomeEmail(user: User) { ... }
 * }
 * ```
 */
export function Listener(): ClassDecorator {
  return (target: any) => {
    const listeners: ListenerMetadata[] = []
    const seen = new Set<string>()

    // Walk the prototype chain so listener methods inherited from a base class
    // are collected too. Read each method via its descriptor to avoid firing
    // prototype accessors as a side effect.
    let proto = target.prototype
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || seen.has(name)) continue
        const descriptor = Object.getOwnPropertyDescriptor(proto, name)
        if (!descriptor || typeof descriptor.value !== 'function') continue
        seen.add(name)
        for (const b of collectBindings(descriptor.value)) {
          listeners.push({ event: b.event, method: name, once: b.once })
        }
      }
      proto = Object.getPrototypeOf(proto)
    }

    target.__listeners = listeners
    return target
  }
}

/**
 * Method decorator that subscribes the method to an event (persistent listener).
 * Multiple @On/@Once decorators on the same method are all registered.
 * @param {string} event - The event name to listen for
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @On('order:placed')
 * async processOrder(order: Order) { ... }
 * ```
 */
export function On(event: string) {
  assertValidEvent(event, '@On')
  return (target: any, context?: any) => {
    if (context && typeof context === 'object' && 'kind' in context) {
      addBinding(target, { event, once: false })
      return target
    }
    const methodName = context as string
    addBinding(target[methodName], { event, once: false })
  }
}

/**
 * Method decorator that subscribes the method to an event (one-time listener).
 * The listener is automatically removed after the first invocation.
 * @param {string} event - The event name to listen for once
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Once('app:ready')
 * async warmCache() { ... }
 * ```
 */
export function Once(event: string) {
  assertValidEvent(event, '@Once')
  return (target: any, context?: any) => {
    if (context && typeof context === 'object' && 'kind' in context) {
      addBinding(target, { event, once: true })
      return target
    }
    const methodName = context as string
    addBinding(target[methodName], { event, once: true })
  }
}
