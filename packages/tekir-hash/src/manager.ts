import type { HashConfig, HashDriver, DriverName } from './types'
import { BcryptDriver } from './drivers/bcrypt'
import { Argon2Driver } from './drivers/argon2'
import { ScryptDriver, SCRYPT_PREFIX } from './drivers/scrypt'


/**
 * Hash manager that supports multiple hashing algorithms (bcrypt, argon2, scrypt).
 * Auto-detects the algorithm from stored hashes and lazily initializes drivers.
 *
 * @example
 * ```ts
 * const hash = new Hash({ default: 'bcrypt', bcrypt: { rounds: 12 } })
 * const hashed = await hash.make('password')
 * const valid = await hash.verify('password', hashed)
 * ```
 */
export class Hash {
  private config: HashConfig
  private drivers: Map<DriverName, HashDriver> = new Map()
  private activeDriver: DriverName

  /**
   * Create a new Hash manager.
   *
   * @param config - Optional {@link HashConfig} specifying the default driver and per-driver options.
   */
  constructor(config: HashConfig = {}) {
    this.config = config
    this.activeDriver = config.default ?? "bcrypt"
  }

  private resolveDriver(name: DriverName): HashDriver {
    if (this.drivers.has(name)) {
      return this.drivers.get(name) as HashDriver
    }

    let driver: HashDriver

    switch (name) {
      case "bcrypt":
        driver = new BcryptDriver(this.config.bcrypt)
        break
      case "argon2":
        driver = new Argon2Driver(this.config.argon2)
        break
      case "scrypt":
        driver = new ScryptDriver(this.config.scrypt)
        break
      default:
        throw new Error(`Unknown hash driver: "${name}"`)
    }

    this.drivers.set(name, driver)
    return driver
  }

  /**
   * Switch the active driver and return `this` for chaining.
   *
   * @param driver - The driver name to activate (`'bcrypt'`, `'argon2'`, or `'scrypt'`).
   * @returns The Hash instance for chaining.
   *
   * @example
   * ```ts
   * const hashed = await hash.use('argon2').make('password')
   * ```
   */
  use(driver: DriverName): this {
    this.activeDriver = driver
    return this
  }

  /**
   * Hash a plain-text value using the active driver.
   *
   * @param value - The plaintext string to hash.
   * @returns The hashed string.
   *
   * @example
   * ```ts
   * const hashed = await hash.make('my-password')
   * ```
   */
  make(value: string): Promise<string> {
    return this.resolveDriver(this.activeDriver).make(value)
  }

  /**
   * Verify a plain-text value against a stored hash.
   * The driver is auto-detected from the hash format when possible.
   *
   * @param value - The plaintext string to verify.
   * @param hash - The stored hash to compare against.
   * @returns `true` if the value matches the hash, `false` otherwise.
   *
   * @example
   * ```ts
   * const valid = await hash.verify('my-password', storedHash)
   * ```
   */
  async verify(value: string, hash: string): Promise<boolean> {
    const detected = this.detectDriver(hash)
    if (!detected) {
      // Unrecognized prefix: a wrong driver may silently produce a false
      // negative. Make the ambiguity visible instead of failing quietly.
      console.warn(`[@tekir/hash] could not detect hash algorithm from prefix; falling back to "${this.activeDriver}"`)
    }
    return this.resolveDriver(detected ?? this.activeDriver).verify(value, hash)
  }

  /**
   * Check if a hash needs to be rehashed (e.g. different algorithm or cost parameters).
   *
   * @param hash - The stored hash to inspect.
   * @returns `true` if the hash should be regenerated with the current driver settings, `false` otherwise.
   *
   * @example
   * ```ts
   * if (hash.needsRehash(storedHash)) {
   *   const newHash = await hash.make(plaintext)
   * }
   * ```
   */
  needsRehash(hash: string): boolean {
    const driver = this.detectDriver(hash) ?? this.activeDriver
    return this.resolveDriver(driver).needsRehash(hash)
  }

  /**
   * Detect the driver from a stored hash's format prefix.
   */
  private detectDriver(hash: string): DriverName | null {
    if (hash.startsWith("$2b$") || hash.startsWith("$2a$")) return "bcrypt"
    if (hash.startsWith("$argon2id$") || hash.startsWith("$argon2i$") || hash.startsWith("$argon2d$")) return "argon2"
    if (hash.startsWith(SCRYPT_PREFIX)) return "scrypt"
    return null
  }
}
