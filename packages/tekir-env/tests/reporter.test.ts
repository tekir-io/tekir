import { test, expect, describe } from 'bun:test'
import { defineEnv, str, num } from '../src/index'

describe('defineEnv custom reporter', () => {
  test('custom reporter can throw instead of exiting on missing required var', () => {
    expect(() =>
      defineEnv(
        { REQUIRED_THING: str() },
        {
          reporter: ({ errors }) => {
            const keys = Object.keys(errors)
            if (keys.length) throw new Error(`invalid env: ${keys.join(',')}`)
          },
        },
      ),
    ).toThrow(/invalid env/)
  })

  test('valid env with defaults resolves and reporter sees no errors', () => {
    const env = defineEnv(
      { PORT: num({ default: 1234 }) },
      { reporter: ({ errors }) => {
        if (Object.keys(errors).length) throw new Error('unexpected errors')
      } },
    )
    expect(env.PORT).toBe(1234)
  })

  test('defineEnv still works with no options (backward compatible)', () => {
    const env = defineEnv({ SOME_OPTIONAL: str({ default: 'ok' }) })
    expect(env.SOME_OPTIONAL).toBe('ok')
  })
})
