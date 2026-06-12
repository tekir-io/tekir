import type { HashDriver, Argon2Options } from '../types'
import { hashArgon2, verifyArgon2 } from '@tekir/runtime'

/** Hash driver using Argon2id for password hashing. */
export class Argon2Driver implements HashDriver {
  private memoryCost: number
  private timeCost: number

  /**
   * Create a new Argon2Driver.
   *
   * @param options - Optional {@link Argon2Options} to configure memory and time cost.
   */
  constructor(options: Argon2Options = {}) {
    this.memoryCost = options.memoryCost ?? 65536
    this.timeCost = options.timeCost ?? 3
  }

  /**
   * Hash a plaintext value using Argon2id.
   *
   * @param value - The plaintext string to hash.
   * @returns The Argon2id hash string.
   *
   * @example
   * ```ts
   * const hash = await argon2.make('my-password')
   * ```
   */
  async make(value: string): Promise<string> {
    return hashArgon2(value, { memoryCost: this.memoryCost, timeCost: this.timeCost })
  }

  /**
   * Verify a plaintext value against an Argon2id hash.
   *
   * @param value - The plaintext string to verify.
   * @param hash - The Argon2id hash to compare against.
   * @returns `true` if the value matches the hash, `false` otherwise.
   *
   * @example
   * ```ts
   * const valid = await argon2.verify('my-password', storedHash)
   * ```
   */
  async verify(value: string, hash: string): Promise<boolean> {
    try {
      return await verifyArgon2(value, hash)
    } catch (err) {
      // An unrecognized hash string means "no match"; a genuine runtime
      // failure (missing native binding, etc.) must propagate rather than
      // be hidden behind a `false` that looks like a wrong password.
      if (!hash.startsWith('$argon2')) return false
      throw err
    }
  }

  /**
   * Check whether an Argon2id hash needs to be rehashed due to different memory or time cost parameters.
   *
   * @param hash - The Argon2id hash to inspect.
   * @returns `true` if the hash should be regenerated, `false` if it is current.
   *
   * @example
   * ```ts
   * if (argon2.needsRehash(storedHash)) {
   *   const newHash = await argon2.make(plaintext)
   * }
   * ```
   */
  needsRehash(hash: string): boolean {
    if (!hash.startsWith("$argon2id$")) return true
    const mMatch = hash.match(/m=(\d+)/)
    const tMatch = hash.match(/t=(\d+)/)
    if (!mMatch || !tMatch) return true
    const hashMemory = Number(mMatch[1])
    const hashTime = Number(tMatch[1])
    return hashMemory !== this.memoryCost || hashTime !== this.timeCost
  }
}
