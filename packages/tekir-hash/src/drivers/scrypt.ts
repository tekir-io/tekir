import * as crypto from "crypto"
import type { HashDriver, ScryptOptions } from '../types'

const SCRYPT_PREFIX = "$scrypt$"
const MAX_N = 1 << 20
const MAX_R = 32
const MAX_P = 16
const MAX_KEYLEN = 1024

function validParams(N: number, r: number, p: number, keylen: number): boolean {
  return Number.isInteger(N) && N >= 2 && N <= MAX_N && (N & (N - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 && r <= MAX_R &&
    Number.isInteger(p) && p >= 1 && p <= MAX_P &&
    Number.isInteger(keylen) && keylen >= 16 && keylen <= MAX_KEYLEN
}

function scryptMake(value: string, opts: ScryptOptions): Promise<string> {
  const N = opts.N ?? 16384
  const r = opts.r ?? 8
  const p = opts.p ?? 1
  const keylen = opts.keylen ?? 64

  if (!validParams(N, r, p, keylen)) {
    return Promise.reject(new RangeError('Invalid or unsafe scrypt parameters'))
  }

  const salt = crypto.randomBytes(16).toString("hex")

  return new Promise((resolve, reject) => {
    crypto.scrypt(value, salt, keylen, { N, r, p }, (err, derived) => {
      if (err) return reject(err)
      // Format: $scrypt$N=<N>,r=<r>,p=<p>,keylen=<keylen>$<salt>$<hash>
      const params = `N=${N},r=${r},p=${p},keylen=${keylen}`
      resolve(`${SCRYPT_PREFIX}${params}$${salt}$${derived.toString("hex")}`)
    })
  })
}

function scryptVerify(value: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!hash.startsWith(SCRYPT_PREFIX)) return resolve(false)

    const parts = hash.slice(SCRYPT_PREFIX.length).split("$")
    if (parts.length !== 3) return resolve(false)

    const [paramStr, salt, storedHash] = parts

    const params: Record<string, number> = {}
    for (const pair of paramStr.split(",")) {
      const [k, v] = pair.split("=")
      params[k] = Number(v)
    }

    // A corrupt stored param (e.g. "N=abc" -> NaN) must not be coerced into a
    // default and must not be passed to scrypt (which would throw/reject and
    // could break the login flow). Treat it as a non-matching hash.
    const N = params["N"] ?? 16384
    const r = params["r"] ?? 8
    const p = params["p"] ?? 1
    const keylen = params["keylen"] ?? 64
    if (!validParams(N, r, p, keylen)) return resolve(false)
    if (!/^[0-9a-f]+$/i.test(salt) || salt.length > 1024) return resolve(false)
    if (!/^[0-9a-f]+$/i.test(storedHash) || storedHash.length !== keylen * 2) return resolve(false)

    crypto.scrypt(value, salt, keylen, { N, r, p }, (err, derived) => {
      if (err) return reject(err)
      const derivedHex = derived.toString("hex")
      try {
        resolve(
          crypto.timingSafeEqual(
            Buffer.from(derivedHex, "hex"),
            Buffer.from(storedHash, "hex")
          )
        )
      } catch {
        resolve(false)
      }
    })
  })
}

function scryptNeedsRehash(hash: string, opts: ScryptOptions): boolean {
  if (!hash.startsWith(SCRYPT_PREFIX)) return true

  const parts = hash.slice(SCRYPT_PREFIX.length).split("$")
  if (parts.length !== 3) return true

  const [paramStr] = parts
  const params: Record<string, number> = {}
  for (const pair of paramStr.split(",")) {
    const [k, v] = pair.split("=")
    params[k] = Number(v)
  }

  const N = opts.N ?? 16384
  const r = opts.r ?? 8
  const p = opts.p ?? 1
  const keylen = opts.keylen ?? 64

  return (
    params["N"] !== N ||
    params["r"] !== r ||
    params["p"] !== p ||
    params["keylen"] !== keylen
  )
}

/** Hash driver using Node.js scrypt key derivation function. */
export class ScryptDriver implements HashDriver {
  private options: ScryptOptions

  /**
   * Create a new ScryptDriver.
   *
   * @param options - Optional {@link ScryptOptions} to configure N, r, p, and keylen parameters.
   */
  constructor(options: ScryptOptions = {}) {
    this.options = options
  }

  /**
   * Hash a plaintext value using the scrypt key derivation function.
   *
   * @param value - The plaintext string to hash.
   * @returns The scrypt hash string in the format `$scrypt$N=...,r=...,p=...,keylen=...$<salt>$<hash>`.
   *
   * @example
   * ```ts
   * const hash = await scrypt.make('my-password')
   * ```
   */
  make(value: string): Promise<string> {
    return scryptMake(value, this.options)
  }

  /**
   * Verify a plaintext value against a scrypt hash.
   *
   * @param value - The plaintext string to verify.
   * @param hash - The scrypt hash to compare against.
   * @returns `true` if the value matches the hash, `false` otherwise.
   *
   * @example
   * ```ts
   * const valid = await scrypt.verify('my-password', storedHash)
   * ```
   */
  verify(value: string, hash: string): Promise<boolean> {
    return scryptVerify(value, hash)
  }

  /**
   * Check whether a scrypt hash needs to be rehashed due to different parameters.
   *
   * @param hash - The scrypt hash to inspect.
   * @returns `true` if the hash should be regenerated, `false` if it is current.
   *
   * @example
   * ```ts
   * if (scrypt.needsRehash(storedHash)) {
   *   const newHash = await scrypt.make(plaintext)
   * }
   * ```
   */
  needsRehash(hash: string): boolean {
    return scryptNeedsRehash(hash, this.options)
  }
}

export { SCRYPT_PREFIX }
