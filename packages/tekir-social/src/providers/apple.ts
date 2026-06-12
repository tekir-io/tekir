import type { ProviderConfig, SocialProvider, SocialUser } from '../types'
import { verifyAppleIdToken } from '../apple_jwt'

const AUTH_URL = 'https://appleid.apple.com/auth/authorize'
const TOKEN_URL = 'https://appleid.apple.com/auth/token'
const DEFAULT_SCOPES = ['name', 'email']

/**
 * Apple Sign In OAuth 2.0 provider.
 *
 * Default scopes: `name`, `email`.
 * Uses `response_mode: 'form_post'` as required by Apple.
 *
 * The `id_token` JWT is verified against Apple's published JWKS (RS256) with
 * issuer/audience/expiry (and optional nonce) checks. An unverified JWT is
 * never trusted for identity.
 */
export class AppleProvider implements SocialProvider {
  name = 'apple'

  /**
   * @param config - OAuth provider credentials and redirect URI.
   */
  constructor(private config: ProviderConfig) {}

  /**
   * Build the Apple Sign In authorization URL.
   *
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @param codeChallenge - Optional PKCE S256 code challenge.
   * @returns The full Apple authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: (scopes || this.config.scopes || DEFAULT_SCOPES).join(' '),
      response_mode: 'form_post',
      state,
    })
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `${AUTH_URL}?${params}`
  }

  /**
   * Exchange an authorization code for Apple tokens.
   *
   * @param code - The authorization code from the callback.
   * @param codeVerifier - Optional PKCE code verifier.
   * @returns An object with `accessToken`, `refreshToken`, and `idToken`.
   * @throws If the token exchange request fails.
   */
  async exchangeCode(code: string, codeVerifier?: string) {
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    })
    if (codeVerifier) body.set('code_verifier', codeVerifier)
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Apple token exchange failed: ${res.status}`)
    const data = await res.json() as any
    if (data.error) throw new Error(`Apple OAuth error: ${data.error_description || data.error}`)
    // Apple's identity is carried in the id_token; without it we cannot
    // authenticate the user.
    if (!data.id_token) throw new Error('Apple token exchange returned no id_token')
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null, idToken: data.id_token }
  }

  /**
   * Build the user profile from a verified Apple `id_token` JWT.
   *
   * @param accessToken - The OAuth access token (kept for parity).
   * @param context - Must include the `idToken`; an optional `nonce` is checked.
   * @returns A normalized {@link SocialUser} object.
   * @throws If the id_token is missing or fails signature/claim verification.
   */
  async getUser(accessToken: string, context?: { idToken?: string; nonce?: string }): Promise<SocialUser> {
    // Prefer the id_token from the exchange context. Fall back to treating
    // `accessToken` as the JWT only for backward compatibility.
    const idToken = context?.idToken || accessToken
    if (!idToken || idToken.split('.').length !== 3) {
      throw new Error('Apple sign-in requires a valid id_token JWT')
    }

    // Verify signature against Apple's JWKS plus iss/aud/exp (and nonce).
    const payload = await verifyAppleIdToken(idToken, {
      audience: this.config.clientId,
      nonce: context?.nonce,
    })

    return {
      id: payload.sub || '',
      // Apple marks unverified relay/proxy emails; only trust verified ones.
      email: payload.email && payload.email_verified !== false && payload.email_verified !== 'false'
        ? payload.email
        : null,
      name: null,
      firstName: null,
      lastName: null,
      avatar: null,
      provider: 'apple',
      accessToken,
      refreshToken: null,
      raw: payload,
    }
  }
}
