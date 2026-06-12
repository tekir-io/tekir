export type { SessionStore, SessionConfig } from './types'
export { MemorySessionStore } from './stores/memory'
export { RedisSessionStore } from './stores/redis'
export { DatabaseSessionStore } from './stores/database'
export { Session } from './session'
export { session, createSession } from './middleware'
export { SessionProvider } from './provider'

declare module '@tekir/core' {
  interface HttpContext {
    session: {
      get<T = any>(key: string): T | undefined
      put(key: string, value: unknown): void
      has(key: string): boolean
      all(): Record<string, unknown>
      pull<T = unknown>(key: string): T | undefined
      forget(key: string): void
      clear(): void
      flash(key: string, value: unknown): void
      getFlash<T = unknown>(key: string): T | undefined
      save(): Promise<void>
      destroy(): Promise<void>
      regenerate(): Promise<void>
    }
  }
}
