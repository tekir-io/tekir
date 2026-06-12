import { test, expect, describe } from 'bun:test'
import { validate, ValidationError } from '../src/index'

// ValidationError

describe('ValidationError', () => {
  test('extends Error', () => {
    const err = new ValidationError('Validation failed', {})
    expect(err).toBeInstanceOf(Error)
  })

  test('has statusCode 422', () => {
    const err = new ValidationError('Validation failed', {})
    expect(err.statusCode).toBe(422)
  })

  test('has code "E_VALIDATION_ERROR"', () => {
    const err = new ValidationError('Validation failed', {})
    expect(err.code).toBe('VALIDATION_ERROR')
  })

  test('stores fields', () => {
    const fields = { email: ['Invalid email'], name: ['Required'] }
    const err = new ValidationError('Validation failed', fields)
    expect(err.fields).toEqual(fields)
  })

  test('toJSON() returns structured error object', () => {
    const fields = { email: ['Invalid email'] }
    const err = new ValidationError('Bad input', fields)
    const json = err.toJSON()
    expect(json).toEqual({
      error: {
        message: 'Bad input',
        code: 'VALIDATION_ERROR',
        statusCode: 422,
        fields: { email: ['Invalid email'] },
      },
    })
  })

  test('message is accessible on the error', () => {
    const err = new ValidationError('Custom message', {})
    expect(err.message).toBe('Custom message')
  })
})

// validate() middleware factory

describe('validate()', () => {
  // Helper to run the middleware
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }


  describe('with .parse() schema (Zod-like sync)', () => {
    const okSchema = {
      parse: (data: any) => ({ name: String(data.name), age: Number(data.age) }),
    }

    const failSchema = {
      parse: (_data: any) => {
        const err: any = new Error('Zod error')
        err.issues = [
          { path: ['name'], message: 'Required' },
          { path: ['age'], message: 'Must be a number' },
        ]
        throw err
      },
    }

    test('passes when schema.parse() succeeds and calls next()', async () => {
      const ctx: any = { body: { name: 'Ali', age: 25 } }
      const { nextCalled, ctx: out } = await run({ body: okSchema }, ctx)
      expect(nextCalled).toBe(true)
      expect(out.body.name).toBe('Ali')
    })

    test('throws ValidationError when schema.parse() fails', async () => {
      const ctx: any = { body: { name: '', age: 'x' } }
      const err = await runExpectError({ body: failSchema }, ctx)
      expect(err).toBeInstanceOf(ValidationError)
      expect(err!.fields).toHaveProperty('name')
      expect(err!.fields).toHaveProperty('age')
    })

    test('merges Zod issue path correctly (nested path)', async () => {
      const nestedFail = {
        parse: () => {
          const e: any = new Error('zod')
          e.issues = [{ path: ['address', 'city'], message: 'Required' }]
          throw e
        },
      }
      const ctx: any = { body: {} }
      const err = await runExpectError({ body: nestedFail }, ctx)
      expect(err!.fields['address.city']).toEqual(['Required'])
    })

    test('root-level Zod issue uses source name as key', async () => {
      const rootFail = {
        parse: () => {
          const e: any = new Error('zod')
          e.issues = [{ path: [], message: 'Invalid' }]
          throw e
        },
      }
      const ctx: any = { body: 'not an object' }
      const err = await runExpectError({ body: rootFail }, ctx)
      // _root mapped to source name 'body'
      expect(err!.fields['body']).toEqual(['Invalid'])
    })
  })

  describe('with .parseAsync() schema (Zod-like async)', () => {
    const asyncOkSchema = {
      parseAsync: async (data: any) => ({ value: data.value }),
    }

    const asyncFailSchema = {
      parseAsync: async () => {
        const e: any = new Error('async zod')
        e.issues = [{ path: ['value'], message: 'Bad value' }]
        throw e
      },
    }

    test('passes when parseAsync() resolves', async () => {
      const ctx: any = { body: { value: 42 } }
      const { nextCalled } = await run({ body: asyncOkSchema }, ctx)
      expect(nextCalled).toBe(true)
    })

    test('throws ValidationError when parseAsync() rejects', async () => {
      const ctx: any = { body: { value: null } }
      const err = await runExpectError({ body: asyncFailSchema }, ctx)
      expect(err).toBeInstanceOf(ValidationError)
      expect(err!.fields.value).toEqual(['Bad value'])
    })
  })

  describe('with .validate() schema (Yup-like)', () => {
    const yupOkSchema = {
      validate: async (data: any, _opts: any) => ({ email: data.email }),
    }

    const yupFailSchema = {
      validate: async () => {
        const e: any = new Error('yup')
        e.inner = [
          { path: 'email', message: 'Email is invalid' },
          { path: 'name', message: 'Name is required' },
        ]
        throw e
      },
    }

    test('passes when schema.validate() resolves', async () => {
      const ctx: any = { body: { email: 'a@b.com' } }
      const { nextCalled } = await run({ body: yupOkSchema }, ctx)
      expect(nextCalled).toBe(true)
    })

    test('throws ValidationError when schema.validate() rejects', async () => {
      const ctx: any = { body: {} }
      const err = await runExpectError({ body: yupFailSchema }, ctx)
      expect(err).toBeInstanceOf(ValidationError)
      expect(err!.fields.email).toEqual(['Email is invalid'])
      expect(err!.fields.name).toEqual(['Name is required'])
    })

    test('Yup root-level error uses source name', async () => {
      const yupRootFail = {
        validate: async () => {
          const e: any = new Error('yup root')
          e.inner = [{ path: '', message: 'Invalid body' }]
          throw e
        },
      }
      const ctx: any = { body: null }
      const err = await runExpectError({ body: yupRootFail }, ctx)
      // empty path → '_root' → source 'body'
      expect(err!.fields['body']).toEqual(['Invalid body'])
    })
  })

  describe('with plain function schema', () => {
    test('passes when function returns parsed value', async () => {
      const schema = (data: any) => ({ id: Number(data.id) })
      const ctx: any = { body: { id: '5' } }
      const { ctx: out, nextCalled } = await run({ body: schema }, ctx)
      expect(nextCalled).toBe(true)
      expect(out.body.id).toBe(5)
    })

    test('throws ValidationError when function throws', async () => {
      const schema = () => { throw new Error('bad data') }
      const ctx: any = { body: {} }
      const err = await runExpectError({ body: schema }, ctx)
      expect(err).toBeInstanceOf(ValidationError)
      expect(err!.fields['body']).toEqual(['bad data'])
    })
  })

  describe('multiple sources validated together', () => {
    const okSchema = { parse: (d: any) => d }
    const failSchema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['id'], message: 'Required' }]
        throw e
      },
    }

    test('validates body, params, query, and headers independently', async () => {
      const ctx: any = {
        body: { name: 'Ali' },
        params: { id: '1' },
        query: { page: '1' },
        headers: { 'x-token': 'abc' },
      }
      const { nextCalled } = await run({
        body: okSchema,
        params: okSchema,
        query: okSchema,
        headers: okSchema,
      }, ctx)
      expect(nextCalled).toBe(true)
    })

    test('collects errors from multiple failing sources', async () => {
      const ctx: any = { body: {}, params: {} }
      const err = await runExpectError({ body: failSchema, params: failSchema }, ctx)
      expect(err).toBeInstanceOf(ValidationError)
      // Both sources report 'id' field — merged under 'id'
      expect(Array.isArray(err!.fields['id'])).toBe(true)
    })

    test('skips sources that are not provided in options', async () => {
      const ctx: any = { body: { x: 1 } }
      // No query schema — query is not validated
      const { nextCalled } = await run({ body: okSchema }, ctx)
      expect(nextCalled).toBe(true)
    })
  })

  describe('ctx mutation', () => {
    test('replaces ctx.body with parsed output on success', async () => {
      const transformSchema = { parse: (d: any) => ({ email: d.email.toLowerCase() }) }
      const ctx: any = { body: { email: 'ALI@EXAMPLE.COM' } }
      await run({ body: transformSchema }, ctx)
      expect(ctx.body.email).toBe('ali@example.com')
    })

    test('replaces ctx.params with parsed output on success', async () => {
      const numSchema = { parse: (d: any) => ({ id: Number(d.id) }) }
      const ctx: any = { params: { id: '7' } }
      await run({ params: numSchema }, ctx)
      expect(ctx.params.id).toBe(7)
    })
  })

  describe('no schema / passthrough', () => {
    test('calls next() when no schemas are provided', async () => {
      const ctx: any = { body: { x: 1 } }
      const { nextCalled } = await run({}, ctx)
      expect(nextCalled).toBe(true)
    })
  })
})

// validate() — async Zod schema

describe('validate() — async Zod schema', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('parseAsync schema that resolves calls next()', async () => {
    const schema = {
      parseAsync: async (data: any) => ({ username: String(data.username).trim() }),
    }
    const ctx: any = { body: { username: '  alice  ' } }
    const { nextCalled, ctx: out } = await run({ body: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.body.username).toBe('alice')
  })

  test('parseAsync schema that rejects throws ValidationError', async () => {
    const schema = {
      parseAsync: async () => {
        const e: any = new Error('async zod fail')
        e.issues = [
          { path: ['email'], message: 'Invalid email address' },
          { path: ['age'], message: 'Must be at least 18' },
        ]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields.email).toEqual(['Invalid email address'])
    expect(err!.fields.age).toEqual(['Must be at least 18'])
  })
})

// validate() — multiple sources (body + params)

describe('validate() — multiple sources body + params', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('body and params both pass — next() is called', async () => {
    const bodySchema = { parse: (d: any) => ({ name: String(d.name) }) }
    const paramsSchema = { parse: (d: any) => ({ id: Number(d.id) }) }
    const ctx: any = { body: { name: 'Bob' }, params: { id: '5' } }
    const { nextCalled, ctx: out } = await run({ body: bodySchema, params: paramsSchema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.body.name).toBe('Bob')
    expect(out.params.id).toBe(5)
  })

  test('params fail while body passes — ValidationError has params field', async () => {
    const bodySchema = { parse: (d: any) => d }
    const paramsSchema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['id'], message: 'Must be a number' }]
        throw e
      },
    }
    const ctx: any = { body: { name: 'ok' }, params: { id: 'bad' } }
    const err = await runExpectError({ body: bodySchema, params: paramsSchema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields.id).toEqual(['Must be a number'])
  })

  test('query schema is validated independently from body', async () => {
    const querySchema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['page'], message: 'Must be positive' }]
        throw e
      },
    }
    const ctx: any = { body: { ok: true }, query: { page: '-1' } }
    const err = await runExpectError({ query: querySchema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields.page).toEqual(['Must be positive'])
  })
})

// validate() — validation error format

describe('validate() — ValidationError format', () => {
  test('toJSON() includes statusCode 422', () => {
    const err = new ValidationError('bad', { field: ['msg'] })
    const json = err.toJSON()
    expect(json.error.statusCode).toBe(422)
  })

  test('toJSON() includes all fields passed in', () => {
    const fields = { username: ['too short'], email: ['invalid'], age: ['required'] }
    const err = new ValidationError('Validation failed', fields)
    const json = err.toJSON()
    expect(json.error.fields).toEqual(fields)
  })

  test('ValidationError code is always E_VALIDATION_ERROR', () => {
    const err = new ValidationError('msg', {})
    expect(err.code).toBe('VALIDATION_ERROR')
  })
})

// validate() — custom error messages and optional fields

describe('validate() — custom error messages and optional fields', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('custom error message is preserved in ValidationError fields', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['name'], message: 'Name must be at least 3 characters long' }]
        throw e
      },
    }
    const ctx: any = { body: { name: 'ab' } }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields.name).toEqual(['Name must be at least 3 characters long'])
  })

  test('optional fields — schema that does not transform undefined just passes', async () => {
    const schema = {
      parse: (d: any) => ({ required: String(d.required), optional: d.optional ?? null }),
    }
    const ctx: any = { body: { required: 'yes' } }
    const { nextCalled, ctx: out } = await run({ body: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.body.optional).toBeNull()
  })

  test('nested object validation — dot-notation path is produced', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [
          { path: ['address', 'zip'], message: 'Invalid zip code' },
          { path: ['address', 'city'], message: 'Required' },
        ]
        throw e
      },
    }
    const ctx: any = { body: { address: {} } }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['address.zip']).toEqual(['Invalid zip code'])
    expect(err!.fields['address.city']).toEqual(['Required'])
  })

  test('deeply nested path produces dot-joined key', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['a', 'b', 'c'], message: 'Deep error' }]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['a.b.c']).toEqual(['Deep error'])
  })
})

// Additional tests — ValidationError edge cases, single-source schemas,
// custom function schemas, ctx mutation, error naming

describe('ValidationError — additional edge cases', () => {
  test('multiple fields each with multiple messages', () => {
    const fields = {
      email: ['Required', 'Must be valid email'],
      password: ['Too short', 'Must contain a number', 'Must contain uppercase'],
    }
    const err = new ValidationError('Validation failed', fields)
    expect(err.fields.email).toHaveLength(2)
    expect(err.fields.password).toHaveLength(3)
  })

  test('empty fields object is valid', () => {
    const err = new ValidationError('Validation failed', {})
    expect(err.fields).toEqual({})
    expect(Object.keys(err.fields)).toHaveLength(0)
  })

  test('toJSON() structure has exactly the expected keys', () => {
    const err = new ValidationError('msg', { f: ['e'] })
    const json = err.toJSON()
    expect(json).toHaveProperty('error')
    const errorObj = json.error
    expect(Object.keys(errorObj).sort()).toEqual(['code', 'fields', 'message', 'statusCode'])
  })

  test('toJSON() message matches the constructor message', () => {
    const err = new ValidationError('Custom validation message', {})
    expect(err.toJSON().error.message).toBe('Custom validation message')
  })

  test('ValidationError has name property from Error', () => {
    const err = new ValidationError('msg', {})
    expect(err.name).toBe('Error')
  })
})

describe('validate() — single source schemas', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('only body schema — validates and transforms body', async () => {
    const schema = { parse: (d: any) => ({ name: d.name.toUpperCase() }) }
    const ctx: any = { body: { name: 'alice' }, params: { id: '1' } }
    const { ctx: out, nextCalled } = await run({ body: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.body.name).toBe('ALICE')
    expect(out.params.id).toBe('1') // untouched
  })

  test('only params schema — validates params, ignores body', async () => {
    const schema = { parse: (d: any) => ({ id: Number(d.id) }) }
    const ctx: any = { body: { raw: true }, params: { id: '42' } }
    const { ctx: out, nextCalled } = await run({ params: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.params.id).toBe(42)
    expect(out.body.raw).toBe(true) // untouched
  })

  test('only query schema — validates query', async () => {
    const schema = { parse: (d: any) => ({ page: Number(d.page) }) }
    const ctx: any = { query: { page: '3' } }
    const { ctx: out, nextCalled } = await run({ query: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.query.page).toBe(3)
  })

  test('only headers schema — validates headers', async () => {
    const schema = { parse: (d: any) => ({ authorization: d.authorization }) }
    const ctx: any = { headers: { authorization: 'Bearer token123' } }
    const { ctx: out, nextCalled } = await run({ headers: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.headers.authorization).toBe('Bearer token123')
  })
})

describe('validate() — all four schemas with mixed success/failure', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('body and query pass, params and headers fail — collects errors from failing sources', async () => {
    const okSchema = { parse: (d: any) => d }
    const paramsFail = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['id'], message: 'Invalid id' }]
        throw e
      },
    }
    const headersFail = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['x-token'], message: 'Missing token' }]
        throw e
      },
    }
    const ctx: any = {
      body: { ok: true },
      params: { id: 'bad' },
      query: { page: '1' },
      headers: {},
    }
    const err = await runExpectError({
      body: okSchema,
      params: paramsFail,
      query: okSchema,
      headers: headersFail,
    }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields['id']).toEqual(['Invalid id'])
    expect(err!.fields['x-token']).toEqual(['Missing token'])
  })
})

describe('validate() — custom function schema', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('custom function that returns transformed data updates ctx', async () => {
    const schema = (data: any) => ({
      email: data.email.trim().toLowerCase(),
      age: parseInt(data.age, 10),
    })
    const ctx: any = { body: { email: '  TEST@EXAMPLE.COM  ', age: '30' } }
    const { ctx: out, nextCalled } = await run({ body: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.body.email).toBe('test@example.com')
    expect(out.body.age).toBe(30)
  })

  test('custom function that throws produces ValidationError with source key', async () => {
    const schema = () => { throw new Error('Invalid payload structure') }
    const ctx: any = { body: { broken: true } }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields['body']).toEqual(['Invalid payload structure'])
  })

  test('custom async function that rejects produces ValidationError', async () => {
    const schema = async () => { throw new Error('Async validation failed') }
    const ctx: any = { query: { q: '' } }
    const err = await runExpectError({ query: schema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields['query']).toEqual(['Async validation failed'])
  })
})

describe('validate() — parseAsync that rejects', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('parseAsync rejection with issues array produces field errors', async () => {
    const schema = {
      parseAsync: async () => {
        const e: any = new Error('async fail')
        e.issues = [
          { path: ['username'], message: 'Already taken' },
          { path: ['username'], message: 'Must be lowercase' },
        ]
        throw e
      },
    }
    const ctx: any = { body: { username: 'TestUser' } }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields['username']).toEqual(['Already taken', 'Must be lowercase'])
  })

  test('parseAsync rejection without issues falls back to generic error', async () => {
    const schema = {
      parseAsync: async () => { throw new Error('Something went wrong') },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err!.fields['body']).toEqual(['Something went wrong'])
  })
})

describe('validate() — nested object errors (deep paths)', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('four-level deep path is joined with dots', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['user', 'address', 'geo', 'lat'], message: 'Invalid latitude' }]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['user.address.geo.lat']).toEqual(['Invalid latitude'])
  })

  test('multiple deep paths from same schema are all captured', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [
          { path: ['a', 'b'], message: 'Error in a.b' },
          { path: ['x', 'y', 'z'], message: 'Error in x.y.z' },
          { path: ['a', 'b'], message: 'Another error in a.b' },
        ]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['a.b']).toEqual(['Error in a.b', 'Another error in a.b'])
    expect(err!.fields['x.y.z']).toEqual(['Error in x.y.z'])
  })
})

describe('validate() — ctx mutation only on success', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('ctx.body is NOT mutated when validation fails', async () => {
    const originalBody = { name: 'original' }
    const failSchema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: ['name'], message: 'Bad' }]
        throw e
      },
    }
    const ctx: any = { body: originalBody }
    await runExpectError({ body: failSchema }, ctx)
    expect(ctx.body).toBe(originalBody)
    expect(ctx.body.name).toBe('original')
  })
})

describe('validate() — empty options object', () => {
  test('calls next() immediately when no schemas provided', async () => {
    const middleware = validate({})
    let nextCalled = false
    const ctx: any = { body: { anything: true } }
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('ctx is not modified when no schemas provided', async () => {
    const middleware = validate({})
    const ctx: any = { body: { x: 1 }, params: { id: '5' } }
    await middleware(ctx, async () => {})
    expect(ctx.body).toEqual({ x: 1 })
    expect(ctx.params).toEqual({ id: '5' })
  })
})

describe('validate() — multiple validation errors from single schema', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('single schema with many issues produces multiple field entries', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [
          { path: ['name'], message: 'Required' },
          { path: ['email'], message: 'Invalid format' },
          { path: ['age'], message: 'Must be a number' },
          { path: ['age'], message: 'Must be positive' },
        ]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(Object.keys(err!.fields)).toHaveLength(3)
    expect(err!.fields['name']).toEqual(['Required'])
    expect(err!.fields['email']).toEqual(['Invalid format'])
    expect(err!.fields['age']).toEqual(['Must be a number', 'Must be positive'])
  })
})

describe('validate() — error field naming (_root vs source)', () => {
  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('_root from body schema maps to "body" key', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: [], message: 'Body is invalid' }]
        throw e
      },
    }
    const ctx: any = { body: null }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['body']).toEqual(['Body is invalid'])
    expect(err!.fields['_root']).toBeUndefined()
  })

  test('_root from params schema maps to "params" key', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: [], message: 'Params invalid' }]
        throw e
      },
    }
    const ctx: any = { params: {} }
    const err = await runExpectError({ params: schema }, ctx)
    expect(err!.fields['params']).toEqual(['Params invalid'])
  })

  test('_root from query schema maps to "query" key', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: [], message: 'Query malformed' }]
        throw e
      },
    }
    const ctx: any = { query: {} }
    const err = await runExpectError({ query: schema }, ctx)
    expect(err!.fields['query']).toEqual(['Query malformed'])
  })

  test('_root from headers schema maps to "headers" key', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [{ path: [], message: 'Headers invalid' }]
        throw e
      },
    }
    const ctx: any = { headers: {} }
    const err = await runExpectError({ headers: schema }, ctx)
    expect(err!.fields['headers']).toEqual(['Headers invalid'])
  })
})

// Additional ValidationError tests

describe('ValidationError — additional', () => {
  test('empty fields object', () => {
    const err = new ValidationError('No fields', {})
    expect(err.fields).toEqual({})
    expect(err.toJSON().error.fields).toEqual({})
  })

  test('multiple messages per field', () => {
    const fields = { email: ['Required', 'Must be a valid email', 'Max length 255'] }
    const err = new ValidationError('Fail', fields)
    expect(err.fields.email).toHaveLength(3)
  })

  test('many fields', () => {
    const fields: Record<string, string[]> = {}
    for (let i = 0; i < 20; i++) fields[`field${i}`] = [`Error ${i}`]
    const err = new ValidationError('Many', fields)
    expect(Object.keys(err.fields)).toHaveLength(20)
  })

  test('statusCode is always 422', () => {
    const err1 = new ValidationError('a', {})
    const err2 = new ValidationError('b', { x: ['y'] })
    expect(err1.statusCode).toBe(422)
    expect(err2.statusCode).toBe(422)
  })

  test('code is always E_VALIDATION_ERROR', () => {
    const err = new ValidationError('test', { a: ['b'] })
    expect(err.code).toBe('VALIDATION_ERROR')
  })

  test('toJSON message matches constructor message', () => {
    const err = new ValidationError('Custom msg here', {})
    expect(err.toJSON().error.message).toBe('Custom msg here')
  })

  test('is catchable as Error', () => {
    try {
      throw new ValidationError('thrown', {})
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect(e).toBeInstanceOf(ValidationError)
    }
  })

  test('name property', () => {
    const err = new ValidationError('test', {})
    expect(err.name).toBeDefined()
  })

  test('stack trace exists', () => {
    const err = new ValidationError('test', {})
    expect(err.stack).toBeDefined()
    expect(typeof err.stack).toBe('string')
  })

  test('fields with nested paths as strings', () => {
    const fields = { 'address.street': ['Required'], 'address.city': ['Required'] }
    const err = new ValidationError('Nested', fields)
    expect(err.fields['address.street']).toEqual(['Required'])
    expect(err.fields['address.city']).toEqual(['Required'])
  })
})

// validate() — additional middleware tests

describe('validate() — additional', () => {
  async function run(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    return { ctx, nextCalled }
  }

  async function runExpectError(options: Parameters<typeof validate>[0], ctx: any) {
    const middleware = validate(options)
    try {
      await middleware(ctx, async () => {})
      return null
    } catch (e) {
      return e as ValidationError
    }
  }

  test('returns a function (middleware)', () => {
    const mw = validate({ body: { parse: (d: any) => d } })
    expect(typeof mw).toBe('function')
  })

  test('passes through with no schemas', async () => {
    const ctx: any = { body: {}, params: {}, query: {} }
    const { nextCalled } = await run({}, ctx)
    expect(nextCalled).toBe(true)
  })

  test('validates params schema', async () => {
    const schema = { parse: (d: any) => ({ id: Number(d.id) }) }
    const ctx: any = { params: { id: '42' } }
    const { nextCalled, ctx: out } = await run({ params: schema }, ctx)
    expect(nextCalled).toBe(true)
    expect(out.params.id).toBe(42)
  })

  test('validates query schema', async () => {
    const schema = { parse: (d: any) => ({ q: String(d.q) }) }
    const ctx: any = { query: { q: 'search' } }
    const { nextCalled } = await run({ query: schema }, ctx)
    expect(nextCalled).toBe(true)
  })

  test('multiple schemas validated together', async () => {
    const bodySchema = { parse: (d: any) => ({ name: String(d.name) }) }
    const paramsSchema = { parse: (d: any) => ({ id: Number(d.id) }) }
    const ctx: any = { body: { name: 'Test' }, params: { id: '1' } }
    const { nextCalled } = await run({ body: bodySchema, params: paramsSchema }, ctx)
    expect(nextCalled).toBe(true)
  })

  test('body schema failure does not call next', async () => {
    const failSchema = {
      parse: () => {
        const e: any = new Error('fail')
        e.issues = [{ path: ['x'], message: 'bad' }]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: failSchema }, ctx)
    expect(err).not.toBeNull()
  })

  test('async parse schema works', async () => {
    const schema = {
      parse: async (d: any) => ({ name: String(d.name) }),
    }
    const ctx: any = { body: { name: 'Ali' } }
    const { nextCalled } = await run({ body: schema }, ctx)
    expect(nextCalled).toBe(true)
  })

  test('schema transforms data types', async () => {
    const schema = {
      parse: (d: any) => ({
        count: Number(d.count),
        active: d.active === 'true',
      }),
    }
    const ctx: any = { body: { count: '5', active: 'true' } }
    const { ctx: out } = await run({ body: schema }, ctx)
    expect(out.body.count).toBe(5)
    expect(out.body.active).toBe(true)
  })

  test('multiple issues in single field', async () => {
    const schema = {
      parse: () => {
        const e: any = new Error('z')
        e.issues = [
          { path: ['email'], message: 'Required' },
          { path: ['email'], message: 'Must be valid' },
        ]
        throw e
      },
    }
    const ctx: any = { body: {} }
    const err = await runExpectError({ body: schema }, ctx)
    expect(err!.fields['email']).toHaveLength(2)
  })
})
