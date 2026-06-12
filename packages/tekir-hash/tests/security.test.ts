import { test, expect, describe } from 'bun:test'
import { BcryptDriver, isMalformedBcryptHash, isBcryptFormatError } from '../src/drivers/bcrypt'

describe('BcryptDriver — defaults', () => {
  test('defaults to 12 rounds', () => {
    const d = new BcryptDriver()
    expect(d.needsRehash('$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(d.needsRehash('$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  test('custom rounds are respected', () => {
    const d = new BcryptDriver({ rounds: 14 })
    expect(d.needsRehash('$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(d.needsRehash('$2b$14$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  test('flags non-bcrypt hashes for rehash', () => {
    const d = new BcryptDriver()
    expect(d.needsRehash('plaintext')).toBe(true)
    expect(d.needsRehash('')).toBe(true)
    expect(d.needsRehash('sha256:abcdef')).toBe(true)
  })

  test('flags $2a$ format for rehash if rounds differ', () => {
    const d = new BcryptDriver()
    expect(d.needsRehash('$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
  })
})

describe('BcryptDriver — hash and verify', () => {
  test('make produces valid bcrypt hash', async () => {
    const d = new BcryptDriver({ rounds: 4 }) // low for speed
    const hash = await d.make('password123')
    expect(hash.startsWith('$2')).toBe(true)
    expect(hash.length).toBeGreaterThan(50)
  })

  test('verify returns true for correct password', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const hash = await d.make('mypassword')
    expect(await d.verify('mypassword', hash)).toBe(true)
  })

  test('verify returns false for wrong password', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const hash = await d.make('correct')
    expect(await d.verify('wrong', hash)).toBe(false)
  })

  test('verify returns false for invalid hash', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    expect(await d.verify('password', 'not-a-hash')).toBe(false)
  })

  test('verify returns false for empty hash', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    expect(await d.verify('password', '')).toBe(false)
  })

  test('different passwords produce different hashes', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const h1 = await d.make('password1')
    const h2 = await d.make('password2')
    expect(h1).not.toBe(h2)
  })

  test('same password produces different hashes (salt)', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const h1 = await d.make('same')
    const h2 = await d.make('same')
    expect(h1).not.toBe(h2) // different salts
    expect(await d.verify('same', h1)).toBe(true)
    expect(await d.verify('same', h2)).toBe(true)
  })

  test('unicode passwords work', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const hash = await d.make('şifre123')
    expect(await d.verify('şifre123', hash)).toBe(true)
    expect(await d.verify('sifre123', hash)).toBe(false)
  })

  test('single char password works', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const hash = await d.make('x')
    expect(await d.verify('x', hash)).toBe(true)
    expect(await d.verify('y', hash)).toBe(false)
  })

  test('long password works', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const long = 'a'.repeat(72) // bcrypt max is 72 bytes
    const hash = await d.make(long)
    expect(await d.verify(long, hash)).toBe(true)
  })
})

describe('BcryptDriver — needsRehash edge cases', () => {
  test('malformed hash returns true', () => {
    const d = new BcryptDriver()
    expect(d.needsRehash('$2b$')).toBe(true)
    expect(d.needsRehash('$2b$abc')).toBe(true)
    expect(d.needsRehash('$2b$$')).toBe(true)
  })

  test('correct rounds returns false', () => {
    const d = new BcryptDriver({ rounds: 10 })
    expect(d.needsRehash('$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  test('lower rounds returns true', () => {
    const d = new BcryptDriver({ rounds: 14 })
    expect(d.needsRehash('$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(d.needsRehash('$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════
// BcryptDriver — 72-byte truncation guard
// ═══════════════════════════════════════════════════════════

import { ScryptDriver } from '../src/drivers/scrypt'

describe('BcryptDriver — 72-byte truncation', () => {
  test('warns when input exceeds 72 bytes', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (msg: any) => warnings.push(String(msg))
    try {
      await d.make('x'.repeat(80))
    } finally {
      console.warn = orig
    }
    expect(warnings.some((w) => w.includes('72 bytes'))).toBe(true)
  })

  test('does not warn for short input', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (msg: any) => warnings.push(String(msg))
    try {
      await d.make('short')
    } finally {
      console.warn = orig
    }
    expect(warnings.length).toBe(0)
  })

  test('warning counts bytes not characters (multi-byte unicode)', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (msg: any) => warnings.push(String(msg))
    try {
      // 40 multi-byte chars (3 bytes each) = 120 bytes > 72
      await d.make('あ'.repeat(40))
    } finally {
      console.warn = orig
    }
    expect(warnings.some((w) => w.includes('72 bytes'))).toBe(true)
  })
})

describe('BcryptDriver — verify error handling', () => {
  test('returns false for malformed hash (expected non-match)', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    expect(await d.verify('password', 'not-a-bcrypt-hash')).toBe(false)
    expect(await d.verify('password', '')).toBe(false)
  })

  test('format/encoding errors map to false, not a thrown error', async () => {
    const d = new BcryptDriver({ rounds: 4 })
    // Right shape but invalid bcrypt base64 — a format error, not infra.
    const badEncoding = '$2b$04$' + 'a'.repeat(53)
    expect(await d.verify('password', badEncoding)).toBe(false)
  })

  test('error classifier: format/encoding errors are recognized', () => {
    expect(isBcryptFormatError({ code: 'PASSWORD_INVALID_ENCODING' })).toBe(true)
    expect(isBcryptFormatError(new Error('InvalidEncoding'))).toBe(true)
    // A genuine infra failure is NOT classified as a format error, so the
    // driver rethrows it instead of returning a misleading `false`.
    expect(isBcryptFormatError(new Error('native module exploded'))).toBe(false)
    expect(isBcryptFormatError({ code: 'ENOMEM' })).toBe(false)
  })

  test('hash shape classifier rejects unrecognized strings', () => {
    expect(isMalformedBcryptHash('not-a-hash')).toBe(true)
    expect(isMalformedBcryptHash('$2b$04$' + 'a'.repeat(53))).toBe(false)
  })
})

describe('ScryptDriver — corrupt parameters', () => {
  test('returns false for NaN parameters instead of throwing', async () => {
    const d = new ScryptDriver()
    const corrupt = '$scrypt$N=abc,r=8,p=1,keylen=64$deadbeef$cafebabe'
    expect(await d.verify('password', corrupt)).toBe(false)
  })

  test('returns false for non-positive parameters', async () => {
    const d = new ScryptDriver()
    const corrupt = '$scrypt$N=0,r=8,p=1,keylen=64$deadbeef$cafebabe'
    expect(await d.verify('password', corrupt)).toBe(false)
  })

  test('valid scrypt roundtrip still works', async () => {
    const d = new ScryptDriver({ N: 1024 })
    const hash = await d.make('password')
    expect(await d.verify('password', hash)).toBe(true)
    expect(await d.verify('wrong', hash)).toBe(false)
  })
})
