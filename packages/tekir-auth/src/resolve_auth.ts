import type { AuthUser, AuthModel } from './types'

type Resolver = (id: string | number) => Promise<AuthUser | null>

/**
 * Build the auth subject resolver for a guard config. Either the explicit
 * `resolve` callback or, as a shortcut, a `model` with a static `find(id)`
 * method (every `@tekir/db` `BaseModel` subclass works).
 *
 * Throws if neither is provided so misconfiguration fails loud at boot.
 */
export function resolveAuthSubject(
  guardName: string,
  config: { resolve?: Resolver; model?: AuthModel }
): Resolver {
  if (config.resolve) return config.resolve
  if (config.model) {
    const model = config.model
    return (id) => model.find(id) as Promise<AuthUser | null>
  }
  throw new Error(
    `[${guardName}] Either 'resolve' or 'model' must be provided in the guard config.`
  )
}
