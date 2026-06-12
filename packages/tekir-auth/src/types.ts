/**
 * Augmentation hook for the app's user shape. Apps declare-merge their
 * own model into this interface so handlers can rely on a typed
 * `ctx.auth.user`. The base intentionally has no fields so apps can
 * supply any id type (number from a sqlite/postgres model, string from
 * an external auth provider, etc.) without conflicting with a default.
 *
 * @example
 * declare module '@tekir/auth' {
 *   interface TekirAuthUser extends ModelFields<User> {}
 * }
 */
export interface TekirAuthUser {}

/** Authenticated user shape required by all guards. Must contain at least an `id`. */
export interface AuthUser {
  id: string | number
  [key: string]: any
}

/** Contract that all authentication guards must implement. */
export interface AuthGuard<T extends AuthUser = AuthUser> {
  name: string
  authenticate(ctx: any): Promise<T>
  // Optional methods guards can implement
  login?(user: T, ...args: any[]): Promise<any>
  logout?(ctx: any): Promise<void>
  check?(ctx: any): Promise<boolean>
  generate?(user: T, options?: any): Promise<any>
}

/** Configuration for the Auth manager, mapping guard names to factory functions. */
export interface AuthConfig {
  defaultGuard: string
  guards: Record<string, () => AuthGuard>
}

/** Runtime authentication state attached to `ctx.auth` after authentication. */
export interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  guard: string
  /** Log a user in — binds guard methods to this auth state */
  login(user: AuthUser, guardName?: string): Promise<void>
  /** Generate a token for the authenticated user (JWT/DatabaseToken guards) */
  generate(options?: any): Promise<any>
  /** Logout the current user */
  logout(): Promise<void>
  /** List tokens for the authenticated user (DatabaseToken guard) */
  list(): Promise<any[]>
  /** Revoke all tokens for the authenticated user (DatabaseToken guard) */
  revokeAll(): Promise<void>
}

/**
 * Anything with a static `find(id)` resolver — every `@tekir/db` `BaseModel`
 * subclass satisfies this out of the box. Used by guard configs to derive a
 * default `resolve` so apps don't have to write the boilerplate.
 *
 * `find`'s return is intentionally `any` so concrete model classes (whose
 * declared fields lack an index signature) still match structurally.
 */
export interface AuthModel {
   
  find: (id: string | number) => Promise<any>
}

/** Configuration for the session-based authentication guard. */
export interface SessionGuardConfig {
  sessionKey?: string
  cookieName?: string
  /** Custom resolver for the authenticated subject. Required if `model` is not set. */
  resolve?: (id: string | number) => Promise<AuthUser | null>
  /** Auto-derive `resolve` from a class with a static `find(id)`. */
  model?: AuthModel
}

/** Configuration for the JWT authentication guard. */
export interface JwtGuardConfig {
  secret: string
  expiresIn?: number // seconds, default 3600
  maxExpiresIn?: number // seconds, max allowed expiry cap (default 604800 = 7 days)
  algorithm?: string
  /** Custom resolver for the authenticated subject. Required if `model` is not set. */
  resolve?: (id: string | number) => Promise<AuthUser | null>
  /** Auto-derive `resolve` from a class with a static `find(id)`. */
  model?: AuthModel
}

/** Decoded JWT payload with standard claims and optional custom properties. */
export interface JwtPayload {
  sub: string | number
  iat: number
  exp: number
  [key: string]: any
}

/** Configuration for the database-backed opaque API token guard. */
export interface DatabaseTokenGuardConfig {
  prefix?: string // default 'oat_'
  expiresIn?: number // seconds
  headerName?: string
  table?: string // default 'auth_tokens'
  db: any // Database instance
  /** Server-side pepper for the keyed token HMAC. Falls back to `process.env.APP_KEY`. */
  appKey?: string
  /** Custom resolver for the authenticated subject. Required if `model` is not set. */
  resolve?: (id: string | number) => Promise<AuthUser | null>
  /** Auto-derive `resolve` from a class with a static `find(id)`. */
  model?: AuthModel
}

/** Shape of an access token row stored in the database. */
export interface AccessToken {
  id: number
  userId: string | number
  name: string
  hash: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
}

/** Configuration for the HTTP Basic Authentication guard. */
export interface BasicAuthGuardConfig {
  verifyCredentials: (uid: string, password: string) => Promise<AuthUser | null>
}

/** Callback that verifies an opaque token and returns the associated user or null. */
export type TokenVerifier<T extends AuthUser = AuthUser> = (token: string) => Promise<T | null>
/** Callback that verifies a username/password pair and returns the user or null. */
export type CredentialVerifier<T extends AuthUser = AuthUser> = (username: string, password: string) => Promise<T | null>
