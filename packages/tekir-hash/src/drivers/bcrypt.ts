import type { HashDriver, BcryptOptions } from '../types'
import { hashBcrypt, verifyBcrypt } from '@tekir/runtime'

// bcrypt only considers the first 72 bytes of the input; anything beyond is
// silently ignored, so two different passwords sharing a 72-byte prefix hash
// identically. We guard against that surprise.
const BCRYPT_MAX_BYTES = 72

/** Hash driver using bcrypt for password hashing. */
export class BcryptDriver implements HashDriver {
  private rounds: number

  /**
   * Create a new BcryptDriver.
   *
   * @param options - Optional {@link BcryptOptions} to configure the cost factor.
   */
  constructor(options: BcryptOptions = {}) {
    this.rounds = options.rounds ?? 12
  }

  /**
   * Hash a plaintext value using bcrypt.
   *
   * @param value - The plaintext string to hash.
   * @returns The bcrypt hash string.
   *
   * @example
   * ```ts
   * const hash = await bcrypt.make('my-password')
   * ```
   */
  async make(value: string): Promise<string> {
    warnIfTruncated(value)
    return hashBcrypt(value, this.rounds)
  }

  /**
   * Verify a plaintext value against a bcrypt hash.
   *
   * @param value - The plaintext string to verify.
   * @param hash - The bcrypt hash to compare against.
   * @returns `true` if the value matches the hash, `false` otherwise.
   *
   * @example
   * ```ts
   * const valid = await bcrypt.verify('my-password', storedHash)
   * ```
   */
  async verify(value: string, hash: string): Promise<boolean> {
    warnIfTruncated(value)
    try {
      return await verifyBcrypt(value, hash)
    } catch (err) {
      // A malformed/unrecognized hash legitimately means "does not match".
      // But infrastructure failures (native module missing, OOM, etc.) must
      // not masquerade as a wrong password — rethrow those so they surface.
      if (isMalformedBcryptHash(hash) || isBcryptFormatError(err)) return false
      throw err
    }
  }

  /**
   * Check whether a bcrypt hash needs to be rehashed due to a different cost factor or algorithm version.
   *
   * @param hash - The bcrypt hash to inspect.
   * @returns `true` if the hash should be regenerated, `false` if it is current.
   *
   * @example
   * ```ts
   * if (bcrypt.needsRehash(storedHash)) {
   *   const newHash = await bcrypt.make(plaintext)
   * }
   * ```
   */
  needsRehash(hash: string): boolean {
    if (!hash.startsWith("$2b$") && !hash.startsWith("$2a$")) return true
    const parts = hash.split("$")
    if (parts.length < 3) return true
    const hashCost = Number(parts[2])
    return isNaN(hashCost) || hashCost !== this.rounds
  }
}

/** Warn (once-ish) when a value exceeds bcrypt's 72-byte effective limit. */
function warnIfTruncated(value: string): void {
  if (new TextEncoder().encode(value).length > BCRYPT_MAX_BYTES) {
    console.warn(
      `[@tekir/hash] bcrypt only uses the first ${BCRYPT_MAX_BYTES} bytes of the input; ` +
      'the remainder is ignored. Pre-hash long passphrases (e.g. SHA-256) before hashing, ' +
      'or use the argon2/scrypt driver.',
    )
  }
}

/** A bcrypt hash that isn't a recognized $2a$/$2b$/$2y$ string is "malformed". */
export function isMalformedBcryptHash(hash: string): boolean {
  return !/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)
}

// Runtime errors that signal a bad/undecodable hash string rather than a
// genuine infrastructure failure. These map to "does not match".
export function isBcryptFormatError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? ''
  const msg = (err as { message?: string })?.message ?? ''
  return /INVALID_ENCODING|INVALID_HASH|INVALID_SALT|InvalidEncoding/i.test(`${code} ${msg}`)
}
