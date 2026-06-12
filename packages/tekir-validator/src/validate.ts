export type { ValidateOptions, ValidateMiddleware } from './types'
import type { ValidateOptions, ValidateMiddleware } from './types'

/** Error thrown when request validation fails. Contains per-field error messages. */
export class ValidationError extends Error {
  public statusCode = 422
  public code = 'VALIDATION_ERROR'
  public fields: Record<string, string[]>

  /**
   * Create a new ValidationError.
   *
   * @param message - A human-readable error message.
   * @param fields - A record mapping field names to arrays of error messages.
   *
   * @example
   * ```ts
   * throw new ValidationError('Validation failed', { email: ['Email is required'] })
   * ```
   */
  constructor(message: string, fields: Record<string, string[]>) {
    super(message)
    this.fields = fields
  }

  /**
   * Serialize the error to a JSON-friendly object suitable for API responses.
   *
   * @returns An object containing the error message, code, status code, and per-field errors.
   */
  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        fields: this.fields,
      },
    }
  }
}

// Parse any schema against data. Works with any library that has:
//   .parse(data) or .parseAsync(data) - throws on error (Zod, Valibot)
//   .validate(data) - throws on error (Yup)
//   .safeParse(data) - returns { success, data, error } (Zod)
async function parseSchema(schema: any, data: any): Promise<{ data: any; errors: Record<string, string[]> | null }> {
  try {
    // Try .parseAsync first (Zod)
    if (typeof schema.parseAsync === 'function') {
      return { data: await schema.parseAsync(data), errors: null }
    }

    // Try .parse (Zod sync, Valibot via wrapper)
    if (typeof schema.parse === 'function') {
      return { data: schema.parse(data), errors: null }
    }

    // Try .validate (Yup)
    if (typeof schema.validate === 'function') {
      return { data: await schema.validate(data, { abortEarly: false, stripUnknown: true }), errors: null }
    }

    // Schema is a plain function: (data) => parsed
    if (typeof schema === 'function') {
      return { data: await schema(data), errors: null }
    }

    // Unrecognized schema shape. Failing open (letting unvalidated data
    // through) is the dangerous default, so fail closed instead.
    throw new Error('Unrecognized validation schema: expected a Zod/Yup/Valibot schema or a validator function')
  } catch (err: any) {
    return { data: null, errors: formatErrors(err) }
  }
}

// Format errors from any validation library into { field: [messages] }
function formatErrors(err: any): Record<string, string[]> {
  const errors: Record<string, string[]> = {}

  // Valibot: err.issues = [{ path: [{ key: 'field' }], message: '...' }]
  // Detected before Zod because both use `err.issues`, but Valibot's path
  // entries are objects ({ key }) rather than plain strings. Checking the
  // object-shaped path first keeps the Zod join from producing `[object Object]`.
  if (Array.isArray(err.issues) && err.issues.length > 0 && Array.isArray(err.issues[0]?.path) && typeof err.issues[0].path[0] === 'object') {
    for (const issue of err.issues) {
      const field = Array.isArray(issue.path) && issue.path.length > 0
        ? issue.path.map((p: any) => p.key).join('.')
        : '_root'
      if (!errors[field]) errors[field] = []
      errors[field].push(issue.message)
    }
    return errors
  }

  // Zod: err.issues = [{ path: ['field'], message: '...' }]
  if (err.issues && Array.isArray(err.issues)) {
    for (const issue of err.issues) {
      const field = issue.path?.length > 0 ? issue.path.join('.') : '_root'
      if (!errors[field]) errors[field] = []
      errors[field].push(issue.message)
    }
    return errors
  }

  // Yup: err.inner = [{ path: 'field', message: '...' }]
  if (err.inner && Array.isArray(err.inner)) {
    for (const issue of err.inner) {
      const field = issue.path || '_root'
      if (!errors[field]) errors[field] = []
      errors[field].push(issue.message)
    }
    return errors
  }

  // Fallback: generic error
  errors._root = [err.message || 'Validation failed']
  return errors
}

/**
 * Validation middleware that validates body, params, query, and headers against schemas.
 * Supports Zod, Yup, Valibot, or custom validator functions.
 * Throws {@link ValidationError} with per-field messages on failure.
 *
 * @param options - A {@link ValidateOptions} object with schemas for `body`, `params`, `query`, and/or `headers`.
 * @returns A middleware function compatible with the framework's middleware signature.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { validate } from '@tekir/validator'
 *
 * router.post('/users', validate({
 *   body: z.object({ name: z.string(), email: z.string().email() })
 * }), handler)
 * ```
 */
export function validate(options: ValidateOptions): ValidateMiddleware {
  return async (ctx: any, next: () => Promise<void>) => {
    const allErrors: Record<string, string[]> = {}
    const sources = ['body', 'params', 'query', 'headers'] as const
    const schemas = [options.body, options.params, options.query, options.headers]

    // Stage parsed results; only commit them to ctx once every source passed.
    // Writing back per-source would leave ctx partially coerced/stripped when a
    // later source fails, so the error handler would see a half-mutated context.
    const pending: Array<{ source: typeof sources[number]; data: any }> = []

    await Promise.all(schemas.map(async (schema, i) => {
      if (!schema) return
      const { data, errors } = await parseSchema(schema, ctx[sources[i]])
      if (errors) {
        for (const [field, messages] of Object.entries(errors)) {
          const key = field === '_root' ? sources[i] : field
          allErrors[key] = [...(allErrors[key] || []), ...messages]
        }
      } else {
        pending.push({ source: sources[i], data })
      }
    }))

    if (Object.keys(allErrors).length > 0) {
      throw new ValidationError('Validation failed', allErrors)
    }

    // Atomic commit: ctx is mutated only when validation fully succeeded.
    for (const { source, data } of pending) {
      ctx[source] = data
    }

    await next()
  }
}
