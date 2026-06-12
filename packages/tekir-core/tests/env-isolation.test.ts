import { test, expect, describe } from 'bun:test'

describe('Frontend env isolation', () => {
  test('process.env backend secrets exist on server', () => {
    // Simulate backend env
    process.env.DATABASE_URL = 'postgres://secret:pass@localhost/db'
    process.env.APP_KEY = 'super-secret-key'
    process.env.JWT_SECRET = 'jwt-secret-123'
    process.env.PUBLIC_API_URL = 'https://api.example.com'

    expect(process.env.DATABASE_URL).toBe('postgres://secret:pass@localhost/db')
    expect(process.env.APP_KEY).toBe('super-secret-key')
    expect(process.env.PUBLIC_API_URL).toBe('https://api.example.com')
  })

  test('PUBLIC_* prefix correctly identifies frontend-safe env vars', () => {
    process.env.DATABASE_URL = 'postgres://secret@localhost/db'
    process.env.APP_KEY = 'secret123'
    process.env.PUBLIC_API_URL = 'https://api.example.com'
    process.env.PUBLIC_APP_NAME = 'My App'

    const publicEnv: Record<string, string> = {}
    const backendEnv: Record<string, string> = {}

    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue
      if (key.startsWith('PUBLIC_')) {
        publicEnv[key] = value
      } else if (['DATABASE_URL', 'APP_KEY', 'JWT_SECRET'].includes(key)) {
        backendEnv[key] = value
      }
    }

    expect(publicEnv.PUBLIC_API_URL).toBe('https://api.example.com')
    expect(publicEnv.PUBLIC_APP_NAME).toBe('My App')
    expect(publicEnv.DATABASE_URL).toBeUndefined()
    expect(publicEnv.APP_KEY).toBeUndefined()
    expect(publicEnv.JWT_SECRET).toBeUndefined()
  })

  test('VITE_ prefix filter works correctly', () => {
    const envVars: Record<string, string> = {
      DATABASE_URL: 'postgres://secret@localhost/db',
      APP_KEY: 'secret',
      VITE_API_URL: 'https://api.example.com',
      VITE_APP_NAME: 'My App',
    }

    const viteEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(envVars)) {
      if (key.startsWith('VITE_')) viteEnv[key] = value
    }

    expect(viteEnv.VITE_API_URL).toBe('https://api.example.com')
    expect(viteEnv.VITE_APP_NAME).toBe('My App')
    expect(viteEnv.DATABASE_URL).toBeUndefined()
    expect(viteEnv.APP_KEY).toBeUndefined()
  })

  test('Vite config enforces VITE_ prefix and points envDir at the project root', async () => {
    const { readFileSync } = await import('fs')
    const viteMiddleware = readFileSync(
      require.resolve('../../tekir-vite/src/middleware.ts'),
      'utf-8'
    )
    // Both dev and build paths must pin envPrefix so only VITE_* vars are inlined.
    const prefixMatches = viteMiddleware.match(/envPrefix:\s*'VITE_'/g) || []
    expect(prefixMatches.length).toBeGreaterThanOrEqual(2)
    // envDir must NOT be `false` (Vite disables .env loading entirely then).
    expect(viteMiddleware).not.toContain('envDir: false')
    // envDir must point at the resolved project root (`appRoot`) so
    // `.env` discovery works regardless of the launching cwd.
    const envDirMatches = viteMiddleware.match(/envDir:\s*appRoot/g) || []
    expect(envDirMatches.length).toBeGreaterThanOrEqual(2)
  })

  test('backend env vars with common secret names are never PUBLIC_*', () => {
    const secretPatterns = [
      'DATABASE_URL', 'DB_PASSWORD', 'APP_KEY', 'APP_SECRET',
      'JWT_SECRET', 'ENCRYPTION_KEY', 'AWS_SECRET_ACCESS_KEY',
      'REDIS_PASSWORD', 'SMTP_PASSWORD', 'API_KEY',
    ]

    for (const key of secretPatterns) {
      expect(key.startsWith('PUBLIC_')).toBe(false)
      expect(key.startsWith('VITE_')).toBe(false)
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(false)
    }
  })

  test('PUBLIC_* env serialization does not include non-PUBLIC vars', () => {
    process.env.DATABASE_URL = 'postgres://secret@localhost/db'
    process.env.APP_KEY = 'secret123'
    process.env.PUBLIC_SAFE = 'safe-value'

    const publicEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('PUBLIC_') && value) publicEnv[key] = value
    }
    const serialized = JSON.stringify(publicEnv)

    expect(serialized).toContain('PUBLIC_SAFE')
    expect(serialized).toContain('safe-value')
    expect(serialized).not.toContain('postgres://secret')
    expect(serialized).not.toContain('secret123')
  })
})
