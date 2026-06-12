import type { ProviderConfig, SocialProvider, SocialUser } from '../types'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const DEFAULT_SCOPES = ['openid', 'profile', 'email']

/**
 * Google OAuth 2.0 provider.
 *
 * Default scopes: `openid`, `profile`, `email`.
 */
export class GoogleProvider implements SocialProvider {
  name = 'google'

  /**
   * @param config - OAuth provider credentials and redirect URI.
   */
  constructor(private config: ProviderConfig) {}

  /**
   * Build the Google OAuth authorization URL.
   *
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @returns The full Google authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: (scopes || this.config.scopes || DEFAULT_SCOPES).join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    })
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `${AUTH_URL}?${params}`
  }

  /**
   * Exchange an authorization code for Google access and refresh tokens.
   *
   * @param code - The authorization code from the callback.
   * @returns An object containing `accessToken` and `refreshToken`.
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
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
    const data = await res.json() as any
    if (data.error) throw new Error(`Google OAuth error: ${data.error_description || data.error}`)
    if (!data.access_token) throw new Error('Google token exchange returned no access_token')
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null, idToken: data.id_token }
  }

  /**
   * Fetch the authenticated user's profile from Google.
   *
   * @param accessToken - The OAuth access token.
   * @returns A normalized {@link SocialUser} object.
   * @throws If the user info request fails.
   */
  async getUser(accessToken: string): Promise<SocialUser> {
    const res = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Google user fetch failed: ${res.status}`)
    const data = await res.json() as any
    return {
      id: data.sub,
      email: data.email || null,
      name: data.name || null,
      firstName: data.given_name || null,
      lastName: data.family_name || null,
      avatar: data.picture || null,
      provider: 'google',
      accessToken,
      refreshToken: null,
      raw: data,
    }
  }
}
