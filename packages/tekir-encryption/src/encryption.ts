import {
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  SALT_LENGTH,
  PAYLOAD_VERSION,
  MIN_APP_KEY_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_HASH,
} from './types'

// Helpers

function getCrypto(): Crypto {
  // Works in Node 18+, browsers, Deno, Bun, Cloudflare Workers, etc.
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto
  }
  throw new Error(
    '[@tekir/encryption] Web Crypto API is not available in this runtime. ' +
      'Requires Node.js 18+, a modern browser, or a compatible edge runtime.',
  )
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // Prefer Buffer (Bun/Node) — avoids the O(n) per-char string concat that
  // pressures memory on large payloads.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  // Browser/edge fallback: chunked fromCharCode to avoid arg-count limits.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64Decode(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function textEncode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

function textDecode(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer)
}

// Key derivation

/**
 * Derives an AES-256-GCM CryptoKey from a raw passphrase (APP_KEY) and a
 * per-ciphertext random salt using PBKDF2. A random salt (rather than one
 * derived from the APP_KEY) defeats precompute/rainbow attacks and ensures
 * two installs sharing an APP_KEY do not share a derived key.
 */
async function deriveKey(appKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto()

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncode(appKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable
    ['encrypt', 'decrypt'],
  )
}

/**
 * Legacy salt derivation: SHA-256("tekir-salt:" + appKey) truncated to 16
 * bytes. Only used to decrypt ciphertext produced before the random-salt
 * format (v1) was introduced.
 */
async function legacySalt(appKey: string): Promise<Uint8Array> {
  const crypto = getCrypto()
  const keyHash = await crypto.subtle.digest('SHA-256', textEncode(`tekir-salt:${appKey}`))
  return new Uint8Array(keyHash).slice(0, SALT_LENGTH)
}

// Core encrypt / decrypt (raw string in, base64 out)
//
// v1 payload layout: [version(1)] [salt(16)] [iv(12)] [ciphertext+tag]
// Legacy payload layout (no version byte): [iv(12)] [ciphertext+tag] with the
// salt deterministically derived from the APP_KEY.

async function rawEncrypt(plaintext: string, appKey: string): Promise<string> {
  const crypto = getCrypto()

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(appKey, salt)
  const encoded = textEncode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  )

  // [version][salt][iv][ciphertext] so the random salt travels with the data.
  const combined = new Uint8Array(1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength)
  combined[0] = PAYLOAD_VERSION
  combined.set(salt, 1)
  combined.set(iv, 1 + SALT_LENGTH)
  combined.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH)

  return base64Encode(combined.buffer)
}

async function rawDecrypt(encoded: string, appKey: string): Promise<string> {
  const combined = base64Decode(encoded)

  // New format: version byte present.
  if (combined.byteLength > 1 + SALT_LENGTH + IV_LENGTH && combined[0] === PAYLOAD_VERSION) {
    const salt = combined.slice(1, 1 + SALT_LENGTH)
    const iv = combined.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH)
    const ciphertext = combined.slice(1 + SALT_LENGTH + IV_LENGTH)
    const key = await deriveKey(appKey, salt)
    return decryptWith(key, iv, ciphertext)
  }

  // Legacy format: no version/salt, deterministic salt from the APP_KEY.
  if (combined.byteLength > IV_LENGTH) {
    const iv = combined.slice(0, IV_LENGTH)
    const ciphertext = combined.slice(IV_LENGTH)
    const key = await deriveKey(appKey, await legacySalt(appKey))
    return decryptWith(key, iv, ciphertext)
  }

  throw new Error(
    '[@tekir/encryption] Ciphertext is too short — data may be corrupt or invalid.',
  )
}

async function decryptWith(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  const crypto = getCrypto()
  let plainBuffer: ArrayBuffer
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    )
  } catch {
    throw new Error(
      '[@tekir/encryption] Decryption failed — the key may be wrong or the ' +
        'ciphertext may have been tampered with.',
    )
  }
  return textDecode(plainBuffer)
}

// Encryption

/**
 * AES-256-GCM encryption service using Web Crypto API.
 * Derives a CryptoKey from APP_KEY via PBKDF2 (200k iterations, per-key SHA-256 salt).
 * Each encryption uses a unique random IV — same plaintext produces different ciphertext.
 *
 * @example
 * ```ts
 * const enc = new Encryption(process.env.APP_KEY)
 *
 * // Encrypt/decrypt strings
 * const cipher = await enc.encryptString('secret data')
 * const plain = await enc.decryptString(cipher)
 *
 * // Encrypt/decrypt JSON-serializable values
 * const token = await enc.encrypt({ userId: 1, role: 'admin' })
 * const data = await enc.decrypt(token) // { userId: 1, role: 'admin' }
 * ```
 */
export class Encryption {
  private readonly appKey: string

  /**
   * Create a new Encryption instance.
   *
   * @param appKey - The application encryption key. Falls back to `process.env.APP_KEY` if not provided.
   * @throws {Error} If no key is available, or if the key is too short/weak.
   *
   * @example
   * ```ts
   * const enc = new Encryption('my-secret-app-key')
   * ```
   */
  constructor(appKey?: string) {
    const resolvedKey = appKey ?? process?.env?.APP_KEY ?? ''

    if (!resolvedKey) {
      throw new Error(
        '[@tekir/encryption] APP_KEY is not set. ' +
          'Run "bun run index.ts generate:key" to generate one, or pass a key to the constructor.',
      )
    }

    // Reject low-entropy keys outright. AES-256 only delivers its strength if
    // the PBKDF2 input has enough entropy; a 1-char key is trivially brute
    // forced regardless of iteration count.
    const keyBytes = new TextEncoder().encode(resolvedKey).length
    if (keyBytes < MIN_APP_KEY_LENGTH) {
      throw new Error(
        `[@tekir/encryption] APP_KEY is too short (${keyBytes} bytes); ` +
          `at least ${MIN_APP_KEY_LENGTH} bytes are required. ` +
          'Run "bun run index.ts generate:key" to generate a strong key.',
      )
    }
    if (new Set(resolvedKey.split('')).size < 5) {
      throw new Error(
        '[@tekir/encryption] APP_KEY has too little entropy (too few distinct characters). ' +
          'Use a randomly generated key.',
      )
    }

    this.appKey = resolvedKey
  }


  /**
   * Encrypt a raw string and return a base64-encoded ciphertext.
   *
   * @param text - The plaintext string to encrypt.
   * @returns A base64-encoded ciphertext string (IV prepended).
   *
   * @example
   * ```ts
   * const cipher = await enc.encryptString('secret data')
   * ```
   */
  async encryptString(text: string): Promise<string> {
    return rawEncrypt(text, this.appKey)
  }

  /**
   * Decrypt a base64-encoded ciphertext back to its original string.
   *
   * @param encrypted - The base64-encoded ciphertext produced by {@link encryptString}.
   * @returns The original plaintext string.
   * @throws {Error} If the ciphertext is too short, corrupted, or the key is wrong.
   *
   * @example
   * ```ts
   * const plain = await enc.decryptString(cipher)
   * ```
   */
  async decryptString(encrypted: string): Promise<string> {
    return rawDecrypt(encrypted, this.appKey)
  }


  /**
   * Serialize `value` to JSON, then encrypt it.
   * Returns a base64 string suitable for storage or transmission.
   *
   * @param value - Any JSON-serializable value to encrypt.
   * @returns A base64-encoded ciphertext string.
   *
   * @example
   * ```ts
   * const token = await encryption.encrypt({ userId: 1, role: 'admin' })
   * ```
   */
  async encrypt<T = unknown>(value: T): Promise<string> {
    const json = JSON.stringify(value)
    return this.encryptString(json)
  }

  /**
   * Decrypt a base64 string produced by {@link encrypt} and deserialize
   * the original value from JSON.
   *
   * @param encrypted - The base64-encoded ciphertext produced by {@link encrypt}.
   * @returns The deserialized value of type `T`.
   * @throws {Error} If decryption fails or the decrypted payload is not valid JSON.
   *
   * @example
   * ```ts
   * const data = await encryption.decrypt<{ userId: number }>(token)
   * ```
   */
  async decrypt<T = any>(encrypted: string): Promise<T> {
    const json = await this.decryptString(encrypted)
    try {
      return JSON.parse(json) as T
    } catch {
      // Keep the external error identical to a decryption failure so the
      // distinction between "bad key/tamper" and "valid decrypt, bad JSON"
      // is not exposed as an oracle. The hint stays in the logs only.
      console.warn('[@tekir/encryption] decrypted payload was not valid JSON (use decryptString for raw strings)')
      throw new Error(
        '[@tekir/encryption] Decryption failed — the key may be wrong or the ' +
          'ciphertext may have been tampered with.',
      )
    }
  }
}
