import { ForbiddenException as BaseForbiddenException } from '@tekir/core'

/**
 * Exception thrown when an authorization check fails.
 *
 * @example
 * ```ts
 * throw new ForbiddenException('You cannot edit this post')
 * ```
 */
export class ForbiddenException extends BaseForbiddenException {
  /**
   * @param {string} [message='Authorization failed'] - The error message
   */
  constructor(message: string = 'Authorization failed') {
    super(message)
    this.code = 'AUTHORIZATION_FAILURE'
  }
}

/**
 * Immutable value object representing the result of an authorization check.
 *
 * @example
 * ```ts
 * const allowed = AuthorizationResponse.allow()
 * const denied = AuthorizationResponse.deny('Insufficient permissions')
 * console.log(allowed.toBoolean()) // true
 * ```
 */
export class AuthorizationResponse {
  public readonly allowed: boolean
  public readonly message: string | undefined

  private constructor(allowed: boolean, message?: string) {
    this.allowed = allowed
    this.message = message
  }

  /**
   * Create an allowed authorization response.
   * @returns {AuthorizationResponse} An allowed response
   */
  static allow(): AuthorizationResponse {
    return new AuthorizationResponse(true)
  }

  /**
   * Create a denied authorization response.
   * @param {string} [message] - Optional denial reason
   * @returns {AuthorizationResponse} A denied response
   */
  static deny(message?: string): AuthorizationResponse {
    return new AuthorizationResponse(false, message ?? 'Authorization failed')
  }

  /**
   * Convert the response to a boolean value.
   * @returns {boolean} True if allowed, false if denied
   */
  toBoolean(): boolean {
    return this.allowed
  }
}

export type AbilityResult = boolean | AuthorizationResponse | undefined | null
export type AbilityCallback = (user: unknown, ...args: unknown[]) => AbilityResult | Promise<AbilityResult>
export type BeforeHook = (user: unknown, ability: string, ...args: unknown[]) => AbilityResult | Promise<AbilityResult>

/**
 * Normalize an ability result (boolean, AuthorizationResponse, or undefined) into an AuthorizationResponse.
 * @param {AbilityResult} result - The raw ability result
 * @returns {AuthorizationResponse} A normalized AuthorizationResponse
 *
 * @example
 * ```ts
 * normalizeResult(true)       // AuthorizationResponse.allow()
 * normalizeResult(false)      // AuthorizationResponse.deny()
 * normalizeResult(undefined)  // AuthorizationResponse.deny()
 * ```
 */
export function normalizeResult(result: AbilityResult): AuthorizationResponse {
  if (result instanceof AuthorizationResponse) {
    return result
  }
  if (result === true) {
    return AuthorizationResponse.allow()
  }
  // Fail closed: anything that is not strictly `true` or an allow response is
  // a deny. A truthy non-boolean (e.g. 1 or "yes") is a likely mistake — warn
  // so a developer who expected it to allow isn't surprised by a silent deny.
  if (result !== false && result !== undefined && result !== null) {
    console.warn(
      '[@tekir/authorize] ability returned a non-boolean value; treating it as DENY. ' +
      'Return strict true / AuthorizationResponse.allow() to grant access.',
    )
  }
  return AuthorizationResponse.deny()
}
