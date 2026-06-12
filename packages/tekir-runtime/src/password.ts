// Password hashing — Bun.password on Bun, bcrypt/argon2 npm on Node.js

import { isBun, getRequire } from './detect'

/**
 * Hash a plaintext value using bcrypt.
 * @param {string} value - The plaintext value to hash
 * @param {number} [rounds=10] - The bcrypt cost factor
 * @returns {Promise<string>} The bcrypt hash string
 *
 * @example
 * ```ts
 * const hash = await hashBcrypt('mypassword', 12)
 * ```
 */
export async function hashBcrypt(value: string, rounds = 10): Promise<string> {
  if (isBun()) return (globalThis as any).Bun.password.hash(value, { algorithm: 'bcrypt', cost: rounds })
  const bcrypt = getRequire()('bcrypt')
  return bcrypt.hash(value, rounds)
}

/**
 * Verify a plaintext value against a bcrypt hash.
 * @param {string} value - The plaintext value
 * @param {string} hash - The bcrypt hash to verify against
 * @returns {Promise<boolean>} True if the value matches the hash
 */
export async function verifyBcrypt(value: string, hash: string): Promise<boolean> {
  if (isBun()) return (globalThis as any).Bun.password.verify(value, hash, 'bcrypt')
  const bcrypt = getRequire()('bcrypt')
  return bcrypt.compare(value, hash)
}

/**
 * Hash a plaintext value using Argon2id.
 * @param {string} value - The plaintext value to hash
 * @param {object} [opts={}] - Argon2 options
 * @param {number} [opts.memoryCost=65536] - Memory cost in KiB
 * @param {number} [opts.timeCost=2] - Number of iterations
 * @returns {Promise<string>} The Argon2id hash string
 *
 * @example
 * ```ts
 * const hash = await hashArgon2('mypassword', { memoryCost: 131072 })
 * ```
 */
export async function hashArgon2(value: string, opts: { memoryCost?: number; timeCost?: number } = {}): Promise<string> {
  if (isBun()) return (globalThis as any).Bun.password.hash(value, { algorithm: 'argon2id', memoryCost: opts.memoryCost || 65536, timeCost: opts.timeCost || 2 })
  const argon2 = getRequire()('argon2')
  return argon2.hash(value, { memoryCost: opts.memoryCost || 65536, timeCost: opts.timeCost || 2 })
}

/**
 * Verify a plaintext value against an Argon2id hash.
 * @param {string} value - The plaintext value
 * @param {string} hash - The Argon2id hash to verify against
 * @returns {Promise<boolean>} True if the value matches the hash
 */
export async function verifyArgon2(value: string, hash: string): Promise<boolean> {
  if (isBun()) return (globalThis as any).Bun.password.verify(value, hash, 'argon2id')
  const argon2 = getRequire()('argon2')
  return argon2.verify(hash, value)
}
