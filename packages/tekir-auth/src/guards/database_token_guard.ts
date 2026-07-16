import { timingSafeEqual } from 'node:crypto'
import { UnauthorizedException } from '@tekir/core'
import type { AuthGuard, AuthUser, DatabaseTokenGuardConfig } from '../types'
import { resolveAuthSubject } from '../resolve_auth'

// Minimum APP_KEY entropy, mirroring @tekir/encryption so the keyed HMAC
// pepper can't be a trivially guessable string.
const MIN_APP_KEY_LENGTH = 16 // bytes

/**
 * Auth guard that stores and validates opaque API tokens in a database table.
 * Tokens are stored as a keyed HMAC-SHA256 (peppered with APP_KEY), never in a
 * reversible form. A database leak alone cannot be used to forge or replay
 * tokens without the APP_KEY. Supports generation, revocation, listing, and expiry.
 *
 * @example
 * ```ts
 * const guard = new DatabaseTokenGuard({
 *   db,
 *   table: 'auth_tokens',
 *   prefix: 'oat_',
 *   expiresIn: 86400, // 1 day
 *   resolve: (id) => User.find(id),
 * })
 *
 * const { token } = await guard.generate(user, { name: 'mobile-app' })
 * // token: "oat_a1b2c3d4..." — send to client
 *
 * const user = await guard.authenticate(ctx) // validates Bearer token
 * await guard.revoke(tokenId)                // revoke specific token
 * await guard.revokeAll(userId)              // revoke all user tokens
 * ```
 */
export class DatabaseTokenGuard<T extends AuthUser = AuthUser> implements AuthGuard<T> {
  name = 'database_token'
  private config: Required<Pick<DatabaseTokenGuardConfig, 'db'>> & DatabaseTokenGuardConfig & {
    resolve: (id: string | number) => Promise<AuthUser | null>
  }
  private readonly appKey: string
  private _tableReady = false

  constructor(config: DatabaseTokenGuardConfig) {
    const table = config.table || 'auth_tokens'
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`Invalid table name: "${table}"`)
    this.appKey = this._resolveAppKey(config.appKey)
    this.config = {
      prefix: 'oat_',
      headerName: 'authorization',
      table,
      ...config,
      resolve: resolveAuthSubject('DatabaseTokenGuard', config),
    }
  }

  // Resolve the server-side pepper used to key the token HMAC. Falls back to
  // process.env.APP_KEY like @tekir/encryption, and rejects a missing/weak key
  // so stored tokens are never peppered with a guessable value.
  private _resolveAppKey(appKey?: string): string {
    const resolved = appKey ?? process?.env?.APP_KEY ?? ''
    if (!resolved) {
      throw new Error(
        '[@tekir/auth] DatabaseTokenGuard requires APP_KEY to key the token HMAC. ' +
          'Set APP_KEY in the environment or pass `appKey` to the guard config.',
      )
    }
    const keyBytes = new TextEncoder().encode(resolved).length
    if (keyBytes < MIN_APP_KEY_LENGTH) {
      throw new Error(
        `[@tekir/auth] APP_KEY is too short (${keyBytes} bytes); at least ${MIN_APP_KEY_LENGTH} bytes are required.`,
      )
    }
    return resolved
  }

  private async _ensureTable() {
    if (this._tableReady) return
    try {
      await this.config.db.exec(`CREATE TABLE IF NOT EXISTS "${this.config.table}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT DEFAULT '',
        hash TEXT NOT NULL UNIQUE,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      )`)
      this._tableReady = true
    } catch (err) {
      // Surface schema/setup failures instead of silently swallowing them;
      // a hidden CREATE failure makes every later query fail mysteriously and
      // could make callers mistake an infrastructure outage for bad credentials.
      throw new Error(
        `[DatabaseTokenGuard] failed to ensure table "${this.config.table}"`,
        { cause: err },
      )
    }
  }

  /**
   * Extracts a Bearer token from the request, HMACs it with the APP_KEY, and
   * looks it up in the database. The stored value is confirmed with a
   * constant-time comparison. Updates `last_used_at` on success and attaches token metadata to the user.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns The authenticated user with `currentAccessToken` attached.
   * @example
   * const user = await guard.authenticate(ctx)
   * console.log(user.currentAccessToken.name)
   */
  async authenticate(ctx: any): Promise<T> {
    await this._ensureTable()
    const header = ctx.request?.header?.(this.config.headerName as string) || ctx.headers?.[this.config.headerName as string] || ''
    const raw = header.startsWith('Bearer ') ? header.slice(7) : header
    if (!raw) throw new UnauthorizedException('Missing token')

    const value = raw.startsWith(this.config.prefix as string) ? raw.slice((this.config.prefix as string).length) : raw
    const hash = await this._hash(value)

    // Lookup by the keyed HMAC keeps the query indexed/fast. The final equality
    // is re-checked in constant time below so the auth decision never depends on
    // a short-circuiting string/index compare.
    const row = await this.config.db.queryOne(
      `SELECT * FROM "${this.config.table}" WHERE hash = ?`, [hash]
    )

    if (!row || !this._constantTimeEqual(hash, String(row.hash))) {
      throw new UnauthorizedException('Invalid token')
    }

    if (row.expires_at) {
      const expiresAt = new Date(row.expires_at)
      // A malformed `expires_at` parses to Invalid Date, whose comparison is
      // always false — that would make the token effectively immortal. Treat
      // an unparseable expiry as a reason to reject, not to trust.
      if (isNaN(expiresAt.getTime())) {
        throw new UnauthorizedException('Invalid token')
      }
      if (expiresAt < new Date()) {
        throw new UnauthorizedException('Token expired')
      }
    }

    await this.config.db.run(
      `UPDATE "${this.config.table}" SET last_used_at = ? WHERE id = ?`,
      [new Date().toISOString(), row.id]
    )

    const user = await this.config.resolve(row.user_id)
    if (!user) throw new UnauthorizedException('User not found')

    ;(user as any).currentAccessToken = {
      id: row.id,
      name: row.name,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }

    return user as T
  }

  /**
   * Generates a new opaque API token for the user, stores its keyed HMAC, and
   * returns the plaintext token once. The plaintext is never persisted.
   *
   * @param user - The user to generate the token for.
   * @param options - Optional token name, metadata, and custom expiry in seconds.
   * @returns The plaintext prefixed `token` and its database `id`.
   * @example
   * const { token, id } = await guard.generate(user, { name: 'cli' })
   */
  async generate(user: T, options?: {
    name?: string
    metadata?: Record<string, any>
    expiresIn?: number
  }): Promise<{ token: string; id: number }> {
    await this._ensureTable()
    const value = this._randomToken()
    const hash = await this._hash(value)
    const now = new Date().toISOString()
    const expiresAt = options?.expiresIn
      ? new Date(Date.now() + options.expiresIn * 1000).toISOString()
      : this.config.expiresIn
        ? new Date(Date.now() + this.config.expiresIn * 1000).toISOString()
        : null

    await this.config.db.run(
      `INSERT INTO "${this.config.table}" (user_id, name, hash, metadata, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [String(user.id), options?.name || '', hash, JSON.stringify(options?.metadata || {}), now, expiresAt]
    )

    // Get last inserted id
    const last = await this.config.db.queryOne(`SELECT last_insert_rowid() as id`)
    const token = `${this.config.prefix}${value}`
    return { token, id: last?.id ?? 0 }
  }

  /**
   * Revokes (deletes) a single token by its database ID.
   *
   * @param tokenId - The primary key of the token row to delete.
   * @example
   * await guard.revoke(42)
   */
  async revoke(tokenId: number): Promise<void> {
    await this.config.db.run(`DELETE FROM "${this.config.table}" WHERE id = ?`, [tokenId])
  }

  /**
   * Revokes (deletes) all tokens belonging to the specified user.
   *
   * @param userId - The user whose tokens should be revoked.
   * @example
   * await guard.revokeAll(user.id)
   */
  async revokeAll(userId: string | number): Promise<void> {
    await this.config.db.run(`DELETE FROM "${this.config.table}" WHERE user_id = ?`, [String(userId)])
  }

  /**
   * Lists all active tokens for a user, ordered by creation date (newest first).
   *
   * @param userId - The user whose tokens to list.
   * @returns An array of token metadata objects (id, name, metadata, dates).
   * @example
   * const tokens = await guard.list(user.id)
   */
  async list(userId: string | number): Promise<any[]> {
    const rows = await this.config.db.query(
      `SELECT id, name, metadata, created_at, expires_at, last_used_at FROM "${this.config.table}" WHERE user_id = ? ORDER BY created_at DESC`,
      [String(userId)]
    )
    return rows.map((row: any) => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }))
  }

  /**
   * Checks whether the request contains a valid database token without throwing.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns `true` if the token is valid, `false` otherwise.
   */
  async check(ctx: any): Promise<boolean> {
    try { await this.authenticate(ctx); return true } catch { return false }
  }

  // `length` is the number of random bytes; the hex string is length*2 chars.
  // 40 bytes = 320 bits of entropy, well above the >=256-bit target.
  private _randomToken(length = 40): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Keyed HMAC-SHA256 of the token using the APP_KEY as the secret. Storing the
  // HMAC (not a plain hash) means a leaked DB column is plaintext-inequivalent:
  // forging a matching value offline requires the APP_KEY.
  private async _hash(value: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.appKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Constant-time equality for the two hex HMAC strings so the final auth
  // decision can't leak timing. Unequal lengths short-circuit (false) since
  // timingSafeEqual throws on mismatched buffer sizes.
  private _constantTimeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  }
}
