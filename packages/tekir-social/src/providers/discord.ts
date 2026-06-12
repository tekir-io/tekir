import type { ProviderConfig, SocialProvider, SocialUser } from '../types'

const AUTH_URL = 'https://discord.com/api/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const USER_URL = 'https://discord.com/api/users/@me'
const DEFAULT_SCOPES = ['identify', 'email']

/**
 * Discord OAuth 2.0 provider.
 *
 * Default scopes: `identify`, `email`.
 */
export class DiscordProvider implements SocialProvider {
  name = 'discord'

  /**
   * @param config - OAuth provider credentials and redirect URI.
   */
  constructor(private config: ProviderConfig) {}

  /**
   * Build the Discord OAuth authorization URL.
   *
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @returns The full Discord authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: (scopes || this.config.scopes || DEFAULT_SCOPES).join(' '),
      state,
    })
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `${AUTH_URL}?${params}`
  }

  /**
   * Exchange an authorization code for Discord access and refresh tokens.
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
    if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`)
    const data = await res.json() as any
    if (data.error) throw new Error(`Discord OAuth error: ${data.error_description || data.error}`)
    if (!data.access_token) throw new Error('Discord token exchange returned no access_token')
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null }
  }

  /**
   * Fetch the authenticated user's profile from Discord.
   *
   * @param accessToken - The OAuth access token.
   * @returns A normalized {@link SocialUser} object.
   * @throws If the user info request fails.
   */
  async getUser(accessToken: string): Promise<SocialUser> {
    const res = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status}`)
    const data = await res.json() as any
    const avatar = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null
    return {
      id: data.id,
      email: data.email || null,
      name: data.global_name || data.username || null,
      firstName: data.global_name?.split(' ')[0] || null,
      lastName: data.global_name?.split(' ').slice(1).join(' ') || null,
      avatar,
      provider: 'discord',
      accessToken,
      refreshToken: null,
      raw: data,
    }
  }
}
