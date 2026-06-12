import { test, expect, describe } from 'bun:test'
import { DatabaseSessionStore } from '../src/stores/database'
import { session } from '../src/middleware'

describe('DatabaseSessionStore — table name validation', () => {
  const mockDb = { exec: async () => {}, queryOne: async () => null, run: async () => {} }

  test('accepts valid table names', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'sessions')).not.toThrow()
    expect(() => new DatabaseSessionStore(mockDb, 'user_sessions')).not.toThrow()
    expect(() => new DatabaseSessionStore(mockDb, '_sessions')).not.toThrow()
  })

  test('rejects SQL injection in table name', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'sessions; DROP TABLE users--')).toThrow('Invalid table name')
    expect(() => new DatabaseSessionStore(mockDb, 'sessions" OR 1=1')).toThrow('Invalid table name')
  })

  test('rejects empty table name', () => {
    expect(() => new DatabaseSessionStore(mockDb, '')).toThrow('Invalid table name')
  })

  test('rejects table names with spaces', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'my sessions')).toThrow('Invalid table name')
  })
})

describe('Session cookie parsing — ReDoS prevention', () => {
  test('parses cookie without regex', async () => {
    const middleware = session({ cookieName: 'test_sess' })

    let extractedSession: any = null
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'test_sess=abc123; other=value' : '' },
      headers: {},
      $result: null,
      response: {},
    }

    await middleware(ctx, async () => {
      extractedSession = ctx.session
    })

    expect(extractedSession).toBeDefined()
    expect(extractedSession.id).toBe('abc123')
  })

  test('handles cookie with special regex characters in name safely', async () => {
    // This cookie name contains regex metacharacters — should not cause ReDoS
    const middleware = session({ cookieName: 'test.+*sess' })

    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'test.+*sess=value123' : '' },
      headers: {},
      $result: null,
      response: {},
    }

    await middleware(ctx, async () => {
      expect(ctx.session).toBeDefined()
      expect(ctx.session.id).toBe('value123')
    })
  })

  test('handles cookie with equals sign in value', async () => {
    const middleware = session({ cookieName: 'sess' })

    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'sess=abc=def=ghi; other=x' : '' },
      headers: {},
      $result: null,
      response: {},
    }

    await middleware(ctx, async () => {
      expect(ctx.session.id).toBe('abc=def=ghi')
    })
  })

  test('generates new session ID when no cookie present', async () => {
    const middleware = session({ cookieName: 'sess' })

    const ctx: any = {
      request: { header: () => '' },
      headers: {},
      $result: null,
      response: {},
    }

    await middleware(ctx, async () => {
      expect(ctx.session).toBeDefined()
      expect(ctx.session.id).toBeTruthy()
      expect(ctx.session.id.length).toBeGreaterThan(0)
    })
  })

  test('parses first cookie when multiple cookies present', async () => {
    const middleware = session({ cookieName: 'sess' })
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'other=xyz; sess=myid123; extra=abc' : '' },
      headers: {},
      $result: null,
      response: {},
    }
    await middleware(ctx, async () => {
      expect(ctx.session.id).toBe('myid123')
    })
  })

  test('ignores cookies with similar names', async () => {
    const middleware = session({ cookieName: 'sess' })
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'session=wrong; sess=correct; sess_extra=wrong2' : '' },
      headers: {},
      $result: null,
      response: {},
    }
    await middleware(ctx, async () => {
      expect(ctx.session.id).toBe('correct')
    })
  })

  test('handles empty cookie value', async () => {
    const middleware = session({ cookieName: 'sess' })
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'sess=' : '' },
      headers: {},
      $result: null,
      response: {},
    }
    await middleware(ctx, async () => {
      // Empty value should generate new ID
      expect(ctx.session).toBeDefined()
    })
  })

  test('handles malformed cookie header gracefully', async () => {
    const middleware = session({ cookieName: 'sess' })
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? ';;;===;;;' : '' },
      headers: {},
      $result: null,
      response: {},
    }
    await middleware(ctx, async () => {
      expect(ctx.session).toBeDefined()
      expect(ctx.session.id).toBeTruthy()
    })
  })

  test('handles very long cookie header without hanging (ReDoS proof)', async () => {
    const middleware = session({ cookieName: 'sess' })
    // Create a very long cookie string that would cause ReDoS with naive regex
    const longCookie = 'a'.repeat(100000) + '; sess=found'
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? longCookie : '' },
      headers: {},
      $result: null,
      response: {},
    }
    const start = Date.now()
    await middleware(ctx, async () => {
      expect(ctx.session.id).toBe('found')
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000) // Should be way under 1 second
  })

  test('cookie name with special chars parses correctly', async () => {
    const middleware = session({ cookieName: 'my.app.session' })
    const ctx: any = {
      request: { header: (name: string) => name === 'cookie' ? 'my.app.session=sid123; other=x' : '' },
      headers: {},
      $result: null,
      response: {},
    }
    await middleware(ctx, async () => {
      expect(ctx.session.id).toBe('sid123')
    })
  })
})

describe('DatabaseSessionStore — additional table name tests', () => {
  const mockDb = { exec: async () => {}, queryOne: async () => null, run: async () => {} }

  test('rejects hyphenated table names', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'my-sessions')).toThrow('Invalid table name')
  })

  test('rejects table names starting with numbers', () => {
    expect(() => new DatabaseSessionStore(mockDb, '1sessions')).toThrow('Invalid table name')
  })

  test('rejects backtick in table name', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'sessions`; DROP TABLE')).toThrow('Invalid table name')
  })

  test('rejects parentheses in table name', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'sessions()')).toThrow('Invalid table name')
  })

  test('accepts underscored names', () => {
    expect(() => new DatabaseSessionStore(mockDb, 'user_sessions_v2')).not.toThrow()
  })

  test('accepts default table name', () => {
    expect(() => new DatabaseSessionStore(mockDb)).not.toThrow()
  })
})
