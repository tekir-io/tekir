import type { SocialConfig, SocialProvider, SocialUser, ProviderConfig } from './types'
import { hideSensitiveFields } from './types'
import { createState, verifyState } from './state'
import { createPkcePair } from './pkce'
import { GoogleProvider } from './providers/google'
import { GitHubProvider } from './providers/github'
import { AppleProvider } from './providers/apple'
import { DiscordProvider } from './providers/discord'
import { FacebookProvider } from './providers/facebook'

/** Constant-time string comparison to avoid leaking match length via timing. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const BUILT_IN: Record<string, new (config: ProviderConfig) => SocialProvider> = {
  google: GoogleProvider,
  github: GitHubProvider,
  apple: AppleProvider,
  discord: DiscordProvider,
  facebook: FacebookProvider,
}

/**
 * Social authentication manager that provides OAuth flows for multiple providers
 * (Google, GitHub, Apple, Discord, Facebook) with CSRF-protected state tokens.
 *
 * @example
 * ```ts
 * const social = new Social({
 *   providers: {
 *     google: { clientId: '...', clientSecret: '...', redirectUri: '...' },
 *   },
 * })
 * const { url, state } = await social.redirect('google')
 * ```
 */
export class Social {
  private providers = new Map<string, SocialProvider>()
  private config: SocialConfig
  private secret: string

  /**
   * Create a new Social authentication manager.
   *
   * @param config - Social configuration including provider credentials and options.
   */
  constructor(config: SocialConfig) {
    this.config = config
    this.secret = process.env.APP_KEY || ''
    if (!this.secret) {
      // Fail closed in production: unsigned state tokens combined with a
      // stored-state check are still vulnerable to anyone who can read or
      // mint the stored value (e.g. a request smuggled through a shared
      // session store). Dev/test apps can still run without APP_KEY by
      // setting NODE_ENV explicitly to a non-production value.
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[@tekir/social] APP_KEY is required in production. Set APP_KEY to sign OAuth state tokens.')
      }
      console.warn('[@tekir/social] APP_KEY is not set. OAuth state tokens will not be signed. Set APP_KEY for production use.')
    }

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const Provider = BUILT_IN[name.replace(/_app$/, '')]
      if (Provider) {
        this.providers.set(name, new Provider(providerConfig))
      }
    }
  }

  /**
   * Register a custom OAuth provider at runtime.
   *
   * @param name - The provider name (e.g. `'custom-sso'`).
   * @param provider - A provider implementation conforming to {@link SocialProvider}.
   * @returns The Social instance for chaining.
   *
   * @example
   * ```ts
   * social.register('custom', myCustomProvider)
   * ```
   */
  register(name: string, provider: SocialProvider): this {
    this.providers.set(name, provider)
    return this
  }

  /**
   * Get a registered OAuth provider by name.
   *
   * @param name - The provider name (e.g. `'google'`, `'github'`).
   * @returns The {@link SocialProvider} instance.
   * @throws If the provider is not configured.
   *
   * @example
   * ```ts
   * const google = social.use('google')
   * ```
   */
  use(name: string): SocialProvider {
    const provider = this.providers.get(name)
    if (!provider) throw new Error(`Social provider "${name}" not configured`)
    return provider
  }

  /**
   * Generate the OAuth redirect URL for a provider.
   * Includes signed state for CSRF protection.
   *
   * @example
   * const url = await social.redirectUrl('google', { redirect: '/dashboard' })
   * return response.redirect(url)
   */
  /**
   * Generate the OAuth redirect URL for a provider.
   * Returns { url, state } — store `state` in session/cookie for verification.
   *
   * @example
   * const { url, state } = await social.redirect('google', { redirect: '/dashboard' })
   * ctx.session.put('oauth_state', state)
   * return response.redirect(url)
   */
  async redirect(provider: string, options?: { redirect?: string; isApp?: boolean; scopes?: string[]; nonce?: string }): Promise<{ url: string; state: string; codeVerifier: string; nonce: string }> {
    const p = this.use(provider)
    let state: string

    // PKCE: generate a verifier/challenge pair. The verifier is returned so
    // the caller can stash it (in session) and pass it back at callback,
    // binding the authorization code to this specific request.
    const pkce = await createPkcePair()
    // Nonce binds the issued id_token (where supported, e.g. Apple/OIDC) to
    // this request and is also used to bind state to the session.
    const nonce = options?.nonce ?? crypto.randomUUID()

    if (this.secret) {
      // Signed state carries the request payload plus the binding nonce so the
      // callback can bind it back to the session-stored nonce.
      state = await createState(
        { redirect: options?.redirect, isApp: options?.isApp, bindNonce: nonce },
        this.secret,
      )
    } else {
      // Plain mode — the state IS the nonce, verified via session/cookie match.
      state = nonce
    }

    return { url: p.getAuthUrl(state, options?.scopes, pkce.challenge, nonce), state, codeVerifier: pkce.verifier, nonce }
  }

  /** @deprecated Use redirect() instead */
  async redirectUrl(provider: string, options?: { redirect?: string; isApp?: boolean; scopes?: string[] }): Promise<string> {
    const { url } = await this.redirect(provider, options)
    return url
  }

  /**
   * Handle the OAuth callback — verify state, exchange code, fetch user.
   * Returns the social user profile + decoded state.
   *
   * @example
   * const { user, state } = await social.handleCallback('google', code, stateParam)
   */
  /**
   * Handle the OAuth callback — verify state, exchange code, fetch user.
   *
   * @param provider - Provider name (e.g. 'google')
   * @param code - Authorization code from query params
   * @param state - State from query params
   * @param storedState - State stored in session/cookie (for verification)
   *
   * @example
   * const storedState = ctx.session.pull('oauth_state')
   * const codeVerifier = ctx.session.pull('oauth_code_verifier')
   * const { user } = await social.handleCallback('google', query.code, query.state, storedState, { codeVerifier })
   */
  async handleCallback(provider: string, code: string, state: string, storedState?: string, options?: { codeVerifier?: string; nonce?: string }): Promise<{
    user: SocialUser
    state: { redirect?: string; isApp?: boolean; [key: string]: unknown }
  }> {
    let payload: Record<string, any> = {}

    // Session binding is required in BOTH modes. The `storedState` is the
    // value persisted server-side (session/cookie) at redirect() time — either
    // the full signed state token or the nonce. Without it, state cannot be
    // bound to the user's session and login-CSRF / replay are possible.
    if (!storedState) {
      throw new Error('OAuth state is not bound to a session (storedState missing) — possible CSRF')
    }

    if (this.secret) {
      // Signed state — verify HMAC + expiry, then bind to the session.
      const decoded = await verifyState(state, this.secret, this.config.stateMaxAge)
      if (!decoded) throw new Error('Invalid or expired OAuth state token')
      // Bind: the state's binding nonce must match the session-stored value.
      // Accept either the full stored state token or the stored nonce.
      const boundOk = constantTimeEqual(state, storedState)
        || (typeof decoded.bindNonce === 'string' && constantTimeEqual(decoded.bindNonce, storedState))
      if (!boundOk) throw new Error('OAuth state not bound to this session — possible CSRF attack')
      payload = decoded
    } else {
      // Plain mode — the state IS the nonce; compare with the stored value.
      if (!constantTimeEqual(state, storedState)) {
        throw new Error('OAuth state mismatch — possible CSRF attack')
      }
    }

    // Validate redirect URL
    if (payload.redirect) {
      this.validateRedirect(payload.redirect)
    }

    // Exchange code for tokens (PKCE verifier binds the code to this request).
    if (!options?.codeVerifier) {
      throw new Error('OAuth callback is missing the PKCE codeVerifier returned by redirect()')
    }
    const p = this.use(provider)
    const tokens = await p.exchangeCode(code, options.codeVerifier)

    // Fetch user profile. Pass the id_token + expected nonce so OIDC providers
    // (Apple) can verify signature and bind the token to this request.
    const expectedNonce = options.nonce
      ?? (typeof payload.bindNonce === 'string' ? payload.bindNonce : undefined)
      ?? (!this.secret ? state : undefined)
    const user = await p.getUser(tokens.accessToken, { idToken: tokens.idToken, nonce: expectedNonce })
    user.refreshToken = tokens.refreshToken || null

    // Hide tokens/raw from default serialization to avoid leaking them into
    // logs, response bodies, or client storage.
    return { user: hideSensitiveFields(user), state: payload }
  }

  /**
   * Validate redirect URL against allowed patterns.
   * Prevents open redirect attacks.
   */
  private validateRedirect(url: string): void {
    // Protocol-relative URLs (`//evil.com/path`) look like a same-origin
    // path to a naive `startsWith('/')` check but the browser resolves
    // them against the request's scheme, so they navigate off-site. Treat
    // them as absolute and run the full allowlist check.
    if (url.startsWith('//')) {
      // Drop through to the absolute-URL branch by synthesising a URL.
    } else if (url.startsWith('/')) {
      return
    }

    const allowed = this.config.allowedRedirects || []
    if (allowed.length === 0) {
      // No allowlist configured but the caller is asking for an absolute
      // redirect. Refuse — silent open-redirect support is a footgun.
      throw new Error(`Absolute redirect "${url}" requires allowedRedirects to be configured`)
    }

    try {
      // Protocol-relative URLs are resolved as https for inspection.
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url)
      // Only allow http(s) targets; reject javascript:, data:, file:, etc.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Redirect URL "${url}" uses a disallowed scheme`)
      }
      const isAllowed = allowed.some(pattern => {
        if (pattern.startsWith('*.')) {
          // Wildcard subdomain: *.example.com. Require a real label boundary
          // (a leading dot) so `evilexample.com` cannot match `*.example.com`,
          // and require https to prevent scheme-downgrade.
          const suffix = pattern.slice(1) // ".example.com"
          const hostOk = parsed.hostname.endsWith(suffix) && parsed.hostname.length > suffix.length
          return hostOk && parsed.protocol === 'https:'
        }
        // Exact host match defaults to https; an explicit origin pattern
        // (scheme://host[:port]) is matched verbatim.
        if (pattern.includes('://')) return parsed.origin === pattern
        return parsed.hostname === pattern && parsed.protocol === 'https:'
      })
      if (!isAllowed) {
        throw new Error(`Redirect URL "${url}" is not in the allowed list`)
      }
    } catch (e: any) {
      if (e.message.includes('not in the allowed list') || e.message.includes('requires allowedRedirects') || e.message.includes('disallowed scheme')) throw e
      throw new Error(`Invalid redirect URL: ${url}`)
    }
  }

  /**
   * List the names of all registered OAuth providers.
   *
   * @returns An array of provider name strings.
   *
   * @example
   * ```ts
   * social.providerNames // ['google', 'github']
   * ```
   */
  get providerNames(): string[] {
    return [...this.providers.keys()]
  }
}
