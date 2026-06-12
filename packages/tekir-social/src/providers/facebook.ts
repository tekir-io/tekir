import type { ProviderConfig, SocialProvider, SocialUser } from '../types'

const AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth'
const TOKEN_URL = 'https://graph.facebook.com/v19.0/oauth/access_token'
const USER_URL = 'https://graph.facebook.com/v19.0/me'
const DEFAULT_SCOPES = ['email', 'public_profile']

/**
 * Facebook OAuth 2.0 provider (Graph API v19.0).
 *
 * Default scopes: `email`, `public_profile`.
 */
export class FacebookProvider implements SocialProvider {
  name = 'facebook'

  /**
   * @param config - OAuth provider credentials and redirect URI.
   */
  constructor(private config: ProviderConfig) {}

  /**
   * Build the Facebook OAuth authorization URL.
   *
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @returns The full Facebook authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (scopes || this.config.scopes || DEFAULT_SCOPES).join(','),
      state,
      response_type: 'code',
    })
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `${AUTH_URL}?${params}`
  }

  /**
   * Exchange an authorization code for a Facebook access token.
   *
   * @param code - The authorization code from the callback.
   * @returns An object containing `accessToken` (Facebook does not provide refresh tokens).
   * @throws If the token exchange request fails.
   */
  async exchangeCode(code: string, codeVerifier?: string) {
    const params = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    })
    if (codeVerifier) params.set('code_verifier', codeVerifier)
    const res = await fetch(`${TOKEN_URL}?${params}`)
    if (!res.ok) throw new Error(`Facebook token exchange failed: ${res.status}`)
    const data = await res.json() as any
    if (data.error) throw new Error(`Facebook OAuth error: ${data.error?.message || data.error}`)
    if (!data.access_token) throw new Error('Facebook token exchange returned no access_token')
    return { accessToken: data.access_token, refreshToken: undefined }
  }

  /**
   * Fetch the authenticated user's profile from Facebook.
   *
   * @param accessToken - The OAuth access token.
   * @returns A normalized {@link SocialUser} object.
   * @throws If the user info request fails.
   */
  async getUser(accessToken: string): Promise<SocialUser> {
    const params = new URLSearchParams({
      access_token: accessToken,
      fields: 'id,name,email,first_name,last_name,picture.type(large)',
    })
    const res = await fetch(`${USER_URL}?${params}`)
    if (!res.ok) throw new Error(`Facebook user fetch failed: ${res.status}`)
    const data = await res.json() as any
    return {
      id: data.id,
      email: data.email || null,
      name: data.name || null,
      firstName: data.first_name || null,
      lastName: data.last_name || null,
      avatar: data.picture?.data?.url || null,
      provider: 'facebook',
      accessToken,
      refreshToken: null,
      raw: data,
    }
  }
}
