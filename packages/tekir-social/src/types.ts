/** Normalized user profile returned by all OAuth providers. */
export interface SocialUser {
  /** Provider-specific user ID. */
  id: string
  /** User's email address, or `null` if unavailable. */
  email: string | null
  /** User's full display name, or `null` if unavailable. */
  name: string | null
  /** User's first name, or `null` if unavailable. */
  firstName: string | null
  /** User's last name, or `null` if unavailable. */
  lastName: string | null
  /** URL to the user's avatar image, or `null` if unavailable. */
  avatar: string | null
  /** The provider name that returned this user (e.g. `'google'`). */
  provider: string
  /**
   * OAuth access token for making authenticated API calls.
   * Non-enumerable: excluded from `JSON.stringify` and most logging so it is
   * not accidentally leaked in response bodies, logs, or client storage.
   * Still readable via direct property access.
   */
  accessToken: string
  /**
   * OAuth refresh token, or `null` if not provided.
   * Non-enumerable (see {@link SocialUser.accessToken}).
   */
  refreshToken: string | null
  /**
   * Raw response data from the provider's user info endpoint.
   * Non-enumerable (see {@link SocialUser.accessToken}); may carry additional
   * sensitive fields, so it is hidden from default serialization.
   */
  raw: Record<string, unknown>
}

/**
 * Redefine the token/raw fields of a {@link SocialUser} as non-enumerable so
 * they don't surface in `JSON.stringify`, `console.log` of plain objects, or
 * structured-clone/spread-to-response paths. Property access still works.
 */
export function hideSensitiveFields(user: SocialUser): SocialUser {
  for (const key of ['accessToken', 'refreshToken', 'raw'] as const) {
    const value = user[key]
    Object.defineProperty(user, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: true,
    })
  }
  return user
}

/** OAuth provider credentials and settings. */
export interface ProviderConfig {
  /** OAuth client ID. */
  clientId: string
  /** OAuth client secret. */
  clientSecret: string
  /** OAuth redirect URI (must match the value registered with the provider). */
  redirectUri: string
  /** OAuth scopes to request. Provider defaults are used if omitted. */
  scopes?: string[]
}

/**
 * Interface that all social OAuth providers must implement.
 */
export interface SocialProvider {
  /** Provider name (e.g. `'google'`, `'github'`). */
  name: string
  /**
   * Build the OAuth authorization URL.
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @param codeChallenge - Optional PKCE S256 code challenge.
   * @returns The full authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string, nonce?: string): string
  /**
   * Exchange an authorization code for access and refresh tokens.
   * @param code - The authorization code from the callback.
   * @param codeVerifier - Optional PKCE code verifier matching the challenge.
   * @returns An object containing `accessToken` and optionally `refreshToken`.
   */
  exchangeCode(code: string, codeVerifier?: string): Promise<{ accessToken: string; refreshToken?: string; idToken?: string }>
  /**
   * Fetch the authenticated user's profile from the provider.
   * @param accessToken - The OAuth access token.
   * @param context - Optional verification context (e.g. Apple id_token, nonce).
   * @returns A normalized {@link SocialUser} object.
   */
  getUser(accessToken: string, context?: { idToken?: string; nonce?: string }): Promise<SocialUser>
}

/** Configuration for the {@link Social} authentication manager. */
export interface SocialConfig {
  /** Map of provider names to their OAuth credentials. */
  providers: Record<string, ProviderConfig>
  /** State token expiry in ms (default: 600000 = 10 min). */
  stateMaxAge?: number
  /** Allowed redirect URL patterns (prevents open redirect). */
  allowedRedirects?: string[]
}
