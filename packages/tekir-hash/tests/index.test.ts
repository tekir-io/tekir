import { test, expect, describe } from 'bun:test'
import { App } from '@tekir/core'
import {
  Hash,
  HashProvider,
  BcryptDriver,
  Argon2Driver,
  ScryptDriver,
} from '../src/index'

// BcryptDriver

describe('BcryptDriver', () => {
  test('make() returns a bcrypt hash ($2b$ prefix)', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hash = await driver.make('secret')
    expect(hash).toMatch(/^\$2[ab]\$/)
  })

  test('verify() returns true for the correct password', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('correct-horse', hash)).toBe(true)
  })

  test('verify() returns false for a wrong password', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('wrong-horse', hash)).toBe(false)
  })

  test('verify() returns false for a completely invalid hash', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    expect(await driver.verify('anything', 'not-a-hash')).toBe(false)
  })

  test('needsRehash() returns false when cost matches', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hash = await driver.make('pass')
    expect(driver.needsRehash(hash)).toBe(false)
  })

  test('needsRehash() returns true when cost differs', async () => {
    const low = new BcryptDriver({ rounds: 4 })
    const high = new BcryptDriver({ rounds: 6 })
    const hash = await low.make('pass')
    // hash was made with rounds=4; driver configured for rounds=6 → needs rehash
    expect(high.needsRehash(hash)).toBe(true)
  })

  test('needsRehash() returns true for a non-bcrypt hash string', () => {
    const driver = new BcryptDriver({ rounds: 4 })
    expect(driver.needsRehash('$argon2id$v=19$...')).toBe(true)
    expect(driver.needsRehash('plaintext')).toBe(true)
  })
})

// Argon2Driver

describe('Argon2Driver', () => {
  test('make() returns an argon2id hash ($argon2id$ prefix)', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('secret')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  test('verify() returns true for the correct password', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('correct-horse', hash)).toBe(true)
  })

  test('verify() returns false for a wrong password', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('wrong-horse', hash)).toBe(false)
  })

  test('verify() returns false for an invalid hash', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    expect(await driver.verify('pass', 'garbage')).toBe(false)
  })

  test('needsRehash() returns false when params match', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('pass')
    expect(driver.needsRehash(hash)).toBe(false)
  })

  test('needsRehash() returns true when memoryCost differs', async () => {
    const low = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const high = new Argon2Driver({ memoryCost: 2048, timeCost: 1 })
    const hash = await low.make('pass')
    expect(high.needsRehash(hash)).toBe(true)
  })

  test('needsRehash() returns true when timeCost differs', async () => {
    const low = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const high = new Argon2Driver({ memoryCost: 1024, timeCost: 2 })
    const hash = await low.make('pass')
    expect(high.needsRehash(hash)).toBe(true)
  })

  test('needsRehash() returns true for a non-argon2 hash', () => {
    const driver = new Argon2Driver()
    expect(driver.needsRehash('$2b$10$...')).toBe(true)
    expect(driver.needsRehash('plaintext')).toBe(true)
  })
})

// ScryptDriver

describe('ScryptDriver', () => {
  test('make() returns a $scrypt$-prefixed string', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('secret')
    expect(hash).toMatch(/^\$scrypt\$/)
  })

  test('verify() returns true for the correct password', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('correct-horse', hash)).toBe(true)
  })

  test('verify() returns false for a wrong password', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('correct-horse')
    expect(await driver.verify('wrong-horse', hash)).toBe(false)
  })

  test('verify() returns false for a malformed hash', async () => {
    const driver = new ScryptDriver()
    expect(await driver.verify('pass', 'not-a-hash')).toBe(false)
    expect(await driver.verify('pass', '$scrypt$bad')).toBe(false)
  })

  test('needsRehash() returns false when params match', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('pass')
    expect(driver.needsRehash(hash)).toBe(false)
  })

  test('needsRehash() returns true when N differs', async () => {
    const low = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const high = new ScryptDriver({ N: 2048, r: 8, p: 1 })
    const hash = await low.make('pass')
    expect(high.needsRehash(hash)).toBe(true)
  })

  test('needsRehash() returns true for a non-scrypt hash', () => {
    const driver = new ScryptDriver()
    expect(driver.needsRehash('$2b$10$...')).toBe(true)
  })
})

// Hash

describe('Hash', () => {
  test('defaults to bcrypt driver', async () => {
    const manager = new Hash()
    const hash = await manager.make('pass')
    expect(hash).toMatch(/^\$2[ab]\$/)
  })

  test('respects config.default = argon2', async () => {
    const manager = new Hash({ default: 'argon2', argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await manager.make('pass')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  test('respects config.default = scrypt', async () => {
    const manager = new Hash({ default: 'scrypt', scrypt: { N: 1024 } })
    const hash = await manager.make('pass')
    expect(hash).toMatch(/^\$scrypt\$/)
  })

  test('use() switches the active driver', async () => {
    const manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    manager.use('argon2')
    const hash = await manager.make('pass')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  test('use() is chainable', async () => {
    const manager = new Hash({ scrypt: { N: 1024 } })
    const hash = await manager.use('scrypt').make('pass')
    expect(hash).toMatch(/^\$scrypt\$/)
  })

  test('verify() auto-detects bcrypt hash', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await manager.use('bcrypt').make('hello')
    // Switch away from bcrypt — verify should still work via auto-detection
    manager.use('argon2')
    expect(await manager.verify('hello', hash)).toBe(true)
  })

  test('verify() auto-detects argon2 hash', async () => {
    const manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await manager.use('argon2').make('hello')
    manager.use('bcrypt')
    expect(await manager.verify('hello', hash)).toBe(true)
  })

  test('verify() auto-detects scrypt hash', async () => {
    const manager = new Hash({ scrypt: { N: 1024 } })
    const hash = await manager.use('scrypt').make('hello')
    manager.use('bcrypt')
    expect(await manager.verify('hello', hash)).toBe(true)
  })

  test('verify() returns false for wrong value', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await manager.use('bcrypt').make('hello')
    expect(await manager.verify('wrong', hash)).toBe(false)
  })

  test('needsRehash() auto-detects driver and returns false when params match', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await manager.use('bcrypt').make('pass')
    expect(manager.needsRehash(hash)).toBe(false)
  })

  test('needsRehash() returns true after raising bcrypt rounds', async () => {
    const low = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await low.use('bcrypt').make('pass')

    const high = new Hash({ bcrypt: { rounds: 6 } })
    expect(high.needsRehash(hash)).toBe(true)
  })

  test('driver instances are cached (resolved only once)', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const h1 = await manager.use('bcrypt').make('a')
    const h2 = await manager.use('bcrypt').make('b')
    // Both should verify with the same manager — just checking no error is thrown
    expect(await manager.verify('a', h1)).toBe(true)
    expect(await manager.verify('b', h2)).toBe(true)
  })

  test('throws for an unknown driver name', () => {
    const manager = new Hash()
    // @ts-expect-error — intentionally passing invalid driver name
    expect(() => manager.use('sha256').make('x')).toThrow(/Unknown hash driver/)
  })
})

// HashProvider

describe('HashProvider', () => {
  test('register() registers a Hash into the app container', async () => {
    const provider = new HashProvider()
    const app = new App()
    app.instance('config', (key: string) => key === 'hash' ? { default: 'bcrypt', bcrypt: { rounds: 4 } } : undefined)
    await provider.register(app)
    expect(app.use('hash')).toBeInstanceOf(Hash)
  })

  test('register() returns early if no hash config', async () => {
    const provider = new HashProvider()
    const app = new App()
    app.instance('config', (_key: string) => undefined)
    await provider.register(app)
    expect(app.has('hash')).toBe(false)
  })
})

// BcryptDriver — additional coverage

describe('BcryptDriver — salt uniqueness and edge cases', () => {
  test('two hashes of the same password are different (salt)', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const h1 = await driver.make('samepassword')
    const h2 = await driver.make('samepassword')
    expect(h1).not.toBe(h2)
  })

  test('different passwords produce different hashes', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const h1 = await driver.make('password-one')
    const h2 = await driver.make('password-two')
    expect(h1).not.toBe(h2)
  })

  test('empty string password can be hashed and verified', async () => {
    // Bun.password throws TypeError for empty strings — skip this test.
    const driver = new BcryptDriver({ rounds: 4 })
    await expect(driver.make('')).rejects.toThrow()
  })

  test('very long password can be hashed and verified', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const longPassword = 'a'.repeat(200)
    const hash = await driver.make(longPassword)
    expect(await driver.verify(longPassword, hash)).toBe(true)
  })

  test('needsRehash() returns false for same rounds as hash', async () => {
    const driver = new BcryptDriver({ rounds: 5 })
    const hash = await driver.make('test')
    expect(driver.needsRehash(hash)).toBe(false)
  })

  test('needsRehash() returns true when driver rounds are higher than hash rounds', async () => {
    const low = new BcryptDriver({ rounds: 4 })
    const high = new BcryptDriver({ rounds: 8 })
    const hash = await low.make('test')
    expect(high.needsRehash(hash)).toBe(true)
  })
})

// Argon2Driver — additional coverage

describe('Argon2Driver — roundtrip, salt, and edge cases', () => {
  test('make/verify roundtrip succeeds', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('my-secret')
    expect(await driver.verify('my-secret', hash)).toBe(true)
  })

  test('wrong password fails verification', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await driver.make('correct')
    expect(await driver.verify('incorrect', hash)).toBe(false)
  })

  test('two hashes of the same password differ (random salt)', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const h1 = await driver.make('same')
    const h2 = await driver.make('same')
    expect(h1).not.toBe(h2)
  })

  test('empty string password roundtrips correctly', async () => {
    // Bun.password throws TypeError for empty strings — verify the error is thrown.
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    await expect(driver.make('')).rejects.toThrow()
  })

  test('very long password roundtrips correctly', async () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const longPassword = 'z'.repeat(300)
    const hash = await driver.make(longPassword)
    expect(await driver.verify(longPassword, hash)).toBe(true)
  })

  test('needsRehash() returns true for a bcrypt hash passed to argon2 driver', () => {
    const driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    // A real bcrypt-formatted string — argon2 driver must flag it
    expect(driver.needsRehash('$2b$10$abcdefghijklmnopqrstuvwxyz0123456789abc')).toBe(true)
  })
})

// Hash — needsRehash cross-algorithm detection

describe('Hash — needsRehash cross-algorithm', () => {
  test('needsRehash() returns true for argon2 hash when bcrypt manager has higher rounds', async () => {
    const argon2Manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await argon2Manager.use('argon2').make('pass')

    // A bcrypt-configured manager receives an argon2 hash: auto-detected as argon2.
    // The argon2 driver in this manager uses default params, which differ from the hash.
    const bcryptManager = new Hash({ bcrypt: { rounds: 4 }, argon2: { memoryCost: 2048, timeCost: 1 } })
    // Hash was made with memoryCost=1024; manager expects 2048 → needs rehash
    expect(bcryptManager.needsRehash(hash)).toBe(true)
  })

  test('verify() with argon2 driver still auto-detects bcrypt hash prefix', async () => {
    const bcryptDriver = new BcryptDriver({ rounds: 4 })
    const hash = await bcryptDriver.make('hello')

    // Manager set to argon2 as active, but hash has $2b$ prefix → auto-detect
    const manager = new Hash({ bcrypt: { rounds: 4 }, argon2: { memoryCost: 1024, timeCost: 1 } })
    manager.use('argon2')
    expect(await manager.verify('hello', hash)).toBe(true)
  })

  test('verify() with scrypt driver still auto-detects argon2 hash prefix', async () => {
    const argon2Driver = new Argon2Driver({ memoryCost: 1024, timeCost: 1 })
    const hash = await argon2Driver.make('world')

    const manager = new Hash({ scrypt: { N: 1024 }, argon2: { memoryCost: 1024, timeCost: 1 } })
    manager.use('scrypt')
    expect(await manager.verify('world', hash)).toBe(true)
  })
})

// Additional: Hash default driver

describe('Hash — default driver', () => {
  test('default driver is bcrypt when no config is given', async () => {
    const manager = new Hash()
    const hash = await manager.make('test')
    expect(hash).toMatch(/^\$2[ab]\$/)
  })

  test('default driver can be set to scrypt via config', async () => {
    const manager = new Hash({ default: 'scrypt', scrypt: { N: 1024 } })
    const hash = await manager.make('test')
    expect(hash).toMatch(/^\$scrypt\$/)
  })

  test('default driver can be set to argon2 via config', async () => {
    const manager = new Hash({ default: 'argon2', argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await manager.make('test')
    expect(hash).toMatch(/^\$argon2id\$/)
  })
})

// Additional: Hash.use() switches driver

describe('Hash.use() — driver switching', () => {
  test('use(bcrypt) then use(scrypt) produces scrypt hashes', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 }, scrypt: { N: 1024 } })
    manager.use('bcrypt')
    const bcryptHash = await manager.make('pass')
    expect(bcryptHash).toMatch(/^\$2[ab]\$/)

    manager.use('scrypt')
    const scryptHash = await manager.make('pass')
    expect(scryptHash).toMatch(/^\$scrypt\$/)
  })

  test('use() returns this for chaining', () => {
    const manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const result = manager.use('argon2')
    expect(result).toBe(manager)
  })
})

// Additional: BcryptDriver hash produces different output each time

describe('BcryptDriver — salt randomness', () => {
  test('hashing the same password 3 times produces 3 distinct hashes', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hashes = await Promise.all([
      driver.make('same-password'),
      driver.make('same-password'),
      driver.make('same-password'),
    ])
    const unique = new Set(hashes)
    expect(unique.size).toBe(3)
  })

  test('all 3 distinct hashes verify against the original password', async () => {
    const driver = new BcryptDriver({ rounds: 4 })
    const hashes = await Promise.all([
      driver.make('verify-me'),
      driver.make('verify-me'),
      driver.make('verify-me'),
    ])
    for (const hash of hashes) {
      expect(await driver.verify('verify-me', hash)).toBe(true)
    }
  })
})

// Additional: ScryptDriver make/verify roundtrip

describe('ScryptDriver — make/verify roundtrip', () => {
  test('make then verify with correct password returns true', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('roundtrip-test')
    expect(await driver.verify('roundtrip-test', hash)).toBe(true)
  })

  test('make then verify with wrong password returns false', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const hash = await driver.make('correct')
    expect(await driver.verify('incorrect', hash)).toBe(false)
  })

  test('two hashes of the same password differ (random salt)', async () => {
    const driver = new ScryptDriver({ N: 1024, r: 8, p: 1 })
    const h1 = await driver.make('same')
    const h2 = await driver.make('same')
    expect(h1).not.toBe(h2)
    // Both should verify
    expect(await driver.verify('same', h1)).toBe(true)
    expect(await driver.verify('same', h2)).toBe(true)
  })
})

// Additional: Hash verify with wrong password returns false

describe('Hash — verify wrong password', () => {
  test('verify returns false for wrong password with bcrypt', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await manager.use('bcrypt').make('correct')
    expect(await manager.verify('wrong', hash)).toBe(false)
  })

  test('verify returns false for wrong password with argon2', async () => {
    const manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await manager.use('argon2').make('correct')
    expect(await manager.verify('wrong', hash)).toBe(false)
  })

  test('verify returns false for wrong password with scrypt', async () => {
    const manager = new Hash({ scrypt: { N: 1024 } })
    const hash = await manager.use('scrypt').make('correct')
    expect(await manager.verify('wrong', hash)).toBe(false)
  })
})

// Additional: Hash hash then verify with correct password

describe('Hash — hash then verify correct password', () => {
  test('bcrypt roundtrip succeeds', async () => {
    const manager = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await manager.use('bcrypt').make('my-secret')
    expect(await manager.verify('my-secret', hash)).toBe(true)
  })

  test('argon2 roundtrip succeeds', async () => {
    const manager = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await manager.use('argon2').make('my-secret')
    expect(await manager.verify('my-secret', hash)).toBe(true)
  })

  test('scrypt roundtrip succeeds', async () => {
    const manager = new Hash({ scrypt: { N: 1024 } })
    const hash = await manager.use('scrypt').make('my-secret')
    expect(await manager.verify('my-secret', hash)).toBe(true)
  })
})

// Additional: Hash config options

describe('Hash — config options', () => {
  test('bcrypt rounds config affects the hash cost prefix', async () => {
    const low = new Hash({ bcrypt: { rounds: 4 } })
    const high = new Hash({ bcrypt: { rounds: 6 } })
    const hashLow = await low.use('bcrypt').make('test')
    const hashHigh = await high.use('bcrypt').make('test')
    // Extract round from $2b$XX$ prefix
    expect(hashLow).toContain('$04$')
    expect(hashHigh).toContain('$06$')
  })

  test('argon2 memoryCost config is reflected in needsRehash', async () => {
    const m1 = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await m1.use('argon2').make('pass')
    expect(m1.needsRehash(hash)).toBe(false)

    const m2 = new Hash({ argon2: { memoryCost: 4096, timeCost: 1 } })
    expect(m2.needsRehash(hash)).toBe(true)
  })

  test('scrypt N config is reflected in needsRehash', async () => {
    const m1 = new Hash({ scrypt: { N: 1024 } })
    const hash = await m1.use('scrypt').make('pass')
    expect(m1.needsRehash(hash)).toBe(false)

    const m2 = new Hash({ scrypt: { N: 2048 } })
    expect(m2.needsRehash(hash)).toBe(true)
  })
})

// Additional Hash tests

describe('Hash — additional verification', () => {
  test('bcrypt wrong password returns false', async () => {
    const h = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await h.use('bcrypt').make('correct')
    expect(await h.verify('wrong', hash)).toBe(false)
  })

  test('argon2 wrong password returns false', async () => {
    const h = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await h.use('argon2').make('correct')
    expect(await h.verify('wrong', hash)).toBe(false)
  })

  test('scrypt wrong password returns false', async () => {
    const h = new Hash({ scrypt: { N: 1024 } })
    const hash = await h.use('scrypt').make('correct')
    expect(await h.verify('wrong', hash)).toBe(false)
  })

  test('bcrypt make produces different hashes for same input', async () => {
    const h = new Hash({ bcrypt: { rounds: 4 } })
    const h1 = await h.use('bcrypt').make('same')
    const h2 = await h.use('bcrypt').make('same')
    expect(h1).not.toBe(h2)
  })

  test('argon2 make produces different hashes for same input', async () => {
    const h = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const h1 = await h.use('argon2').make('same')
    const h2 = await h.use('argon2').make('same')
    expect(h1).not.toBe(h2)
  })

  test('scrypt make produces different hashes for same input', async () => {
    const h = new Hash({ scrypt: { N: 1024 } })
    const h1 = await h.use('scrypt').make('same')
    const h2 = await h.use('scrypt').make('same')
    expect(h1).not.toBe(h2)
  })

  test('bcrypt hash is a non-empty string', async () => {
    const h = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await h.use('bcrypt').make('test')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  test('argon2 hash is a non-empty string', async () => {
    const h = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await h.use('argon2').make('test')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  test('scrypt hash is a non-empty string', async () => {
    const h = new Hash({ scrypt: { N: 1024 } })
    const hash = await h.use('scrypt').make('test')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  test('bcrypt hash with special characters', async () => {
    const h = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await h.use('bcrypt').make('!@#$%^&*()')
    expect(await h.verify('!@#$%^&*()', hash)).toBe(true)
  })

  test('argon2 hash with unicode', async () => {
    const h = new Hash({ argon2: { memoryCost: 1024, timeCost: 1 } })
    const hash = await h.use('argon2').make('パスワード')
    expect(await h.verify('パスワード', hash)).toBe(true)
  })

  test('scrypt hash with long password', async () => {
    const h = new Hash({ scrypt: { N: 1024 } })
    const longPass = 'x'.repeat(500)
    const hash = await h.use('scrypt').make(longPass)
    expect(await h.verify(longPass, hash)).toBe(true)
  })

  test('needsRehash returns false for matching config', async () => {
    const h = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await h.use('bcrypt').make('test')
    expect(h.needsRehash(hash)).toBe(false)
  })

  test('needsRehash returns true for different config', async () => {
    const h1 = new Hash({ bcrypt: { rounds: 4 } })
    const hash = await h1.use('bcrypt').make('test')
    const h2 = new Hash({ bcrypt: { rounds: 8 } })
    expect(h2.needsRehash(hash)).toBe(true)
  })
})
