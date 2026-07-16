import { describe, expect, test } from 'bun:test'
import { ExceptionHandler, ServerTimingContext, sse } from '../src/index'

describe('framework regression contracts', () => {
  test('custom exception handlers may intentionally return falsy bodies', async () => {
    const error = Object.assign(new Error('x'), {
      statusCode: 418,
      handle: () => false,
    })
    const response = await new ExceptionHandler().handle(error, {} as any)
    expect(response.status).toBe(418)
    expect(await response.text()).toBe('false')
  })

  test('Server-Timing rejects invalid names and safely quotes descriptions', () => {
    const timing = new ServerTimingContext()
    expect(() => timing.add('bad\r\nname', 1)).toThrow('Invalid Server-Timing')
    timing.add('db', 1, 'query "users"\r\nnext')
    expect(timing.toHeader()).toContain('desc="query \\"users\\"  next"')
  })

  test('SSE preserves an explicit retry value of zero', () => {
    expect(sse({ data: 'x', retry: 0 })).toContain('retry: 0\n')
  })
})
