import { cleanEnv } from 'envalid'
import type { CleanOptions } from 'envalid'
export type { EnvSchema } from './types'
import type { EnvSchema } from './types'

/**
 * Define and validate environment variables against a schema using `envalid`.
 *
 * Returns a frozen, typed object whose keys match the schema. Type inference is
 * delegated to envalid's own `CleanedEnv`, so it stays accurate as envalid evolves.
 *
 * By default, envalid prints a report and calls `process.exit(1)` when required
 * variables are missing or invalid. Pass `options.reporter` to customise this,
 * e.g. throw instead of exiting (useful in libraries, tests, or serverless).
 *
 * @param schema - An envalid schema object mapping env var names to validators.
 * @param options - Optional envalid clean options (custom `reporter`, etc.).
 * @returns A readonly, validated environment object.
 *
 * @example
 * ```ts
 * import { defineEnv, str, num, bool } from '@tekir/env'
 *
 * const env = defineEnv({
 *   NODE_ENV: str({ choices: ['development', 'production', 'test'] }),
 *   PORT: num({ default: 3000 }),
 *   DEBUG: bool({ default: false }),
 * })
 * ```
 *
 * @example
 * ```ts
 * // Throw instead of exiting the process on validation failure.
 * const env = defineEnv(schema, {
 *   reporter: ({ errors }) => {
 *     const keys = Object.keys(errors)
 *     if (keys.length) throw new Error(`Invalid env: ${keys.join(', ')}`)
 *   },
 * })
 * ```
 */
export function defineEnv<T extends EnvSchema>(schema: T, options?: CleanOptions<T>) {
  return cleanEnv(process.env, schema, options)
}
