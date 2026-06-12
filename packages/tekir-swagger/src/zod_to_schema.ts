import type { OpenApiSchema } from './types'


// Internal type alias for Zod schema objects (treated as opaque record)
type ZodLike = Record<string, unknown>

/**
 * Convert a Zod schema or plain JSON Schema object into an OpenAPI-compatible JSON Schema.
 * Supports ZodString, ZodNumber, ZodBoolean, ZodObject, ZodArray, ZodEnum, ZodUnion, and more.
 *
 * @param {unknown} schema - A Zod schema instance or a plain JSON Schema object
 * @returns {OpenApiSchema} The equivalent OpenAPI JSON Schema
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * const schema = zodToJsonSchema(z.object({ name: z.string(), age: z.number().int() }))
 * // { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name', 'age'] }
 * ```
 */
export function zodToJsonSchema(schema: unknown): OpenApiSchema {
  if (!schema || typeof schema !== 'object') return {}

  const s = schema as ZodLike

  // Already a plain JSON Schema object (no _def)
  if (!s._def) return s as OpenApiSchema

  const def = s._def as ZodLike
  const typeName: string = (def.typeName as string) || ''

  if (typeName === 'ZodString') {
    const result: OpenApiSchema = { type: 'string' }
    if (Array.isArray(def.checks)) {
      for (const check of def.checks as ZodLike[]) {
        if (check.kind === 'email') result.format = 'email'
        if (check.kind === 'url') result.format = 'uri'
        if (check.kind === 'uuid') result.format = 'uuid'
        if (check.kind === 'min') result.minLength = check.value
        if (check.kind === 'max') result.maxLength = check.value
      }
    }
    return result
  }

  if (typeName === 'ZodNumber') {
    const result: OpenApiSchema = { type: 'number' }
    if (Array.isArray(def.checks)) {
      for (const check of def.checks as ZodLike[]) {
        if (check.kind === 'int') result.type = 'integer'
        if (check.kind === 'min') result.minimum = check.value
        if (check.kind === 'max') result.maximum = check.value
      }
    }
    return result
  }

  if (typeName === 'ZodBoolean') return { type: 'boolean' }
  if (typeName === 'ZodNull') return { type: 'string', nullable: true }
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return {}

  if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
    const inner = zodToJsonSchema(def.innerType)
    return typeName === 'ZodNullable' ? { ...inner, nullable: true } : inner
  }

  if (typeName === 'ZodDefault') {
    const inner = zodToJsonSchema(def.innerType)
    const defaultFn = def.defaultValue
    return { ...inner, default: typeof defaultFn === 'function' ? (defaultFn as () => unknown)() : undefined }
  }

  if (typeName === 'ZodLiteral') {
    const val = def.value
    const t = typeof val
    return { type: t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : 'string', enum: [val] }
  }

  if (typeName === 'ZodEnum') {
    return { type: 'string', enum: def.values as unknown[] }
  }

  if (typeName === 'ZodNativeEnum') {
    const values = Object.values(def.values as Record<string, unknown>).filter(v => typeof v === 'string' || typeof v === 'number')
    const allNums = values.every(v => typeof v === 'number')
    return { type: allNums ? 'number' : 'string', enum: values }
  }

  if (typeName === 'ZodArray') {
    return { type: 'array', items: zodToJsonSchema(def.type) }
  }

  if (typeName === 'ZodObject') {
    const shape = typeof def.shape === 'function'
      ? (def.shape as () => Record<string, unknown>)()
      : def.shape as Record<string, unknown>
    const properties: Record<string, OpenApiSchema> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = zodToJsonSchema(value)
      properties[key] = fieldSchema

      // Field is required if it is NOT optional/default-wrapped at the top level
      const innerDef = (value as ZodLike)._def as ZodLike | undefined
      if (innerDef && innerDef.typeName !== 'ZodOptional' && innerDef.typeName !== 'ZodDefault') {
        required.push(key)
      }
    }

    const result: OpenApiSchema = { type: 'object', properties }
    if (required.length > 0) result.required = required
    return result
  }

  if (typeName === 'ZodUnion') {
    return { oneOf: (def.options as unknown[]).map(zodToJsonSchema) } as OpenApiSchema
  }

  if (typeName === 'ZodIntersection') {
    return { allOf: [zodToJsonSchema(def.left), zodToJsonSchema(def.right)] } as OpenApiSchema
  }

  if (typeName === 'ZodRecord') {
    return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) }
  }

  if (typeName === 'ZodTuple') {
    return { type: 'array', items: { oneOf: (def.items as unknown[]).map(zodToJsonSchema) } as OpenApiSchema }
  }

  // Fallback: unknown Zod type
  return {}
}
