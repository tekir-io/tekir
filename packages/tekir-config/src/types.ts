/**
 * Optional validator for a config namespace.
 * Return `true` when valid, or `false`/a message string describing the problem.
 */
export type ConfigSchema = (value: any) => boolean | string

/** Options for {@link ConfigStore.getAll}. */
export interface GetAllOptions {
  /**
   * Redact values under sensitive key names (passwords, tokens, API keys, etc.).
   * Defaults to `true`. Set to `false` to return raw values.
   */
  redact?: boolean
}

/**
 * Interface for the application configuration store.
 *
 * Provides methods to register, retrieve, and bulk-load configuration values.
 */
export interface ConfigStore {
  /**
   * Register a named configuration value in the store.
   * @param name - The top-level config namespace (e.g. `'app'`, `'database'`).
   * @param value - The configuration object to store.
   * @param schema - Optional validator; throws if `value` fails validation.
   */
  register(name: string, value: any, schema?: ConfigSchema): void

  /**
   * Retrieve a configuration value using dot-notation.
   * @param key - Dot-separated path (e.g. `'app.port'`).
   * @param defaultValue - Fallback value if the key is not found.
   * @returns The resolved value, or `defaultValue` if not found.
   */
  get<T = any>(key: string, defaultValue?: T): T

  /**
   * Return all registered configuration entries as a plain object.
   * Sensitive values are redacted by default; pass `{ redact: false }` for raw values.
   * @param options - Optional behaviour flags.
   * @returns A record mapping each config name to its (redacted) value.
   */
  getAll(options?: GetAllOptions): Record<string, any>

  /**
   * Load all `.ts` and `.js` files from a directory, registering each file's
   * default export under a key derived from the filename.
   * @param dir - Absolute path to the config directory.
   */
  loadDir(dir: string): Promise<void>
}
