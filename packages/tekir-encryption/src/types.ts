// Constants

export const ALGORITHM = 'AES-GCM' as const
export const KEY_LENGTH = 256 // bits
export const IV_LENGTH = 12 // bytes — recommended for AES-GCM
export const SALT_LENGTH = 16 // bytes — per-ciphertext random PBKDF2 salt
export const PAYLOAD_VERSION = 1 // version byte prefixing the random-salt format
export const MIN_APP_KEY_LENGTH = 16 // bytes — minimum acceptable APP_KEY entropy
export const PBKDF2_ITERATIONS = 200_000
export const PBKDF2_HASH = 'SHA-256'

// Interfaces

export interface EncryptedPayload {
  /** Base64-encoded string: IV (12 bytes) + AES-256-GCM ciphertext */
  data: string;
}
