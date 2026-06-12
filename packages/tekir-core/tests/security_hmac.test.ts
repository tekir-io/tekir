import { test, expect, describe } from 'bun:test'

const { createHmac, timingSafeEqual } = require('crypto')

describe('HMAC-SHA256 cookie signing', () => {
  function sign(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('base64url')
  }

  test('same input produces same signature', () => {
    expect(sign('hello', 'secret')).toBe(sign('hello', 'secret'))
  })

  test('different values produce different signatures', () => {
    expect(sign('hello', 'secret')).not.toBe(sign('world', 'secret'))
  })

  test('different secrets produce different signatures', () => {
    expect(sign('hello', 'key1')).not.toBe(sign('hello', 'key2'))
  })

  test('signature is base64url encoded', () => {
    const sig = sign('test', 'secret')
    expect(/^[A-Za-z0-9_-]+$/.test(sig)).toBe(true)
    expect(sig).not.toContain('+')
    expect(sig).not.toContain('/')
    expect(sig).not.toContain('=')
  })

  test('signature length is consistent', () => {
    const s1 = sign('short', 'key')
    const s2 = sign('a very long string that is much longer', 'key')
    expect(s1.length).toBe(s2.length) // SHA-256 always 32 bytes
  })

  test('empty value produces valid signature', () => {
    const sig = sign('', 'secret')
    expect(sig.length).toBeGreaterThan(0)
  })

  test('unicode value produces valid signature', () => {
    const sig = sign('Merhaba dünya 🌍', 'secret')
    expect(sig.length).toBeGreaterThan(0)
  })
})

describe('timingSafeEqual — constant time comparison', () => {
  test('equal buffers return true', () => {
    const a = Buffer.from('hello')
    const b = Buffer.from('hello')
    expect(timingSafeEqual(a, b)).toBe(true)
  })

  test('different buffers return false', () => {
    const a = Buffer.from('hello')
    const b = Buffer.from('world')
    expect(timingSafeEqual(a, b)).toBe(false)
  })

  test('throws on length mismatch', () => {
    const a = Buffer.from('short')
    const b = Buffer.from('much longer')
    expect(() => timingSafeEqual(a, b)).toThrow()
  })

  test('empty buffers are equal', () => {
    expect(timingSafeEqual(Buffer.from(''), Buffer.from(''))).toBe(true)
  })

  test('single char difference detected', () => {
    const a = Buffer.from('abcdef')
    const b = Buffer.from('abcdeg')
    expect(timingSafeEqual(a, b)).toBe(false)
  })

  test('first char difference detected', () => {
    const a = Buffer.from('xbcdef')
    const b = Buffer.from('abcdef')
    expect(timingSafeEqual(a, b)).toBe(false)
  })

  test('last char difference detected', () => {
    const a = Buffer.from('abcdex')
    const b = Buffer.from('abcdef')
    expect(timingSafeEqual(a, b)).toBe(false)
  })
})

describe('Cookie sign + verify roundtrip', () => {
  function sign(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('base64url')
  }

  function verify(signed: string, secret: string): string | null {
    const dot = signed.lastIndexOf('.')
    if (dot === -1) return null
    const value = signed.slice(0, dot)
    const sig = signed.slice(dot + 1)
    const expected = sign(value, secret)
    try {
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    } catch { return null }
    return value
  }

  test('sign then verify returns original value', () => {
    const value = 'session_data_123'
    const secret = 'my-app-secret-key'
    const signed = `${value}.${sign(value, secret)}`
    expect(verify(signed, secret)).toBe(value)
  })

  test('tampered signature is rejected', () => {
    const value = 'data'
    const secret = 'secret'
    const signed = `${value}.tampered_signature`
    expect(verify(signed, secret)).toBeNull()
  })

  test('tampered value is rejected', () => {
    const secret = 'secret'
    const sig = sign('original', secret)
    const tampered = `modified.${sig}`
    expect(verify(tampered, secret)).toBeNull()
  })

  test('wrong secret is rejected', () => {
    const value = 'data'
    const sig = sign(value, 'correct-secret')
    const signed = `${value}.${sig}`
    expect(verify(signed, 'wrong-secret')).toBeNull()
  })

  test('empty value works', () => {
    const value = ''
    const secret = 'secret'
    const signed = `${value}.${sign(value, secret)}`
    expect(verify(signed, secret)).toBe('')
  })

  test('value with dots works (uses lastIndexOf)', () => {
    const value = 'a.b.c.d'
    const secret = 'secret'
    const sig = sign(value, secret)
    const signed = `${value}.${sig}`
    expect(verify(signed, secret)).toBe(value)
  })

  test('no dot returns null', () => {
    expect(verify('nodot', 'secret')).toBeNull()
  })

  test('special characters in value', () => {
    const value = '<script>alert("xss")</script>&foo=bar'
    const secret = 'secret'
    const signed = `${encodeURIComponent(value)}.${sign(encodeURIComponent(value), secret)}`
    expect(verify(signed, secret)).toBe(encodeURIComponent(value))
  })
})
