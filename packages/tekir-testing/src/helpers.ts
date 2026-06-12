
/**
 * Freeze time for testing by reptekirg the global Date constructor. Returns a cleanup function.
 *
 * @param {Date} date - The frozen date to use
 * @returns {() => void} A function that restores the original Date
 *
 * @example
 * ```ts
 * const restore = fakeTime(new Date('2025-01-01'))
 * console.log(new Date()) // 2025-01-01
 * restore()
 * ```
 */
export function fakeTime(date: Date): () => void {
  const original = Date
  const frozen = date.getTime()

  // @ts-ignore — intentional Date override for testing
  globalThis.Date = class FakeDate extends original {
    constructor(...args: any[]) {
      // No args → frozen time. Otherwise forward the original argument(s)
      // unchanged so `new Date(timestamp)`, `new Date('iso')`,
      // `new Date(year, month, ...)` all parse the same as the real Date.
      if (args.length === 0) super(frozen)
      else super(...(args as []))
    }
    static now() { return frozen }
  } as typeof Date

  return () => { globalThis.Date = original }
}


/**
 * Assert that a function throws an error, optionally matching a specific message, regex, or error properties.
 *
 * @param {() => unknown} fn - The function expected to throw
 * @param {string | RegExp | { message?: string; code?: string; statusCode?: number }} [expected] - Expected error criteria
 * @returns {Promise<void>}
 * @throws {Error} If the function does not throw or the error does not match
 *
 * @example
 * ```ts
 * await assertThrows(() => { throw new Error('fail') }, 'fail')
 * await assertThrows(() => { throw new Error('fail') }, /fail/)
 * await assertThrows(() => { throw new HttpError(404) }, { statusCode: 404 })
 * ```
 */
export async function assertThrows(
  fn: () => unknown,
  expected?: string | RegExp | { message?: string; code?: string; statusCode?: number }
): Promise<void> {
  let threw = false
  try {
    await fn()
  } catch (error: unknown) {
    threw = true
    const err = error as { message?: string; code?: string; statusCode?: number }
    if (typeof expected === 'string' && err.message !== expected) {
      throw new Error(`Expected error message "${expected}", got "${err.message}"`)
    }
    if (expected instanceof RegExp && !expected.test(err.message ?? '')) {
      throw new Error(`Expected error message to match ${expected}, got "${err.message}"`)
    }
    if (typeof expected === 'object' && !(expected instanceof RegExp)) {
      const exp = expected as { message?: string; code?: string; statusCode?: number }
      if (exp.message && err.message !== exp.message) {
        throw new Error(`Expected error message "${exp.message}", got "${err.message}"`)
      }
      if (exp.code && err.code !== exp.code) {
        throw new Error(`Expected error code "${exp.code}", got "${err.code}"`)
      }
      if (exp.statusCode && err.statusCode !== exp.statusCode) {
        throw new Error(`Expected status code ${exp.statusCode}, got ${err.statusCode}`)
      }
    }
  }
  if (!threw) throw new Error('Expected function to throw, but it did not')
}

/**
 * Assert that an async function resolves without throwing.
 *
 * @param {() => unknown} fn - The function expected not to throw
 * @returns {Promise<void>}
 * @throws {Error} If the function throws
 *
 * @example
 * ```ts
 * await assertNotThrows(() => validateInput({ name: 'valid' }))
 * ```
 */
export async function assertNotThrows(fn: () => unknown): Promise<void> {
  try {
    await fn()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`Expected function not to throw, but got: ${msg}`)
  }
}
