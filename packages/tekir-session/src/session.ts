import type { SessionStore } from './types'


/**
 * Server-side session backed by a pluggable store (memory, Redis, database).
 * Supports key-value data, flash messages, and session ID regeneration.
 */
// Keys that could pollute Object.prototype if written into a plain object.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function safeRecord(value: unknown): Record<string, unknown> {
  const output = Object.create(null) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  for (const [key, entry] of Object.entries(value)) {
    if (!RESERVED_KEYS.has(key)) output[key] = entry
  }
  return output
}

export class Session {
  private _data: Record<string, unknown> = {}
  private _flash: Record<string, unknown> = {}
  private _dirty = false

  constructor(
    public readonly id: string,
    private _store: SessionStore,
    private _ttl: number,
    data?: Record<string, unknown>
  ) {
    if (data) {
      // Treat persisted data as untrusted input: malformed/custom stores must
      // not inject inherited or prototype-mutating keys into session bags.
      this._data = safeRecord(data.data)
      this._flash = safeRecord(data.flash)
    }
  }

  /**
   * Retrieves a value from the session by key.
   *
   * @param key - The session key to look up.
   * @param defaultValue - Value returned when the key does not exist.
   * @returns The stored value, or `defaultValue` if the key is missing.
   * @example
   * const userId = session.get<number>('user_id', 0)
   */
  get<T = any>(key: string, defaultValue?: T): T {
    return (Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : defaultValue) as T
  }

  /**
   * Stores a value in the session under the given key.
   *
   * @param key - The session key.
   * @param value - The value to store.
   * @example
   * session.put('locale', 'en')
   */
  put(key: string, value: unknown): void {
    if (RESERVED_KEYS.has(key)) throw new Error(`Reserved session key: "${key}"`)
    this._data[key] = value; this._dirty = true
  }
  /**
   * Checks whether the session contains the given key.
   *
   * @param key - The session key to check.
   * @returns `true` if the key exists in the session data.
   * @example
   * if (session.has('user_id')) { ... }
   */
  has(key: string): boolean { return Object.prototype.hasOwnProperty.call(this._data, key) }
  all(): Record<string, unknown> { return { ...this._data } }
  /**
   * Retrieves a value and removes it from the session in one operation.
   *
   * @param key - The session key.
   * @param defaultValue - Value returned when the key does not exist.
   * @returns The stored value before removal.
   * @example
   * const message = session.pull<string>('flash_msg')
   */
  pull<T = unknown>(key: string, defaultValue?: T): T {
    const val = this.get<T>(key, defaultValue); this.forget(key); return val
  }
  /**
   * Removes a single key from the session.
   *
   * @param key - The session key to remove.
   * @example
   * session.forget('user_id')
   */
  forget(key: string): void { delete this._data[key]; this._dirty = true }
  /**
   * Removes all data from the session, keeping the session ID intact.
   *
   * @example
   * session.clear()
   */
  clear(): void { this._data = {}; this._dirty = true }
  /**
   * Increments a numeric session value by the given amount (default 1).
   *
   * @param key - The session key holding a numeric value.
   * @param by - The amount to add. Defaults to `1`.
   * @returns The new value after incrementing.
   * @example
   * session.increment('page_views') // 1, 2, 3, ...
   */
  increment(key: string, by = 1): number { const v = (this.get<number>(key, 0)) + by; this.put(key, v); return v }
  /**
   * Decrements a numeric session value by the given amount (default 1).
   *
   * @param key - The session key holding a numeric value.
   * @param by - The amount to subtract. Defaults to `1`.
   * @returns The new value after decrementing.
   * @example
   * session.decrement('credits')
   */
  decrement(key: string, by = 1): number { return this.increment(key, -by) }

  /**
   * Stores a flash message that persists for exactly one read (then is deleted).
   *
   * @param key - The flash key.
   * @param value - The flash value.
   * @example
   * session.flash('success', 'Profile updated!')
   */
  flash(key: string, value: unknown): void {
    if (RESERVED_KEYS.has(key)) throw new Error(`Reserved session key: "${key}"`)
    this._flash[key] = value; this._dirty = true
  }
  flashAll(): Record<string, unknown> { return { ...this._flash } }
  /**
   * Reads and removes a flash message in one operation.
   *
   * @param key - The flash key to read.
   * @param defaultValue - Value returned when the key does not exist.
   * @returns The flash value, or `defaultValue` if missing.
   * @example
   * const msg = session.getFlash<string>('success')
   */
  getFlash<T = unknown>(key: string, defaultValue?: T): T {
    const val = (this._flash[key] ?? defaultValue) as T
    delete this._flash[key]
    this._dirty = true
    return val
  }
  hasFlash(key: string): boolean { return Object.prototype.hasOwnProperty.call(this._flash, key) }
  reflash(): void { /* keep flash for next request - no-op, just don't clear */ }

  /**
   * Destroys the current session in the store and assigns a new random UUID as the session ID.
   * Use after login to prevent session fixation attacks.
   *
   * @returns The newly generated session ID.
   * @example
   * const newId = await session.regenerate()
   */
  async regenerate(): Promise<string> {
    await this._store.destroy(this.id)
    const newId = crypto.randomUUID()
    ;(this as unknown as { id: string }).id = newId
    this._dirty = true
    return newId
  }

  /**
   * Persists the session data and flash messages to the backing store.
   * No-ops if no changes have been made since the last save.
   *
   * @example
   * await session.save()
   */
  async save(): Promise<boolean> {
    if (!this._dirty) return false
    await this._store.write(this.id, { data: this._data, flash: this._flash }, this._ttl)
    this._dirty = false
    return true
  }

  async destroy(): Promise<void> {
    await this._store.destroy(this.id)
    this._data = {}
    this._flash = {}
  }
}
