import { test, expect, describe, beforeAll } from 'bun:test'
import { Encryption } from '../src/index'

// Use a fixed key for all tests so key derivation is deterministic.
const TEST_KEY = 'test-app-key-for-unit-tests-32ch'

// Constructor

describe('Encryption constructor', () => {
  test('accepts an explicit appKey', () => {
    expect(() => new Encryption(TEST_KEY)).not.toThrow()
  })

  test('throws when no appKey is provided and APP_KEY env is absent', () => {
    const original = process.env.APP_KEY
    delete process.env.APP_KEY
    expect(() => new Encryption()).toThrow(/APP_KEY is not set/)
    if (original !== undefined) process.env.APP_KEY = original
  })

  test('reads APP_KEY from the environment when no argument is given', () => {
    process.env.APP_KEY = TEST_KEY
    expect(() => new Encryption()).not.toThrow()
    delete process.env.APP_KEY
  })
})

// encryptString / decryptString

describe('encryptString / decryptString', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('encryptString() returns a non-empty base64 string', async () => {
    const result = await enc.encryptString('hello world')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('decryptString() roundtrips a plain string', async () => {
    const original = 'The quick brown fox'
    const ciphertext = await enc.encryptString(original)
    const recovered = await enc.decryptString(ciphertext)
    expect(recovered).toBe(original)
  })

  test('each encryption produces a different ciphertext (random IV)', async () => {
    const a = await enc.encryptString('same input')
    const b = await enc.encryptString('same input')
    expect(a).not.toBe(b)
  })

  test('decryptString() throws when given a too-short payload', async () => {
    // A base64 string shorter than the IV cannot be valid.
    const tooShort = btoa('tiny')
    await expect(enc.decryptString(tooShort)).rejects.toThrow(/corrupt|invalid|short/i)
  })

  test('decryptString() throws when ciphertext is tampered with', async () => {
    const ciphertext = await enc.encryptString('secret')
    // Flip one character in the middle of the base64 string.
    const mid = Math.floor(ciphertext.length / 2)
    const tampered =
      ciphertext.slice(0, mid) +
      (ciphertext[mid] === 'A' ? 'B' : 'A') +
      ciphertext.slice(mid + 1)
    await expect(enc.decryptString(tampered)).rejects.toThrow()
  })

  test('decryptString() throws when a different key is used', async () => {
    const ciphertext = await enc.encryptString('secret')
    const wrongKeyEnc = new Encryption('completely-different-key-here!!')
    await expect(wrongKeyEnc.decryptString(ciphertext)).rejects.toThrow()
  })

  test('encrypts and decrypts an empty string', async () => {
    const ciphertext = await enc.encryptString('')
    const recovered = await enc.decryptString(ciphertext)
    expect(recovered).toBe('')
  })

  test('encrypts and decrypts a unicode string', async () => {
    const original = 'こんにちは 🌍 مرحبا'
    const ciphertext = await enc.encryptString(original)
    const recovered = await enc.decryptString(ciphertext)
    expect(recovered).toBe(original)
  })
})

// encrypt / decrypt (JSON value helpers)

describe('encrypt / decrypt (JSON values)', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips a plain object', async () => {
    const payload = { userId: 42, role: 'admin' }
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<typeof payload>(token)
    expect(result).toEqual(payload)
  })

  test('roundtrips a nested object', async () => {
    const payload = { user: { id: 1, permissions: ['read', 'write'] }, meta: { ts: 12345 } }
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<typeof payload>(token)
    expect(result).toEqual(payload)
  })

  test('roundtrips an array', async () => {
    const payload = [1, 'two', { three: 3 }]
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<typeof payload>(token)
    expect(result).toEqual(payload)
  })

  test('roundtrips a number', async () => {
    const token = await enc.encrypt(9876543210)
    expect(await enc.decrypt<any>(token)).toBe(9876543210)
  })

  test('roundtrips a boolean', async () => {
    const t = await enc.encrypt(true)
    const f = await enc.encrypt(false)
    expect(await enc.decrypt<any>(t)).toBe(true)
    expect(await enc.decrypt<any>(f)).toBe(false)
  })

  test('roundtrips null', async () => {
    const token = await enc.encrypt(null)
    expect(await enc.decrypt<any>(token)).toBeNull()
  })

  test('decrypt() throws when ciphertext has been tampered with', async () => {
    const token = await enc.encrypt({ id: 1 })
    const mid = Math.floor(token.length / 2)
    const tampered =
      token.slice(0, mid) +
      (token[mid] === 'A' ? 'B' : 'A') +
      token.slice(mid + 1)
    await expect(enc.decrypt<any>(tampered)).rejects.toThrow()
  })

  test('decrypt() throws a generic error when decrypted bytes are not valid JSON', async () => {
    // Encrypt a raw non-JSON string, then try to decrypt it via decrypt() (JSON path).
    // The external message stays generic (no JSON-vs-tamper oracle).
    const raw = await enc.encryptString('not-json{{{}')
    await expect(enc.decrypt<any>(raw)).rejects.toThrow(/Decryption failed/)
  })

  test('key derivation produces consistent roundtrips across calls', async () => {
    // If derivation were broken the tokens should still roundtrip.
    const a = await enc.encrypt({ x: 1 })
    const b = await enc.encrypt({ y: 2 })
    expect(await enc.decrypt<{ x: number }>(a)).toEqual({ x: 1 })
    expect(await enc.decrypt<{ y: number }>(b)).toEqual({ y: 2 })
  })
})

// encrypt / decrypt — additional type and ciphertext coverage

describe('encrypt / decrypt — additional types', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips a string value via encrypt/decrypt', async () => {
    const token = await enc.encrypt('hello string')
    expect(await enc.decrypt<any>(token)).toBe('hello string')
  })

  test('roundtrips a large nested object', async () => {
    const payload = {
      user: { id: 99, name: 'Alice', roles: ['admin', 'editor'] },
      meta: { createdAt: '2024-01-01', tags: [1, 2, 3] },
    }
    const token = await enc.encrypt(payload)
    expect(await enc.decrypt<any>(token)).toEqual(payload)
  })

  test('roundtrips an empty array', async () => {
    const token = await enc.encrypt([])
    expect(await enc.decrypt<any>(token)).toEqual([])
  })

  test('roundtrips zero as a number', async () => {
    const token = await enc.encrypt(0)
    expect(await enc.decrypt<any>(token)).toBe(0)
  })

  test('same plaintext produces different ciphertext on each encrypt() call', async () => {
    const a = await enc.encrypt({ key: 'value' })
    const b = await enc.encrypt({ key: 'value' })
    expect(a).not.toBe(b)
  })

  test('tampered encrypt() ciphertext throws on decrypt()', async () => {
    const token = await enc.encrypt({ secret: 42 })
    const mid = Math.floor(token.length / 2)
    const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1)
    await expect(enc.decrypt<any>(tampered)).rejects.toThrow()
  })

  test('wrong key on encrypt() value throws on decrypt()', async () => {
    const token = await enc.encrypt({ id: 7 })
    const wrongEnc = new Encryption('a-totally-different-secret-key!!')
    await expect(wrongEnc.decrypt(token)).rejects.toThrow()
  })
})

// Constants — verify exported values

import { ALGORITHM, KEY_LENGTH, IV_LENGTH, SALT_LENGTH, PAYLOAD_VERSION, MIN_APP_KEY_LENGTH, PBKDF2_ITERATIONS, PBKDF2_HASH } from '../src/index'

describe('Encryption constants', () => {
  test('ALGORITHM is AES-GCM', () => {
    expect(ALGORITHM).toBe('AES-GCM')
  })

  test('KEY_LENGTH is 256 bits', () => {
    expect(KEY_LENGTH).toBe(256)
  })

  test('IV_LENGTH is 12 bytes', () => {
    expect(IV_LENGTH).toBe(12)
  })

  test('PBKDF2_ITERATIONS is a positive number', () => {
    expect(typeof PBKDF2_ITERATIONS).toBe('number')
    expect(PBKDF2_ITERATIONS).toBeGreaterThan(0)
    expect(PBKDF2_ITERATIONS).toBe(200_000)
  })

  test('PBKDF2_HASH is SHA-256', () => {
    expect(PBKDF2_HASH).toBe('SHA-256')
  })

  test('SALT_LENGTH is 16 bytes', () => {
    expect(SALT_LENGTH).toBe(16)
  })

  test('PAYLOAD_VERSION is 1', () => {
    expect(PAYLOAD_VERSION).toBe(1)
  })

  test('MIN_APP_KEY_LENGTH is a positive number', () => {
    expect(typeof MIN_APP_KEY_LENGTH).toBe('number')
    expect(MIN_APP_KEY_LENGTH).toBeGreaterThan(0)
  })
})

// encryptString — produces different output each time (random IV)

describe('encryptString — random IV uniqueness', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('ten encryptions of the same string all produce different ciphertext', async () => {
    const results = new Set<string>()
    for (let i = 0; i < 10; i++) {
      results.add(await enc.encryptString('identical input'))
    }
    expect(results.size).toBe(10)
  })
})

// decryptString — empty string input

describe('decryptString — edge cases', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('decryptString with empty string throws (not valid base64 ciphertext)', async () => {
    await expect(enc.decryptString('')).rejects.toThrow()
  })
})

// encrypt/decrypt — deeply nested objects, arrays, Date-like strings

describe('encrypt / decrypt — complex data structures', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips deeply nested objects', async () => {
    const payload = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: 'deep',
              numbers: [1, 2, 3],
            },
          },
        },
      },
    }
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<any>(token)
    expect(result).toEqual(payload)
  })

  test('roundtrips array of objects', async () => {
    const payload = [
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 'Bob', active: false },
      { id: 3, name: 'Charlie', active: true },
    ]
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<any>(token)
    expect(result).toEqual(payload)
  })

  test('roundtrips Date-like strings', async () => {
    const payload = {
      createdAt: '2025-01-15T10:30:00.000Z',
      updatedAt: '2025-06-20T14:45:30.123Z',
      dates: ['2024-12-25', '2025-01-01'],
    }
    const token = await enc.encrypt(payload)
    const result = await enc.decrypt<any>(token)
    expect(result).toEqual(payload)
  })
})

// Constructor — empty key and very long key

describe('Encryption constructor — key edge cases', () => {
  test('constructor with empty string key throws', () => {
    expect(() => new Encryption('')).toThrow(/APP_KEY is not set/)
  })

  test('constructor with very long key works', async () => {
    const longKey = 'abcdefghij'.repeat(100)
    const enc = new Encryption(longKey)
    const ct = await enc.encryptString('test')
    const pt = await enc.decryptString(ct)
    expect(pt).toBe('test')
  })

  test('constructor rejects a single character key (too weak)', () => {
    expect(() => new Encryption('x')).toThrow(/too short/)
  })

  test('constructor rejects low-entropy key (too few distinct chars)', () => {
    expect(() => new Encryption('aaaaaaaaaaaaaaaaaaaa')).toThrow(/too little entropy/)
  })
})

// Encrypted output format — base64, contains IV

describe('Encrypted output format', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('encrypted output is valid base64', async () => {
    const ct = await enc.encryptString('test data')
    // Base64 only contains A-Z, a-z, 0-9, +, /, =
    expect(ct).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  test('encrypted output is long enough to contain IV + ciphertext', async () => {
    const ct = await enc.encryptString('x')
    // Decode from base64 and check length > IV_LENGTH (12 bytes)
    const decoded = atob(ct)
    expect(decoded.length).toBeGreaterThan(IV_LENGTH)
  })

  test('encrypted output of longer plaintext produces longer ciphertext', async () => {
    const short = await enc.encryptString('a')
    const long = await enc.encryptString('a'.repeat(10000))
    expect(long.length).toBeGreaterThan(short.length)
  })
})

// Multiple encrypt/decrypt cycles on same instance

describe('Multiple encrypt/decrypt cycles on same instance', () => {
  test('same instance handles many sequential operations correctly', async () => {
    const enc = new Encryption(TEST_KEY)
    for (let i = 0; i < 20; i++) {
      const original = `message-${i}-${Math.random()}`
      const ct = await enc.encryptString(original)
      const pt = await enc.decryptString(ct)
      expect(pt).toBe(original)
    }
  })

  test('same instance handles interleaved encrypt and JSON operations', async () => {
    const enc = new Encryption(TEST_KEY)
    const stringCt = await enc.encryptString('raw string')
    const jsonCt = await enc.encrypt({ key: 'value' })
    const anotherStringCt = await enc.encryptString('another string')

    expect(await enc.decryptString(stringCt)).toBe('raw string')
    expect(await enc.decrypt<any>(jsonCt)).toEqual({ key: 'value' })
    expect(await enc.decryptString(anotherStringCt)).toBe('another string')
  })
})

// encryptString / decryptString — additional unicode and edge-case coverage

describe('encryptString / decryptString — additional coverage', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips a string with special characters', async () => {
    const original = '!@#$%^&*()_+-=[]{}|;\':",./<>?'
    const ct = await enc.encryptString(original)
    expect(await enc.decryptString(ct)).toBe(original)
  })

  test('roundtrips a multi-line string', async () => {
    const original = 'line one\nline two\nline three'
    const ct = await enc.encryptString(original)
    expect(await enc.decryptString(ct)).toBe(original)
  })

  test('roundtrips a long string (4096 chars)', async () => {
    const original = 'x'.repeat(4096)
    const ct = await enc.encryptString(original)
    expect(await enc.decryptString(ct)).toBe(original)
  })

  test('empty string encryptString produces non-empty ciphertext', async () => {
    const ct = await enc.encryptString('')
    expect(ct.length).toBeGreaterThan(0)
  })

  test('two encryptions of the same empty string differ', async () => {
    const a = await enc.encryptString('')
    const b = await enc.encryptString('')
    expect(a).not.toBe(b)
  })

  test('wrong key throws on decryptString', async () => {
    const ct = await enc.encryptString('sensitive')
    const wrongEnc = new Encryption('wrong-key-padded-to-thirty-two!!!')
    await expect(wrongEnc.decryptString(ct)).rejects.toThrow()
  })
})

// Additional encryption tests

describe('Encryption — encrypt/decrypt JSON additional', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips array', async () => {
    const data = [1, 'two', { three: 3 }, [4]]
    const ct = await enc.encrypt(data)
    expect(await enc.decrypt<any>(ct)).toEqual(data)
  })

  test('roundtrips deeply nested object', async () => {
    const data = { a: { b: { c: { d: { e: 'deep' } } } } }
    const ct = await enc.encrypt(data)
    expect(await enc.decrypt<any>(ct)).toEqual(data)
  })

  test('roundtrips null', async () => {
    const ct = await enc.encrypt(null)
    expect(await enc.decrypt<any>(ct)).toBeNull()
  })

  test('roundtrips boolean', async () => {
    const ctTrue = await enc.encrypt(true)
    const ctFalse = await enc.encrypt(false)
    expect(await enc.decrypt<any>(ctTrue)).toBe(true)
    expect(await enc.decrypt<any>(ctFalse)).toBe(false)
  })

  test('roundtrips number', async () => {
    const ct = await enc.encrypt(42.5)
    expect(await enc.decrypt<any>(ct)).toBe(42.5)
  })

  test('roundtrips empty object', async () => {
    const ct = await enc.encrypt({})
    expect(await enc.decrypt<any>(ct)).toEqual({})
  })

  test('roundtrips empty array', async () => {
    const ct = await enc.encrypt([])
    expect(await enc.decrypt<any>(ct)).toEqual([])
  })

  test('different JSON values produce different ciphertexts', async () => {
    const a = await enc.encrypt({ key: 'a' })
    const b = await enc.encrypt({ key: 'b' })
    expect(a).not.toBe(b)
  })

  test('same JSON encrypted twice produces different ciphertexts', async () => {
    const data = { same: true }
    const a = await enc.encrypt(data)
    const b = await enc.encrypt(data)
    expect(a).not.toBe(b)
  })

  test('roundtrips string with quotes', async () => {
    const str = 'He said "hello" and she said \'hi\''
    const ct = await enc.encryptString(str)
    expect(await enc.decryptString(ct)).toBe(str)
  })

  test('roundtrips unicode emoji', async () => {
    const str = '🚀🎉💡🔥'
    const ct = await enc.encryptString(str)
    expect(await enc.decryptString(ct)).toBe(str)
  })

  test('roundtrips JSON with unicode', async () => {
    const data = { greeting: 'こんにちは', emoji: '🌍' }
    const ct = await enc.encrypt(data)
    expect(await enc.decrypt<any>(ct)).toEqual(data)
  })

  test('large object roundtrip', async () => {
    const data: Record<string, number> = {}
    for (let i = 0; i < 100; i++) data[`key${i}`] = i
    const ct = await enc.encrypt(data)
    expect(await enc.decrypt<any>(ct)).toEqual(data)
  })

  test('ciphertext is a string', async () => {
    const ct = await enc.encrypt({ test: true })
    expect(typeof ct).toBe('string')
  })

  test('ciphertext is non-empty', async () => {
    const ct = await enc.encrypt({})
    expect(ct.length).toBeGreaterThan(0)
  })
})

// NEW TESTS: Deep edge cases for Encryption

describe('Encryption — binary-like data', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips string with null bytes', async () => {
    const original = 'before\x00after'
    const ct = await enc.encryptString(original)
    const pt = await enc.decryptString(ct)
    expect(pt).toBe(original)
  })

  test('roundtrips string with tab and newline chars', async () => {
    const original = 'line1\n\tline2\r\nline3'
    const ct = await enc.encryptString(original)
    expect(await enc.decryptString(ct)).toBe(original)
  })

  test('roundtrips very long string (64KB)', async () => {
    const original = 'A'.repeat(65536)
    const ct = await enc.encryptString(original)
    expect(await enc.decryptString(ct)).toBe(original)
  })
})

describe('Encryption — key edge cases', () => {
  test('two instances with same key can decrypt each others ciphertext', async () => {
    const enc1 = new Encryption(TEST_KEY)
    const enc2 = new Encryption(TEST_KEY)
    const ct = await enc1.encryptString('shared secret')
    expect(await enc2.decryptString(ct)).toBe('shared secret')
  })

  test('two instances with different keys cannot decrypt each others ciphertext', async () => {
    const enc1 = new Encryption('key-alpha-32-characters-long!!!!!')
    const enc2 = new Encryption('key-beta-32-characters-long!!!!!!')
    const ct = await enc1.encryptString('private')
    await expect(enc2.decryptString(ct)).rejects.toThrow()
  })

  test('key with special characters works', async () => {
    const enc = new Encryption('key!@#$%^&*()_+-=[]{}|;:,./<>?')
    const ct = await enc.encryptString('test')
    expect(await enc.decryptString(ct)).toBe('test')
  })

  test('key with unicode characters works', async () => {
    const enc = new Encryption('密钥测试-key-for-tests')
    const ct = await enc.encryptString('hello')
    expect(await enc.decryptString(ct)).toBe('hello')
  })
})

describe('Encryption — decrypt error paths', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('decrypt with completely invalid base64 throws', async () => {
    await expect(enc.decryptString('not!!valid!!base64')).rejects.toThrow()
  })

  test('decrypt with truncated ciphertext throws', async () => {
    const ct = await enc.encryptString('hello world')
    const truncated = ct.slice(0, 10)
    await expect(enc.decryptString(truncated)).rejects.toThrow()
  })

  test('decrypt JSON with mangled payload throws', async () => {
    const ct = await enc.encrypt({ key: 'value' })
    // Swap two chars in the middle
    const mid = Math.floor(ct.length / 2)
    const mangled = ct.slice(0, mid - 1) + ct[mid] + ct[mid - 1] + ct.slice(mid + 1)
    await expect(enc.decrypt<any>(mangled)).rejects.toThrow()
  })

  test('encrypt then decrypt with prepended garbage throws', async () => {
    const ct = await enc.encryptString('test')
    const garbage = 'AAAA' + ct
    await expect(enc.decryptString(garbage)).rejects.toThrow()
  })
})

describe('Encryption — concurrent operations', () => {
  test('parallel encryptions all produce unique ciphertexts', async () => {
    const enc = new Encryption(TEST_KEY)
    const promises = Array.from({ length: 10 }, (_, i) => enc.encryptString(`msg-${i}`))
    const results = await Promise.all(promises)
    const unique = new Set(results)
    expect(unique.size).toBe(10)
  })

  test('parallel encrypt/decrypt roundtrips all succeed', async () => {
    const enc = new Encryption(TEST_KEY)
    const messages = Array.from({ length: 10 }, (_, i) => `parallel-${i}`)
    const ciphertexts = await Promise.all(messages.map(m => enc.encryptString(m)))
    const plaintexts = await Promise.all(ciphertexts.map(ct => enc.decryptString(ct)))
    expect(plaintexts).toEqual(messages)
  })
})

describe('Encryption — JSON with special types', () => {
  let enc: Encryption

  beforeAll(() => {
    enc = new Encryption(TEST_KEY)
  })

  test('roundtrips object with undefined values (dropped by JSON)', async () => {
    const data = { a: 1, b: undefined }
    const ct = await enc.encrypt(data)
    const result = await enc.decrypt<any>(ct)
    // JSON.stringify drops undefined values
    expect(result).toEqual({ a: 1 })
  })

  test('roundtrips negative numbers', async () => {
    const ct = await enc.encrypt(-42.5)
    expect(await enc.decrypt<any>(ct)).toBe(-42.5)
  })

  test('roundtrips Infinity as null (JSON converts Infinity to null)', async () => {
    const ct = await enc.encrypt(Infinity)
    expect(await enc.decrypt<any>(ct)).toBeNull()
  })

  test('roundtrips empty string via encrypt/decrypt', async () => {
    const ct = await enc.encrypt('')
    expect(await enc.decrypt<any>(ct)).toBe('')
  })

  test('roundtrips nested arrays', async () => {
    const data = [[1, 2], [3, [4, 5]]]
    const ct = await enc.encrypt(data)
    expect(await enc.decrypt<any>(ct)).toEqual(data)
  })
})
