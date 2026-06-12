import type { ValidatorSpec } from 'envalid'

/**
 * A mapping of environment variable names to their envalid validator definitions.
 * Bound to envalid's `ValidatorSpec` so invalid validators are caught at compile time.
 */
export type EnvSchema = Record<string, ValidatorSpec<unknown>>
