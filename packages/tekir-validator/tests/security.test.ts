import { test, expect, describe } from 'bun:test'
import { validate, ValidationError } from '../src/index'

// Minimal schema doubles that mimic the libraries' surface without pulling
// them in as deps. Each throws on invalid input, matching real behavior.

function fakeZod(transform: (d: any) => any, fail?: string) {
  return {
    parse(data: any) {
      if (fail) {
        const err: any = new Error('zod failed')
        err.issues = [{ path: [fail], message: `${fail} is invalid` }]
        throw err
      }
      return transform(data)
    },
  }
}

function fakeValibot(fail?: string) {
  return {
    parse(data: any) {
      if (fail) {
        const err: any = new Error('valibot failed')
        // Valibot path entries are objects with a `key`.
        err.issues = [{ path: [{ key: fail }], message: `${fail} is required` }]
        throw err
      }
      return data
    },
  }
}

async function run(options: Parameters<typeof validate>[0], ctx: any) {
  const mw = validate(options)
  let nextCalled = false
  await mw(ctx, async () => { nextCalled = true })
  return nextCalled
}

describe('atomic writeback', () => {
  test('a failing source leaves other sources unmutated', async () => {
    const ctx = {
      query: { page: '1' },
      body: { name: 'raw' },
    }
    let threw: any
    try {
      await run({
        // query succeeds and would coerce page -> number
        query: fakeZod((d) => ({ ...d, page: 1 })),
        // body fails
        body: fakeZod((d) => d, 'name'),
      }, ctx)
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ValidationError)
    // ctx.query must NOT have been coerced because body validation failed.
    expect(ctx.query).toEqual({ page: '1' })
    expect(ctx.body).toEqual({ name: 'raw' })
  })

  test('all sources commit only when everything passes', async () => {
    const ctx = {
      query: { page: '1' },
      body: { name: 'raw' },
    }
    const next = await run({
      query: fakeZod((d) => ({ ...d, page: 1 })),
      body: fakeZod((d) => ({ ...d, name: 'CLEAN' })),
    }, ctx)
    expect(next).toBe(true)
    expect(ctx.query).toEqual({ page: 1 } as unknown as typeof ctx.query)
    expect(ctx.body).toEqual({ name: 'CLEAN' })
  })
})

describe('fail-closed on unknown schema', () => {
  test('unrecognized schema shape throws instead of passing data through', async () => {
    const ctx = { body: { anything: 'goes' } }
    let threw: any
    try {
      // A plain object with neither parse/validate nor being callable.
      await run({ body: { notASchema: true } as any }, ctx)
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ValidationError)
  })
})

describe('valibot error formatting', () => {
  test('valibot field names are reported correctly (not [object Object])', async () => {
    const ctx = { body: {} }
    let threw: ValidationError | undefined
    try {
      await run({ body: fakeValibot('email') }, ctx)
    } catch (e) {
      threw = e as ValidationError
    }
    expect(threw).toBeInstanceOf(ValidationError)
    expect(threw!.fields).toHaveProperty('email')
    expect(JSON.stringify(threw!.fields)).not.toContain('[object Object]')
  })
})
