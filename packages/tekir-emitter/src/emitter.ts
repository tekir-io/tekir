import { captureCallerFile, loadDirEntries, type LoadDirOptions } from '@tekir/core'
import type { Handler } from './types'
import type { FakeEmitter } from './fake'

export type { Handler } from './types'

/**
 * Type-safe event emitter with support for async handlers, wildcard listeners,
 * one-shot events, async iterables, and decorator-based listener registration.
 *
 * @typeParam Events - A record mapping event names to their payload types.
 *
 * @example
 * ```ts
 * type MyEvents = { 'user:created': { id: string }; 'user:deleted': { id: string } }
 * const emitter = new Emitter<MyEvents>()
 * emitter.on('user:created', (data) => console.log(data.id))
 * await emitter.emit('user:created', { id: '123' })
 * ```
 */
export class Emitter<Events extends Record<string, unknown> = Record<string, unknown>> {
  private _on = new Map<string, Handler[]>()
  private _once = new Map<string, Handler[]>()
  private _any: Array<(event: string, data: unknown) => void | Promise<void>> = []
  private _error?: (event: string, error: Error) => void
  /**
   * Listener-count threshold per event above which a possible-leak warning is
   * emitted (once per event), mirroring Node's EventEmitter. `0` disables it.
   */
  private _maxListeners = 100
  private _leakWarned = new Set<string>()

  /** Route a handler error to the user's onError, or log it by default. */
  private _handleError(event: string, e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e))
    if (this._error) {
      try { this._error(event, err) } catch { /* a throwing error handler must not break dispatch */ }
    } else {
      console.error(`[emitter] Unhandled error in listener for "${event}":`, err)
    }
  }

  /** Warn once per event when its listener count crosses the configured cap. */
  private _checkLeak(event: string): void {
    if (this._maxListeners <= 0 || this._leakWarned.has(event)) return
    const count = (this._on.get(event)?.length || 0) + (this._once.get(event)?.length || 0)
    if (count > this._maxListeners) {
      this._leakWarned.add(event)
      console.warn(
        `[emitter] Possible memory leak: ${count} listeners added for "${event}" ` +
        `(limit ${this._maxListeners}). Use setMaxListeners(n) to adjust or 0 to disable.`,
      )
    }
  }

  /**
   * Set the per-event listener-count threshold for the possible-leak warning.
   * Pass `0` to disable the warning entirely.
   */
  setMaxListeners(n: number): void {
    this._maxListeners = n
    this._leakWarned.clear()
  }

  /**
   * Register a persistent event handler. The handler is called every time the event fires.
   *
   * @param event - The event name to listen for.
   * @param handler - The callback invoked with the event payload.
   * @returns An unsubscribe function that removes this handler when called.
   *
   * @example
   * ```ts
   * const off = emitter.on('user:created', (data) => console.log(data))
   * off() // unsubscribe
   * ```
   */
  on<K extends keyof Events & string>(event: K, handler: Handler<Events[K]>): () => void {
    const h = handler as Handler<unknown>
    const arr = this._on.get(event)
    if (arr) arr.push(h)
    else this._on.set(event, [h])
    this._checkLeak(event)
    return () => this.off(event, handler)
  }

  /**
   * Register a one-shot event handler. The handler is called at most once and
   * then automatically removed.
   *
   * @param event - The event name to listen for.
   * @param handler - The callback invoked with the event payload.
   *
   * @example
   * ```ts
   * emitter.once('app:ready', () => console.log('App started'))
   * ```
   */
  once<K extends keyof Events & string>(event: K, handler: Handler<Events[K]>): void {
    const h = handler as Handler<unknown>
    const arr = this._once.get(event)
    if (arr) arr.push(h)
    else this._once.set(event, [h])
    this._checkLeak(event)
  }

  /**
   * Remove a specific handler from an event. Works for both persistent and
   * one-shot handlers.
   *
   * @param event - The event name.
   * @param handler - The exact handler reference to remove.
   *
   * @example
   * ```ts
   * emitter.off('user:created', myHandler)
   * ```
   */
  off<K extends keyof Events & string>(event: K, handler: Handler<Events[K]>): void {
    const h = handler as Handler<unknown>
    const on = this._on.get(event)
    if (on) { const i = on.indexOf(h); if (i !== -1) on.splice(i, 1) }
    const once = this._once.get(event)
    if (once) { const i = once.indexOf(h); if (i !== -1) once.splice(i, 1) }
  }

  /**
   * Register a wildcard handler that fires for every emitted event.
   *
   * @param handler - A callback receiving the event name and payload.
   * @returns An unsubscribe function that removes this handler when called.
   *
   * @example
   * ```ts
   * const off = emitter.onAny((event, data) => log(event, data))
   * ```
   */
  onAny(handler: (event: string, data: unknown) => void | Promise<void>): () => void {
    this._any.push(handler)
    return () => { const i = this._any.indexOf(handler); if (i !== -1) this._any.splice(i, 1) }
  }

  /**
   * Set a global error handler for exceptions thrown by event handlers.
   * Without this, handler errors are re-thrown.
   *
   * @param handler - A callback receiving the event name and the caught error.
   *
   * @example
   * ```ts
   * emitter.onError((event, err) => logger.error(`Error in ${event}:`, err))
   * ```
   */
  onError(handler: (event: string, error: Error) => void): void { this._error = handler }

  /**
   * Emit an event asynchronously, invoking all registered handlers in order.
   * One-shot handlers are removed after being called.
   *
   * @param event - The event name to emit.
   * @param data - The payload to pass to each handler.
   * @returns A promise that resolves when all handlers have completed.
   *
   * @example
   * ```ts
   * await emitter.emit('user:created', { id: '123' })
   * ```
   */
  async emit<K extends keyof Events & string>(event: K, data: Events[K]): Promise<void> {
    const on = this._on.get(event)
    const once = this._once.get(event)
    this._once.delete(event)

    if (on) for (let i = 0; i < on.length; i++) {
      try { await on[i](data) } catch (e: unknown) { this._handleError(event, e) }
    }
    if (once) for (let i = 0; i < once.length; i++) {
      try { await once[i](data) } catch (e: unknown) { this._handleError(event, e) }
    }
    for (let i = 0; i < this._any.length; i++) {
      try { await this._any[i](event, data) } catch (e: unknown) { this._handleError(event, e) }
    }
  }

  /**
   * Emit an event synchronously, invoking all registered handlers. Async handlers
   * are fire-and-forget; their errors are routed to the error handler if set.
   *
   * @param event - The event name to emit.
   * @param data - The payload to pass to each handler.
   *
   * @example
   * ```ts
   * emitter.emitSync('cache:invalidated', { key: 'users' })
   * ```
   */
  emitSync<K extends keyof Events & string>(event: K, data: Events[K]): void {
    const on = this._on.get(event)
    const once = this._once.get(event)
    this._once.delete(event)

    if (on) for (let i = 0; i < on.length; i++) {
      try { const r = on[i](data); if (r instanceof Promise) r.catch(e => this._handleError(event, e)) }
      catch (e: unknown) { this._handleError(event, e) }
    }
    if (once) for (let i = 0; i < once.length; i++) {
      try { const r = once[i](data); if (r instanceof Promise) r.catch(e => this._handleError(event, e)) }
      catch (e: unknown) { this._handleError(event, e) }
    }
    for (let i = 0; i < this._any.length; i++) {
      try { const r = this._any[i](event, data); if (r instanceof Promise) r.catch(e => this._handleError(event, e)) }
      catch (e: unknown) { this._handleError(event, e) }
    }
  }

  /**
   * Wait for a single occurrence of an event. Returns a promise that resolves
   * with the event payload. Supports abort signals and timeouts.
   *
   * @param event - The event name to wait for.
   * @param options - Optional abort signal and/or timeout in milliseconds.
   * @returns A promise that resolves with the event payload.
   * @throws Error if aborted or timed out.
   *
   * @example
   * ```ts
   * const data = await emitter.wait('db:ready', { timeout: 5000 })
   * ```
   */
  wait<K extends keyof Events & string>(event: K, options?: { signal?: AbortSignal; timeout?: number }): Promise<Events[K]> {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) return reject(new Error('Aborted'))
      let timer: ReturnType<typeof setTimeout> | undefined
      // Named handler so it can be removed on timeout/abort — otherwise the
      // once-listener lingers in the _once map and resolves a dead promise (and
      // accumulates) when the event eventually fires.
      const handler = ((data: Events[K]) => { cleanup(); resolve(data) }) as Handler<Events[K]>
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.off(event, handler as Handler<Events[K]>)
      }
      this.once(event, handler)
      if (options?.signal) options.signal.addEventListener('abort', () => { cleanup(); reject(new Error('Aborted')) }, { once: true })
      if (options?.timeout) timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout waiting for "${event}"`)) }, options.timeout)
    })
  }

  /**
   * Create an async iterable that yields every occurrence of an event.
   * The iterable completes when the optional abort signal fires.
   *
   * @param event - The event name to iterate over.
   * @param options - Optional abort signal to terminate the iterable and an
   *   optional `maxBufferSize` (default 1024) bounding how many unconsumed
   *   events are held. When the buffer is full the oldest event is dropped so a
   *   fast producer with a slow/absent consumer can't grow memory without bound.
   * @returns An async iterable of event payloads.
   *
   * @example
   * ```ts
   * for await (const msg of emitter.events('message', { signal: controller.signal })) {
   *   console.log(msg)
   * }
   * ```
   */
  events<K extends keyof Events & string>(event: K, options?: { signal?: AbortSignal; maxBufferSize?: number }): AsyncIterable<Events[K]> {
    const queue: Array<{ resolve: (v: IteratorResult<Events[K]>) => void }> = []
    const buffer: Events[K][] = []
    const maxBufferSize = options?.maxBufferSize ?? 1024
    let done = false
    const handler = (data: Events[K]) => {
      if (queue.length > 0) (queue.shift() as { resolve: (v: IteratorResult<Events[K]>) => void }).resolve({ value: data, done: false })
      else {
        buffer.push(data)
        // Bounded buffer: drop the oldest unconsumed event once the cap is hit.
        if (buffer.length > maxBufferSize) buffer.shift()
      }
    }
    const finish = () => {
      if (done) return
      done = true
      this.off(event, handler)
      buffer.length = 0
      for (const q of queue) q.resolve({ value: undefined as unknown as Events[K], done: true })
      queue.length = 0
    }
    this.on(event, handler)
    if (options?.signal) options.signal.addEventListener('abort', finish, { once: true })
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => buffer.length > 0 ? Promise.resolve({ value: buffer.shift() as Events[K], done: false }) : done ? Promise.resolve({ value: undefined as unknown as Events[K], done: true }) : new Promise(resolve => queue.push({ resolve })),
          // Breaking out of `for await` (or calling return early) must remove
          // the listener so the emitter stops feeding a dead buffer.
          return: () => { finish(); return Promise.resolve({ value: undefined as unknown as Events[K], done: true }) },
        }
      },
    }
  }

  /**
   * Get the number of registered listeners. If an event name is provided, returns
   * the count for that event only; otherwise returns the total across all events.
   *
   * @param event - Optional event name to count listeners for.
   * @returns The number of registered listeners.
   *
   * @example
   * ```ts
   * emitter.listenerCount('user:created') // 2
   * emitter.listenerCount() // 10
   * ```
   */
  listenerCount(event?: string): number {
    if (event) return (this._on.get(event)?.length || 0) + (this._once.get(event)?.length || 0)
    let t = 0; for (const [, a] of this._on) t += a.length; for (const [, a] of this._once) t += a.length; return t + this._any.length
  }

  /**
   * Remove all listeners. If an event name is provided, only that event's
   * listeners are cleared; otherwise all listeners (including wildcard) are removed.
   *
   * @param event - Optional event name to clear listeners for.
   *
   * @example
   * ```ts
   * emitter.clearListeners('user:created')
   * emitter.clearListeners() // remove everything
   * ```
   */
  clearListeners(event?: string): void {
    if (event) { this._on.delete(event); this._once.delete(event) }
    else { this._on.clear(); this._once.clear(); this._any.length = 0 }
  }

  /**
   * Get an array of all event names that have at least one registered listener.
   *
   * @returns An array of unique event name strings.
   */
  get eventNames(): string[] { return [...new Set([...this._on.keys(), ...this._once.keys()])] }

  /**
   * Register one or more decorator-based listener classes. Each class should
   * have a static `__listeners` array populated by listener decorators.
   *
   * @param classes - Listener classes or instances to register.
   *
   * @example
   * ```ts
   * emitter.register(UserEventListener, OrderEventListener)
   * ```
   */
  register(...classes: any[]): void {
    for (const ListenerClass of classes) {
      const instance = typeof ListenerClass === 'function' ? new ListenerClass() : ListenerClass
      const listeners: { event: string; method: string; once: boolean }[] = ListenerClass.__listeners || Object.getPrototypeOf(instance).constructor.__listeners || []

      for (const listener of listeners) {
        const handler = (data: any) => instance[listener.method](data)
        if (listener.once) {
          this.once(listener.event as any, handler)
        } else {
          this.on(listener.event as any, handler)
        }
      }
    }
  }

  /**
   * Load every file in a directory and register whatever each module
   * exports as an event listener. Auto-detects three common shapes:
   *
   * 1. **Decorator class** with `__listeners` (the `@On('event')` pattern):
   *    passed straight to {@link Emitter.register}.
   * 2. **Functional registrar** (`export default (emitter) => { ... }`):
   *    the function is invoked with this emitter so it can call
   *    `emitter.on(...)` directly.
   * 3. **Class with a `register(emitter)` method**: a fresh instance is
   *    constructed and its `register` method is invoked.
   *
   * Files whose default export does not match any pattern are skipped
   * with a `console.warn` so misconfigured exports surface during boot.
   *
   * @example
   * ```ts
   * await emitter.registerDir('app/listeners')
   * ```
   *
   * @param dir Directory. Absolute paths are used as-is. Relative paths
   *   default to the caller's own directory (file-relative, captured via
   *   stack inspection so `await emitter.registerDir('./listeners')`
   *   from `api/index.ts` resolves to `api/listeners` regardless of
   *   cwd). Pass `options.from = import.meta.url` to set the base
   *   explicitly, or `options.from = process.cwd()` to keep the
   *   pre-0.1.3 cwd-relative behavior.
   * @param options Forwarded to `loadDir`. See `LoadDirOptions`.
   *
   * Note: dynamic imports are not statically traced by
   * `bun build --compile`. For single-executable builds keep an explicit
   * `import` list and pass it to {@link Emitter.register}.
   */
  async registerDir(
    dir: string,
    options?: LoadDirOptions,
  ): Promise<void> {
    // Capture the caller SYNCHRONOUSLY before any `await` runs — once
    // this function suspends at an await, the user's call frame is gone
    // and the resumed stack only contains JS engine internals. Static
    // top-level imports for `captureCallerFile`/`loadDirEntries` keep
    // this initial line synchronous.
    const from = options?.from ?? captureCallerFile(this.registerDir)
    const entries = await loadDirEntries<any>(dir, { ...options, from })
    if (entries.length === 0) {
      console.warn(
        `[emitter.registerDir] No modules loaded from "${dir}" (resolved against ${from ?? 'cwd: ' + process.cwd()}). ` +
        `If this is a production bundle outside of \`bun build --compile\`, the AST inliner that ` +
        `replaces literal-string \`registerDir\` calls did not run. Add the plugin to your build: ` +
        `\`Bun.build({ plugins: [await (await import('@tekir/core')).createInlinerPlugin()] })\`, ` +
        `or use \`bun build --compile\` so the tekir CLI auto-injects it.`,
      )
    }
    for (const { file, picked: mod } of entries) {
      if (mod && (mod.__listeners !== undefined || (typeof mod === 'function' && mod.prototype && Object.getPrototypeOf(mod.prototype)?.constructor?.__listeners))) {
        this.register(mod)
        continue
      }
      if (typeof mod === 'function' && (!mod.prototype || Object.getOwnPropertyNames(mod.prototype).length === 1)) {
        await mod(this)
        continue
      }
      if (typeof mod === 'function' && typeof mod.prototype?.register === 'function') {
        const instance = new mod()
        await instance.register(this)
        continue
      }
      if (mod && typeof mod === 'object' && typeof (mod as any).register === 'function') {
        await (mod as any).register(this)
        continue
      }
      const name = mod?.constructor?.name || (typeof mod === 'function' ? mod.name : typeof mod)
      console.warn(`[emitter.registerDir] ${file}: skipped (unrecognized export shape: ${name || '<unknown>'})`)
    }
  }

  /**
   * Create a {@link FakeEmitter} for testing. The fake emitter records all
   * emitted events instead of dispatching them to real handlers.
   *
   * @typeParam E - The event map type.
   * @returns A new FakeEmitter instance.
   *
   * @example
   * ```ts
   * const fake = Emitter.fake<MyEvents>()
   * await fake.emit('user:created', { id: '1' })
   * fake.assertEmitted('user:created') // true
   * ```
   */
  static fake<E extends Record<string, unknown> = Record<string, unknown>>() {

    const { FakeEmitter } = require('./fake')
    return new FakeEmitter() as FakeEmitter<E>
  }
}

/**
 * Create a new type-safe {@link Emitter} instance.
 *
 * @typeParam Events - A record mapping event names to their payload types.
 * @returns A new Emitter instance.
 *
 * @example
 * ```ts
 * const emitter = createEmitter<{ ping: { ts: number } }>()
 * ```
 */
export function createEmitter<Events extends Record<string, unknown> = Record<string, unknown>>(): Emitter<Events> {
  return new Emitter<Events>()
}
