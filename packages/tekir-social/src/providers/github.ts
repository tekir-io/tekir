import type { ProviderConfig, SocialProvider, SocialUser } from '../types'

const AUTH_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
const EMAILS_URL = 'https://api.github.com/user/emails'
const DEFAULT_SCOPES = ['user:email']

/**
 * GitHub OAuth 2.0 provider.
 *
 * Default scopes: `user:email`.
 * Automatically fetches the primary verified email from `/user/emails` if
 * the user's email is private.
 */
export class GitHubProvider implements SocialProvider {
  name = 'github'

  /**
   * @param config - OAuth provider credentials and redirect URI.
   */
  constructor(private config: ProviderConfig) {}

  /**
   * Build the GitHub OAuth authorization URL.
   *
   * @param state - CSRF state parameter.
   * @param scopes - Optional scopes to override the defaults.
   * @returns The full GitHub authorization URL.
   */
  getAuthUrl(state: string, scopes?: string[], codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
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
   * Exchange an authorization code for GitHub access and refresh tokens.
   *
   * @param code - The authorization code from the callback.
   * @returns An object containing `accessToken` and `refreshToken`.
   * @throws If the token exchange request fails or GitHub returns an error.
   */
  async exchangeCode(code: string, codeVerifier?: string) {
    const payload: Record<string, string> = {
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    }
    if (codeVerifier) payload.code_verifier = codeVerifier
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`)
    const data = await res.json() as any
    if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`)
    if (!data.access_token) throw new Error('GitHub token exchange returned no access_token')
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null }
  }

  /**
   * Fetch the authenticated user's profile from GitHub.
   *
   * @param accessToken - The OAuth access token.
   * @returns A normalized {@link SocialUser} object.
   * @throws If the user info request fails.
   */
  async getUser(accessToken: string): Promise<SocialUser> {
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

    const res = await fetch(USER_URL, { headers })
    if (!res.ok) throw new Error(`GitHub user fetch failed: ${res.status}`)
    const data = await res.json() as any

    // GitHub may not return email if it's private — fetch from /user/emails.
    // Only accept a primary AND verified address: an unverified fallback lets
    // an attacker add a victim's email to their GitHub account and take over a
    // matched local account.
    let email: string | null = null
    if (data.email) {
      // The /user payload email is only present when public and is verified by
      // GitHub, so it is safe to trust.
      email = data.email
    } else {
      try {
        const emailRes = await fetch(EMAILS_URL, { headers })
        if (emailRes.ok) {
          const emails = await emailRes.json() as any[]
          const primary = emails.find((e: any) => e.primary && e.verified)
          email = primary?.email ?? null
        }
      } catch {}
    }

    const nameParts = (data.name || '').split(' ')
    return {
      id: String(data.id),
      email,
      name: data.name || data.login || null,
      firstName: nameParts[0] || null,
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
      avatar: data.avatar_url || null,
      provider: 'github',
      accessToken,
      refreshToken: null,
      raw: data,
    }
  }
}
