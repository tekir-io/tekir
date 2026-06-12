import { test, expect, describe } from 'bun:test'
import { sanitizeProxyHeaders } from '../src/middleware'

describe('sanitizeProxyHeaders', () => {
  function sanitize(input: Record<string, string>, port = 4321): Headers {
    return sanitizeProxyHeaders(new Headers(input), port)
  }

  test('pins Host to the internal Next listener', () => {
    const out = sanitize({ host: 'evil.example.com' }, 5555)
    expect(out.get('host')).toBe('127.0.0.1:5555')
  })

  test('strips authority-spoofing X-Forwarded-* headers', () => {
    const out = sanitize({
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-host': 'evil.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-port': '443',
      'x-forwarded-server': 'a',
      'forwarded': 'for=1.2.3.4',
    })
    expect(out.get('x-forwarded-for')).toBeNull()
    expect(out.get('x-forwarded-host')).toBeNull()
    expect(out.get('x-forwarded-proto')).toBeNull()
    expect(out.get('x-forwarded-port')).toBeNull()
    expect(out.get('x-forwarded-server')).toBeNull()
    expect(out.get('forwarded')).toBeNull()
  })

  test('strips X-Real-IP and X-Original-* spoofing headers', () => {
    const out = sanitize({
      'x-real-ip': '9.9.9.9',
      'x-original-url': '/admin',
      'x-original-host': 'evil.com',
    })
    expect(out.get('x-real-ip')).toBeNull()
    expect(out.get('x-original-url')).toBeNull()
    expect(out.get('x-original-host')).toBeNull()
  })

  test('strips hop-by-hop headers (Connection: upgrade, Transfer-Encoding)', () => {
    const out = sanitize({
      connection: 'upgrade',
      upgrade: 'websocket',
      'transfer-encoding': 'chunked',
      'keep-alive': 'timeout=5',
      te: 'trailers',
      'content-length': '123',
    })
    expect(out.get('connection')).toBeNull()
    expect(out.get('upgrade')).toBeNull()
    expect(out.get('transfer-encoding')).toBeNull()
    expect(out.get('keep-alive')).toBeNull()
    expect(out.get('te')).toBeNull()
    expect(out.get('content-length')).toBeNull()
  })

  test('preserves safe application headers', () => {
    const out = sanitize({
      'content-type': 'application/json',
      authorization: 'Bearer abc',
      cookie: 'session=1',
      'x-custom': 'keep-me',
    })
    expect(out.get('content-type')).toBe('application/json')
    expect(out.get('authorization')).toBe('Bearer abc')
    expect(out.get('cookie')).toBe('session=1')
    expect(out.get('x-custom')).toBe('keep-me')
  })

  test('header stripping is case-insensitive', () => {
    const out = sanitize({ 'X-Forwarded-For': '1.2.3.4', HOST: 'evil.com' })
    expect(out.get('x-forwarded-for')).toBeNull()
    expect(out.get('host')).toBe('127.0.0.1:4321')
  })
})
