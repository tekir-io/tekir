import { test, expect, describe } from 'bun:test'
import { Health, BaseCheck, Result } from '../src/index'

class OkCheck extends BaseCheck {
  name = 'ok'
  run(): Result { return Result.ok('fine') }
}

class SlowCheck extends BaseCheck {
  name = 'slow'
  constructor(private delay: number) { super() }
  async run(): Promise<Result> {
    await new Promise(r => setTimeout(r, this.delay))
    return Result.ok('done')
  }
}

class ThrowingCheck extends BaseCheck {
  name = 'boom'
  run(): Result { throw new Error('host=10.0.0.1 user=admin internal failure') }
}

describe('Health report does not leak debugInfo by default', () => {
  test('omits debugInfo unless debug is requested', async () => {
    const health = new Health().register(new OkCheck())
    const pub = await health.run()
    expect(pub.debugInfo).toBeUndefined()
    expect(pub).not.toHaveProperty('debugInfo')

    const internal = await health.run({ debug: true })
    expect(internal.debugInfo).toBeDefined()
    expect(typeof internal.debugInfo!.pid).toBe('number')
    expect(typeof internal.debugInfo!.version).toBe('string')
  })
})

describe('per-check timeout', () => {
  test('a hung check is reported as error, not hanging the report', async () => {
    const health = new Health().register([new OkCheck(), new SlowCheck(10000)])
    const start = Date.now()
    const report = await health.run({ timeout: 100 })
    const elapsed = Date.now() - start
    // Should finish quickly because the slow check times out.
    expect(elapsed).toBeLessThan(2000)
    const slow = report.checks.find(c => c.name === 'slow')!
    expect(slow.status).toBe('error')
    expect(slow.message).toContain('Timed out')
    expect(report.isHealthy).toBe(false)
    // The healthy check is still reported.
    expect(report.checks.find(c => c.name === 'ok')!.status).toBe('ok')
  })

  test('checks within the timeout still pass', async () => {
    const health = new Health().register(new SlowCheck(10))
    const report = await health.run({ timeout: 1000 })
    expect(report.checks[0].status).toBe('ok')
  })
})

describe('error isolation', () => {
  test('a check that throws becomes an error result instead of rejecting', async () => {
    const health = new Health().register([new OkCheck(), new ThrowingCheck()])
    const report = await health.run()
    expect(report.checks).toHaveLength(2)
    const boom = report.checks.find(c => c.name === 'boom')!
    expect(boom.status).toBe('error')
    // Internal detail (host/user) is not exposed in the report message.
    expect(boom.message).toBe('Check failed')
    expect(JSON.stringify(report)).not.toContain('10.0.0.1')
    expect(report.isHealthy).toBe(false)
  })
})

describe('hasChecks', () => {
  test('reports whether checks are registered', () => {
    const health = new Health()
    expect(health.hasChecks()).toBe(false)
    health.register(new OkCheck())
    expect(health.hasChecks()).toBe(true)
  })
})
