import { test, expect, describe } from 'bun:test'
import { Encryption } from '../src/encryption'

describe('Encryption — key derivation', () => {
  test('different keys produce different ciphertexts', async () => {
    const e1 = new Encryption('key-one-test-value-12345')
    const e2 = new Encryption('key-two-test-value-67890')
    expect(await e1.encryptString('hello')).not.toBe(await e2.encryptString('hello'))
  })

  test('same key encrypts and decrypts consistently', async () => {
    const enc = new Encryption('my-test-app-key-for-security')
    expect(await enc.decryptString(await enc.encryptString('sensitive'))).toBe('sensitive')
  })

  test('wrong key cannot decrypt', async () => {
    const e1 = new Encryption('correct-key-1234567890ab')
    const e2 = new Encryption('wrong-key-0987654321zy')
    await expect(e2.decryptString(await e1.encryptString('secret'))).rejects.toThrow()
  })

  test('each encryption produces unique ciphertext (random IV)', async () => {
    const enc = new Encryption('iv-uniqueness-test-key!!')
    const c1 = await enc.encryptString('same')
    const c2 = await enc.encryptString('same')
    expect(c1).not.toBe(c2)
  })
})

describe('Encryption — JSON values', () => {
  test('encrypt/decrypt objects', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    const data = { userId: 1, role: 'admin', perms: ['read', 'write'] }
    expect(await enc.decrypt<any>(await enc.encrypt(data))).toEqual(data)
  })

  test('encrypt/decrypt arrays', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    expect(await enc.decrypt<any>(await enc.encrypt([1, 2, 3]))).toEqual([1, 2, 3])
  })

  test('encrypt/decrypt strings', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    expect(await enc.decrypt<any>(await enc.encrypt('hello'))).toBe('hello')
  })

  test('encrypt/decrypt numbers', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    expect(await enc.decrypt<any>(await enc.encrypt(42))).toBe(42)
  })

  test('encrypt/decrypt booleans', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    expect(await enc.decrypt<any>(await enc.encrypt(true))).toBe(true)
  })

  test('encrypt/decrypt null', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    expect(await enc.decrypt<any>(await enc.encrypt(null))).toBeNull()
  })

  test('encrypt/decrypt nested objects', async () => {
    const enc = new Encryption('json-test-key-abcdef1234')
    const data = { a: { b: { c: { d: 'deep' } } } }
    expect(await enc.decrypt<any>(await enc.encrypt(data))).toEqual(data)
  })
})

describe('Encryption — edge cases', () => {
  test('empty string encrypts/decrypts', async () => {
    const enc = new Encryption('edge-case-test-key-12345')
    expect(await enc.decryptString(await enc.encryptString(''))).toBe('')
  })

  test('long string encrypts/decrypts', async () => {
    const enc = new Encryption('edge-case-test-key-12345')
    const long = 'x'.repeat(100000)
    expect(await enc.decryptString(await enc.encryptString(long))).toBe(long)
  })

  test('unicode encrypts/decrypts', async () => {
    const enc = new Encryption('edge-case-test-key-12345')
    expect(await enc.decryptString(await enc.encryptString('Merhaba dünya 🌍'))).toBe('Merhaba dünya 🌍')
  })

  test('special chars encrypt/decrypt', async () => {
    const enc = new Encryption('edge-case-test-key-12345')
    const special = '<script>alert("xss")</script>&foo=bar'
    expect(await enc.decryptString(await enc.encryptString(special))).toBe(special)
  })

  test('throws without APP_KEY', () => {
    const origKey = process.env.APP_KEY
    delete process.env.APP_KEY
    expect(() => new Encryption('')).toThrow('APP_KEY is not set')
    if (origKey) process.env.APP_KEY = origKey
  })

  test('tampered ciphertext fails', async () => {
    const enc = new Encryption('tamper-test-key-1234567!')
    const cipher = await enc.encryptString('hello')
    const tampered = cipher.slice(0, -3) + 'xxx'
    await expect(enc.decryptString(tampered)).rejects.toThrow()
  })

  test('truncated ciphertext fails', async () => {
    const enc = new Encryption('tamper-test-key-1234567!')
    await expect(enc.decryptString('dG9vc2hvcnQ')).rejects.toThrow()
  })

  test('ciphertext is base64 encoded', async () => {
    const enc = new Encryption('base64-test-key-12345678')
    const cipher = await enc.encryptString('test')
    expect(/^[A-Za-z0-9+/=]+$/.test(cipher)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════
// APP_KEY validation
// ═══════════════════════════════════════════════════════════

describe('Encryption — APP_KEY validation', () => {
  const savedEnv = process.env.APP_KEY

  test('rejects keys shorter than the minimum', () => {
    delete process.env.APP_KEY
    expect(() => new Encryption('short')).toThrow(/too short/)
    expect(() => new Encryption('abcdef')).toThrow(/too short/)
    if (savedEnv) process.env.APP_KEY = savedEnv
  })

  test('rejects low-entropy keys (too few distinct chars)', () => {
    expect(() => new Encryption('aaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(/too little entropy/)
    expect(() => new Encryption('ababababababababababab')).toThrow(/too little entropy/)
  })

  test('accepts a sufficiently long, varied key', () => {
    expect(() => new Encryption('a-reasonably-strong-key-9182')).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
// Random salt format
// ═══════════════════════════════════════════════════════════

describe('Encryption — random salt', () => {
  test('two installs sharing an APP_KEY produce different salts (no shared derived key precompute)', async () => {
    const e1 = new Encryption('shared-app-key-for-salt-test!')
    // Decode both ciphertexts of the same plaintext and confirm the salt
    // segment (bytes 1..17) differs across encryptions.
    const c1 = await e1.encryptString('x')
    const c2 = await e1.encryptString('x')
    const b1 = Uint8Array.from(atob(c1), (ch) => ch.charCodeAt(0))
    const b2 = Uint8Array.from(atob(c2), (ch) => ch.charCodeAt(0))
    expect(b1[0]).toBe(1) // version byte
    const salt1 = b1.slice(1, 17)
    const salt2 = b2.slice(1, 17)
    expect(Buffer.from(salt1).equals(Buffer.from(salt2))).toBe(false)
  })

  test('payload begins with version byte 1', async () => {
    const enc = new Encryption('version-byte-check-key-12345')
    const ct = await enc.encryptString('hello')
    const bytes = Uint8Array.from(atob(ct), (ch) => ch.charCodeAt(0))
    expect(bytes[0]).toBe(1)
  })

  test('roundtrip still works with random salt', async () => {
    const enc = new Encryption('roundtrip-random-salt-key-99')
    expect(await enc.decryptString(await enc.encryptString('secret'))).toBe('secret')
  })
})

// ═══════════════════════════════════════════════════════════
// Backward compatibility with legacy (deterministic-salt) format
// ═══════════════════════════════════════════════════════════

describe('Encryption — legacy format compatibility', () => {
  test('decrypts ciphertext produced by the old deterministic-salt format', async () => {
    const APP = 'legacy-compat-test-key-123'
    // Captured from the pre-random-salt implementation (salt = SHA-256("tekir-salt:"+APP)).
    const legacyCipher = 'eZRLXm0+KyMW9CBMqkIER2WlKG9j/CCd3wskuo/C8BwReva8EBP+XEQ='
    const enc = new Encryption(APP)
    expect(await enc.decryptString(legacyCipher)).toBe('legacy-secret')
  })

  test('decrypts a legacy ciphertext whose IV starts with the v1 version byte', async () => {
    const appKey = 'legacy-version-collision-key-123'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tekir-salt:${appKey}`))
    const salt = new Uint8Array(digest).slice(0, 16)
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(appKey), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    )
    const iv = new Uint8Array(12)
    iv[0] = 1
    crypto.getRandomValues(iv.subarray(1))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('legacy-collision'))
    const payload = Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64')
    expect(await new Encryption(appKey).decryptString(payload)).toBe('legacy-collision')
  })
})
