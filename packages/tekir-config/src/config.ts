import { readdir } from 'node:fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { fileExists } from '@tekir/runtime'
export type { ConfigStore, ConfigSchema, GetAllOptions } from './types'
import type { ConfigStore, ConfigSchema, GetAllOptions } from './types'

// Key-name fragments whose values are treated as secrets and redacted by
// default in getAll(). Matching is case-insensitive and substring-based.
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'credential',
  'auth',
  'dsn',
  'connectionstring',
  'connection_string',
]

const REDACTED = '[REDACTED]'

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some(p => k.includes(p))
}

// Reject prototype-polluting / non-own path segments during dot-path traversal.
function isUnsafeSegment(seg: string): boolean {
  return seg === '__proto__' || seg === 'constructor' || seg === 'prototype'
}

function redactDeep(value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value as object)
  if (existing !== undefined) return existing

  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(redactDeep(item, seen))
    return out
  }

  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  seen.set(value as object, out)
  for (const key of Object.keys(src)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactDeep(src[key], seen)
  }
  return out
}

/**
 * Create a new configuration store for managing application config values.
 *
 * Supports dot-notation key access and automatic loading of config files from a directory.
 *
 * @returns A {@link ConfigStore} instance with `register`, `get`, `getAll`, and `loadDir` methods.
 *
 * @example
 * ```ts
 * const config = createConfigStore()
 * config.register('app', { name: 'MyApp', port: 3000 })
 * config.get('app.name')       // 'MyApp'
 * config.get('app.missing', 0) // 0
 * ```
 */
export function createConfigStore(): ConfigStore {
  const store = new Map<string, any>()

  /**
   * Register a named configuration value in the store.
   *
   * @param name - The top-level config namespace (e.g. `'app'`, `'database'`).
   * @param value - The configuration object to store under that namespace.
   * @param schema - Optional validator run against `value`; throws on invalid config.
   * @returns Nothing.
   *
   * @example
   * ```ts
   * config.register('database', { host: 'localhost', port: 5432 })
   * ```
   */
  function register(name: string, value: any, schema?: ConfigSchema): void {
    if (schema) {
      const result = schema(value)
      if (result !== true) {
        const detail = typeof result === 'string' ? result : 'failed schema validation'
        throw new Error(`[config] "${name}" ${detail}`)
      }
    }
    store.set(name, value)
  }

  /**
   * Retrieve a configuration value using dot-notation path access.
   *
   * @param key - Dot-separated path (e.g. `'app.port'`, `'database.host'`).
   * @param defaultValue - Fallback value returned when the key is not found.
   * @returns The resolved configuration value, or `defaultValue` if the path does not exist.
   *
   * @example
   * ```ts
   * config.get('app.name')          // 'MyApp'
   * config.get('app.missing', 42)   // 42
   * ```
   */
  function get<T = any>(key: string, defaultValue?: T): T {
    const parts = key.split('.')
    const configName = parts[0]
    const configObj = store.get(configName)

    if (configObj === undefined) return defaultValue as T

    let value: any = configObj
    for (let i = 1; i < parts.length; i++) {
      if (value === undefined || value === null) return defaultValue as T
      const seg = parts[i]
      // Block prototype-chain access so dot-paths cannot reach __proto__/constructor.
      if (isUnsafeSegment(seg)) return defaultValue as T
      if ((typeof value !== 'object' && typeof value !== 'function') || !Object.hasOwn(value, seg)) {
        return defaultValue as T
      }
      value = value[seg]
    }

    return (value ?? defaultValue) as T
  }

  /**
   * Return all registered configuration entries as a plain object.
   *
   * By default, values under sensitive key names (passwords, tokens, API keys,
   * etc.) are replaced with `'[REDACTED]'` to prevent secret leakage when the
   * result is logged or exposed via a diagnostics endpoint. Pass
   * `{ redact: false }` to obtain the raw values (use with care).
   *
   * @param options - Optional behaviour flags.
   * @returns A record mapping each config namespace to its (redacted) stored value.
   *
   * @example
   * ```ts
   * config.register('app', { name: 'MyApp' })
   * config.getAll() // { app: { name: 'MyApp' } }
   * ```
   */
  function getAll(options?: GetAllOptions): Record<string, any> {
    const redact = options?.redact !== false
    const result: Record<string, any> = {}
    for (const [key, value] of store) {
      result[key] = redact ? redactDeep(value) : value
    }
    return result
  }

  /**
   * Load all `.ts` and `.js` files from a directory, registering each file's
   * default export under a key derived from the filename (without extension).
   *
   * Files that fail to import (syntax errors, throwing modules) are skipped with
   * a warning rather than silently dropped.
   *
   * @param dir - Absolute path to the configuration directory.
   * @returns A promise that resolves once all files have been imported and registered.
   *
   * @example
   * ```ts
   * // Given config/app.ts that exports { name: 'MyApp' }
   * await config.loadDir('/path/to/config')
   * config.get('app.name') // 'MyApp'
   * ```
   */
  async function loadDir(dir: string): Promise<void> {
    if (!(await fileExists(dir))) return
    const files = (await readdir(dir)).filter(f => /\.(ts|js)$/.test(f))
    for (const file of files) {
      const name = file.replace(/\.(ts|js)$/, '')
      const fullPath = pathToFileURL(join(dir, file)).href
      try {
        const mod = await import(fullPath)
        register(name, mod.default || mod)
      } catch (err) {
        // Surface the failure so operators do not boot with silently missing config.
        console.warn(`[config] failed to load "${file}": ${(err as Error)?.message ?? err}`)
      }
    }
  }

  return { register, get, getAll, loadDir }
}
