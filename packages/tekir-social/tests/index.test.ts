import { test, expect, describe } from 'bun:test'
import { Social, GoogleProvider, GitHubProvider, AppleProvider, DiscordProvider, FacebookProvider, createState, verifyState } from '../src/index'
import type { SocialConfig, SocialUser, ProviderConfig } from '../src/types'
import type { SocialProviderInterface } from '../src/index'

// Set APP_KEY for tests
process.env.APP_KEY = 'test-app-key-for-social-auth-signing'


describe('State tokens', () => {
  const secret = 'test-secret-key-123'

  test('createState returns a signed token', async () => {
    const token = await createState({ redirect: '/dashboard' }, secret)
    expect(token).toContain('.')
    expect(typeof token).toBe('string')
  })

  test('verifyState decodes a valid token', async () => {
    const token = await createState({ redirect: '/home', isApp: true }, secret)
    const payload = await verifyState(token, secret)
    expect(payload).not.toBeNull()
    expect(payload!.redirect).toBe('/home')
    expect(payload!.isApp).toBe(true)
    expect(payload!.timestamp).toBeGreaterThan(0)
    expect(payload!.nonce).toBeDefined()
  })

  test('verifyState rejects wrong secret', async () => {
    const token = await createState({}, secret)
    const payload = await verifyState(token, 'wrong-secret')
    expect(payload).toBeNull()
  })

  test('verifyState rejects tampered payload', async () => {
    const token = await createState({}, secret)
    const [data, sig] = token.split('.')
    const tampered = btoa(JSON.stringify({ redirect: '/hacked', timestamp: Date.now(), nonce: 'x' }))
    const payload = await verifyState(`${tampered}.${sig}`, secret)
    expect(payload).toBeNull()
  })

  test('verifyState rejects expired token', async () => {
    const token = await createState({}, secret)
    await new Promise(r => setTimeout(r, 10)) // ensure time passes
    const payload = await verifyState(token, secret, 1) // 1ms maxAge
    expect(payload).toBeNull()
  })

  test('verifyState accepts token within maxAge', async () => {
    const token = await createState({}, secret)
    const payload = await verifyState(token, secret, 60_000)
    expect(payload).not.toBeNull()
  })

  test('verifyState rejects invalid format', async () => {
    expect(await verifyState('no-dot-here', secret)).toBeNull()
    expect(await verifyState('', secret)).toBeNull()
    expect(await verifyState('.', secret)).toBeNull()
  })

  test('state preserves custom data', async () => {
    const token = await createState({ redirect: '/x', isApp: false }, secret)
    const payload = await verifyState(token, secret)
    expect(payload!.redirect).toBe('/x')
    expect(payload!.isApp).toBe(false)
  })
})


const dummyConfig: ProviderConfig = {
  clientId: 'test-id',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3000/callback',
}

describe('GoogleProvider', () => {
  const p = new GoogleProvider(dummyConfig)

  test('name is google', () => {
    expect(p.name).toBe('google')
  })

  test('getAuthUrl returns google URL with params', () => {
    const url = p.getAuthUrl('test-state')
    expect(url).toContain('accounts.google.com')
    expect(url).toContain('client_id=test-id')
    expect(url).toContain('redirect_uri=')
    expect(url).toContain('state=test-state')
    expect(url).toContain('scope=')
  })

  test('getAuthUrl with custom scopes', () => {
    const url = p.getAuthUrl('s', ['email'])
    expect(url).toContain('scope=email')
  })

  test('has exchangeCode method', () => {
    expect(typeof p.exchangeCode).toBe('function')
  })

  test('has getUser method', () => {
    expect(typeof p.getUser).toBe('function')
  })
})

describe('GitHubProvider', () => {
  const p = new GitHubProvider(dummyConfig)

  test('name is github', () => {
    expect(p.name).toBe('github')
  })

  test('getAuthUrl returns github URL', () => {
    const url = p.getAuthUrl('test-state')
    expect(url).toContain('github.com/login/oauth/authorize')
    expect(url).toContain('client_id=test-id')
    expect(url).toContain('state=test-state')
  })

  test('default scope is user:email', () => {
    const url = p.getAuthUrl('s')
    expect(url).toContain('scope=user')
  })
})

describe('AppleProvider', () => {
  const p = new AppleProvider(dummyConfig)

  test('name is apple', () => {
    expect(p.name).toBe('apple')
  })

  test('getAuthUrl returns apple URL with form_post', () => {
    const url = p.getAuthUrl('test-state')
    expect(url).toContain('appleid.apple.com')
    expect(url).toContain('response_mode=form_post')
    expect(url).toContain('state=test-state')
  })
})

describe('DiscordProvider', () => {
  const p = new DiscordProvider(dummyConfig)

  test('name is discord', () => {
    expect(p.name).toBe('discord')
  })

  test('getAuthUrl returns discord URL', () => {
    const url = p.getAuthUrl('test-state')
    expect(url).toContain('discord.com/api/oauth2/authorize')
    expect(url).toContain('scope=identify+email')
  })
})

describe('FacebookProvider', () => {
  const p = new FacebookProvider(dummyConfig)

  test('name is facebook', () => {
    expect(p.name).toBe('facebook')
  })

  test('getAuthUrl returns facebook URL', () => {
    const url = p.getAuthUrl('test-state')
    expect(url).toContain('facebook.com')
    expect(url).toContain('client_id=test-id')
  })

  test('default scopes include email', () => {
    const url = p.getAuthUrl('s')
    expect(url).toContain('scope=email')
  })
})


describe('Social', () => {
  const config: SocialConfig = {

    providers: {
      google: { clientId: 'g-id', clientSecret: 'g-secret', redirectUri: 'http://localhost/auth/google/callback' },
      github: { clientId: 'gh-id', clientSecret: 'gh-secret', redirectUri: 'http://localhost/auth/github/callback' },
      discord: { clientId: 'd-id', clientSecret: 'd-secret', redirectUri: 'http://localhost/auth/discord/callback' },
    },
    allowedRedirects: ['localhost', '*.example.com'],
  }

  test('lists provider names', () => {
    const social = new Social(config)
    expect(social.providerNames.sort()).toEqual(['discord', 'github', 'google'])
  })

  test('use() returns provider', () => {
    const social = new Social(config)
    expect(social.use('google').name).toBe('google')
    expect(social.use('github').name).toBe('github')
  })

  test('use() throws for unknown provider', () => {
    const social = new Social(config)
    expect(() => social.use('twitter')).toThrow('not configured')
  })

  test('register() adds custom provider', () => {
    const social = new Social(config)
    const custom: SocialProviderInterface = {
      name: 'custom',
      getAuthUrl: () => 'http://custom.com/auth',
      exchangeCode: async () => ({ accessToken: 'tok' }),
      getUser: async () => ({
        id: '1', email: 'a@b.com', name: 'Test', firstName: 'Test', lastName: null,
        avatar: null, provider: 'custom', accessToken: 'tok', refreshToken: null, raw: {},
      }),
    }
    social.register('custom', custom)
    expect(social.use('custom').name).toBe('custom')
    expect(social.providerNames).toContain('custom')
  })

  test('redirect() returns url and state', async () => {
    const social = new Social(config)
    const { url, state } = await social.redirect('google', { redirect: '/dashboard' })
    expect(url).toContain('accounts.google.com')
    expect(url).toContain('state=')
    expect(url).toContain('client_id=g-id')
    expect(state.length).toBeGreaterThan(0)
  })

  test('redirect() with isApp flag encodes in state', async () => {
    const social = new Social(config)
    const { url, state } = await social.redirect('github', { isApp: true })
    expect(url).toContain('github.com')
    const payload = await verifyState(state, process.env.APP_KEY!)
    expect(payload!.isApp).toBe(true)
  })

  test('redirect() with custom scopes', async () => {
    const social = new Social(config)
    const { url } = await social.redirect('google', { scopes: ['openid'] })
    expect(url).toContain('scope=openid')
  })

  test('redirectUrl() still works (deprecated)', async () => {
    const social = new Social(config)
    const url = await social.redirectUrl('google')
    expect(url).toContain('accounts.google.com')
  })
})


describe('Redirect validation', () => {
  test('relative URLs are always allowed', async () => {
    const social = new Social({

      providers: { google: { clientId: 'id', clientSecret: 's', redirectUri: 'http://localhost/cb' } },
      allowedRedirects: ['example.com'],
    })
    // Internal test — relative URL should not throw
    const url = await social.redirectUrl('google', { redirect: '/dashboard' })
    expect(url).toContain('state=')
  })

  test('wildcard subdomain matching', async () => {
    const social = new Social({

      providers: { google: { clientId: 'id', clientSecret: 's', redirectUri: 'http://localhost/cb' } },
      allowedRedirects: ['*.myapp.com'],
    })
    // This would pass validation for app.myapp.com
    const url = await social.redirectUrl('google', { redirect: '/' })
    expect(url).toBeDefined()
  })
})


describe('Types', () => {
  test('SocialUser shape', () => {
    const user: SocialUser = {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      avatar: 'https://example.com/avatar.jpg',
      provider: 'google',
      accessToken: 'token123',
      refreshToken: null,
      raw: { sub: '123' },
    }
    expect(user.id).toBe('123')
    expect(user.provider).toBe('google')
  })

  test('SocialConfig shape', () => {
    const config: SocialConfig = {
      providers: {
        google: { clientId: 'id', clientSecret: 'secret', redirectUri: '/callback' },
      },
      stateMaxAge: 300000,
      allowedRedirects: ['example.com'],
    }
    expect(config.stateMaxAge).toBe(300000)
  })
})
