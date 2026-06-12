import type { HttpContext } from '@tekir/core'

export interface LimiterResult {
  allowed: boolean
  limit: number
  remaining: number
  resetTime: number
}

export interface LimiterStore {
  check(key: string, max: number, windowMs: number): Promise<LimiterResult>
  reset(key: string): Promise<void>
  clear(): Promise<void>
  /**
   * Atomic non-consuming view of a key's state, used to gate `penalize`
   * without burning a slot. Returns `null` when no live window exists.
   *
   * Optional: stores that do not implement it fall back to {@link get}.
   */
  peek?(key: string): Promise<LimiterResult | null>
  /**
   * Atomically consume a slot and, in the same operation, apply the extended
   * lockout when the limit is exceeded. Folding the check, increment and block
   * into one store round-trip removes the check-then-increment and
   * check-then-block races that let concurrent callers slip past the limit.
   *
   * Optional: stores that do not implement it fall back to a best-effort
   * {@link LimiterStore.check} followed by `block`, preserving today's behaviour
   * for custom stores.
   */
  consume?(key: string, max: number, windowMs: number, amount: number, blockMs: number): Promise<LimiterResult>
}

export interface LimiterOptions {
  max: number
  window: number // seconds
  by?: 'ip' | 'user' | ((ctx: HttpContext) => string)
  keyPrefix?: string
  store?: LimiterStore
  blockFor?: number // seconds — extended lockout when limit exceeded
  /**
   * Whether to trust the `X-Forwarded-For` header for client IP resolution.
   * Defaults to `false`: the header is spoofable, so when the app is not
   * behind a proxy the socket IP is used instead. Enable only when running
   * behind a trusted reverse proxy that sets/overwrites the header.
   *
   * - `false` (default): ignore `X-Forwarded-For`, use the socket IP.
   * - `true`: trust the left-most `X-Forwarded-For` entry (single trusted proxy).
   * - `number`: number of trusted proxies; selects the IP that many hops from
   *   the right of the `X-Forwarded-For` list (the entry the outermost trusted
   *   proxy received from the next hop).
   */
  trustProxy?: boolean | number
  limitExceeded?: (error: { status: number; message: string; retryAfter: number; setStatus: (s: number) => void; setMessage: (m: string) => void }) => void
}
