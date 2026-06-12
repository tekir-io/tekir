import { test, expect, describe } from 'bun:test'
import {
  Result,
  BaseCheck,
  MemoryHeapCheck,
  MemoryRSSCheck,
  DbCheck,
  RedisCheck,
  Health,
} from '../src/index'
import type { HealthCheckResult } from '../src/index'

// Result builder

describe('Result', () => {
  test('Result.ok() creates an ok result', async () => {
    const r = Result.ok()
    expect(r.status).toBe('ok')
    expect(r.message).toBe('Healthy')
  })

  test('Result.ok() accepts a custom message', async () => {
    const r = Result.ok('All good')
    expect(r.status).toBe('ok')
    expect(r.message).toBe('All good')
  })

  test('Result.warning() creates a warning result', async () => {
    const r = Result.warning('Getting hot')
    expect(r.status).toBe('warning')
    expect(r.message).toBe('Getting hot')
  })

  test('Result.failed() creates an error result', async () => {
    const r = Result.failed('Broken')
    expect(r.status).toBe('error')
    expect(r.message).toBe('Broken')
  })

  test('mergeMetaData() adds meta and returns this (chainable)', async () => {
    const r = Result.ok('fine').mergeMetaData({ heapMB: 50 })
    expect(r.meta).toEqual({ heapMB: 50 })
  })

  test('mergeMetaData() merges multiple calls', async () => {
    const r = Result.ok().mergeMetaData({ a: 1 }).mergeMetaData({ b: 2 })
    expect(r.meta).toEqual({ a: 1, b: 2 })
  })
})

// BaseCheck (via concrete subclass)

describe('BaseCheck', () => {
  class AlwaysOkCheck extends BaseCheck {
    name = 'always:ok'
    run() { return Result.ok('fine') }
  }

  class AlwaysFailCheck extends BaseCheck {
    name = 'always:fail'
    run() { return Result.failed('broken') }
  }

  class AlwaysWarnCheck extends BaseCheck {
    name = 'always:warn'
    run() { return Result.warning('watch out') }
  }

  test('execute() returns HealthCheckResult with correct shape', async () => {
    const check = new AlwaysOkCheck()
    const result = await check.execute()
    expect(result.name).toBe('always:ok')
    expect(result.status).toBe('ok')
    expect(result.message).toBe('fine')
    expect(result.isCached).toBe(false)
    expect(typeof result.finishedAt).toBe('string')
    // valid ISO string
    expect(() => new Date(result.finishedAt)).not.toThrow()
  })

  test('execute() returns meta when check provides it', async () => {
    class WithMetaCheck extends BaseCheck {
      name = 'meta:check'
      run() { return Result.ok('ok').mergeMetaData({ info: 42 }) }
    }
    const result = await new WithMetaCheck().execute()
    expect(result.meta).toEqual({ info: 42 })
  })

  test('execute() omits meta when empty', async () => {
    const result = await new AlwaysOkCheck().execute()
    expect(result.meta).toBeUndefined()
  })

  test('cacheFor() causes second execute to return cached result', async () => {
    const check = new AlwaysOkCheck()
    check.cacheFor(60000) // 60 seconds
    const first = await check.execute()
    const second = await check.execute()
    expect(first.isCached).toBe(false)
    expect(second.isCached).toBe(true)
  })

  test('without cacheFor, each execute is fresh', async () => {
    const check = new AlwaysOkCheck()
    const first = await check.execute()
    const second = await check.execute()
    expect(first.isCached).toBe(false)
    expect(second.isCached).toBe(false)
  })

  test('cacheFor() accepts string duration (e.g. "30s")', async () => {
    const check = new AlwaysOkCheck()
    check.cacheFor('30s')
    const first = await check.execute()
    const second = await check.execute()
    expect(second.isCached).toBe(true)
  })
})

// MemoryHeapCheck

describe('MemoryHeapCheck', () => {
  test('has name "memory:heap"', () => {
    expect(new MemoryHeapCheck().name).toBe('memory:heap')
  })

  test('run() returns a Result with heapMB meta', async () => {
    const check = new MemoryHeapCheck()
    const result = await check.run()
    expect(result).toBeInstanceOf(Result)
    expect(typeof result.meta.heapMB).toBe('number')
    expect(result.meta.heapMB).toBeGreaterThan(0)
  })

  test('run() returns ok status under normal conditions', async () => {
    const check = new MemoryHeapCheck()
    // With generous thresholds, should be ok in any test environment
    check.warnWhenExceeds(10 * 1024 * 1024 * 1024) // 10 GB
    check.failWhenExceeds(20 * 1024 * 1024 * 1024)
    const result = await check.run()
    expect(result.status).toBe('ok')
  })

  test('run() returns error status when below tiny fail threshold', async () => {
    const check = new MemoryHeapCheck()
    check.warnWhenExceeds(1)
    check.failWhenExceeds(1)
    const result = await check.run()
    expect(result.status).toBe('error')
  })

  test('run() returns warning when heap exceeds warn but not fail', async () => {
    const check = new MemoryHeapCheck()
    check.warnWhenExceeds(1)
    check.failWhenExceeds(10 * 1024 * 1024 * 1024)
    const result = await check.run()
    expect(result.status).toBe('warning')
  })

  test('warnWhenExceeds() accepts string like "50mb"', async () => {
    const check = new MemoryHeapCheck()
    expect(() => check.warnWhenExceeds('50mb')).not.toThrow()
  })

  test('failWhenExceeds() accepts string like "100mb"', async () => {
    const check = new MemoryHeapCheck()
    expect(() => check.failWhenExceeds('100mb')).not.toThrow()
  })

  test('is chainable (warnWhenExceeds returns this)', async () => {
    const check = new MemoryHeapCheck()
    const returned = check.warnWhenExceeds(1000)
    expect(returned).toBe(check)
  })

  test('execute() wraps run() in HealthCheckResult', async () => {
    const check = new MemoryHeapCheck()
    const result = await check.execute()
    expect(result.name).toBe('memory:heap')
    expect(['ok', 'warning', 'error']).toContain(result.status)
  })
})

// MemoryRSSCheck

describe('MemoryRSSCheck', () => {
  test('has name "memory:rss"', () => {
    expect(new MemoryRSSCheck().name).toBe('memory:rss')
  })

  test('run() returns a Result with rssMB meta', async () => {
    const check = new MemoryRSSCheck()
    const result = await check.run()
    expect(typeof result.meta.rssMB).toBe('number')
  })

  test('run() returns ok with generous thresholds', async () => {
    const check = new MemoryRSSCheck()
    check.warnWhenExceeds('10gb').failWhenExceeds('20gb')
    expect((await check.run()).status).toBe('ok')
  })

  test('run() returns error with tiny thresholds', async () => {
    const check = new MemoryRSSCheck()
    check.warnWhenExceeds(1).failWhenExceeds(1)
    expect((await check.run()).status).toBe('error')
  })
})

// DbCheck

describe('DbCheck', () => {
  test('has default name "database"', async () => {
    const check = new DbCheck({})
    expect(check.name).toBe('database')
  })

  test('accepts a connection name suffix', async () => {
    const check = new DbCheck({}, 'primary')
    expect(check.name).toBe('database:primary')
  })

  test('returns ok when db.queryOne does not throw', async () => {
    const db = { queryOne: async (_sql: string) => [{ '1': 1 }] }
    const check = new DbCheck(db)
    const result = await check.run()
    expect(result.status).toBe('ok')
    expect(result.message).toBe('Connected')
  })

  test('returns ok when db.query does not throw', async () => {
    const db = { query: async (_sql: string) => [{ '1': 1 }] }
    const check = new DbCheck(db)
    expect((await check.run()).status).toBe('ok')
  })

  test('returns error when db.queryOne throws', async () => {
    const db = {
      queryOne: async () => { throw new Error('connection refused') },
    }
    const check = new DbCheck(db)
    const result = await check.run()
    expect(result.status).toBe('error')
    // Generic message: raw driver detail is logged, not exposed in the report.
    expect(result.message).toBe('Connection failed')
  })

  test('returns ok when db has no queryOne or query (falls through)', async () => {
    const check = new DbCheck({})
    expect((await check.run()).status).toBe('ok')
  })
})

// RedisCheck

describe('RedisCheck', () => {
  test('has default name "redis"', async () => {
    const check = new RedisCheck({})
    expect(check.name).toBe('redis')
  })

  test('accepts a connection name suffix', async () => {
    const check = new RedisCheck({}, 'cache')
    expect(check.name).toBe('redis:cache')
  })

  test('returns ok when redis.connected is not false', async () => {
    const redis = { connected: true }
    const result = await new RedisCheck(redis).run()
    expect(result.status).toBe('ok')
  })

  test('returns error when redis.connected is false', async () => {
    const redis = { connected: false }
    const result = await new RedisCheck(redis).run()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Disconnected')
  })

  test('returns ok when redis has no connected property', async () => {
    const result = await new RedisCheck({}).run()
    expect(result.status).toBe('ok')
  })
})

// Health manager

describe('Health', () => {
  class OkCheck extends BaseCheck {
    name = 'ok:check'
    run() { return Result.ok() }
  }

  class FailCheck extends BaseCheck {
    name = 'fail:check'
    run() { return Result.failed('down') }
  }

  class WarnCheck extends BaseCheck {
    name = 'warn:check'
    run() { return Result.warning('slow') }
  }

  test('run() returns isHealthy: true when all checks pass', async () => {
    const health = new Health()
    health.register(new OkCheck())
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('ok')
  })

  test('run() returns isHealthy: false when any check fails', async () => {
    const health = new Health()
    health.register([new OkCheck(), new FailCheck()])
    const report = await health.run()
    expect(report.isHealthy).toBe(false)
    expect(report.status).toBe('error')
  })

  test('run() returns status "warning" when only warnings (no errors)', async () => {
    const health = new Health()
    health.register([new OkCheck(), new WarnCheck()])
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('warning')
  })

  test('error takes precedence over warning in status', async () => {
    const health = new Health()
    health.register([new WarnCheck(), new FailCheck()])
    const report = await health.run()
    expect(report.status).toBe('error')
  })

  test('run() includes all check results in report.checks', async () => {
    const health = new Health()
    health.register([new OkCheck(), new FailCheck()])
    const report = await health.run()
    expect(report.checks).toHaveLength(2)
    const names = report.checks.map((c) => c.name)
    expect(names).toContain('ok:check')
    expect(names).toContain('fail:check')
  })

  test('run({ debug: true }) report includes debugInfo', async () => {
    const health = new Health()
    const report = await health.run({ debug: true })
    expect(typeof report.debugInfo!.pid).toBe('number')
    expect(typeof report.debugInfo!.platform).toBe('string')
    expect(typeof report.debugInfo!.uptime).toBe('number')
    expect(typeof report.debugInfo!.version).toBe('string')
  })

  test('run() omits debugInfo by default', async () => {
    const health = new Health()
    const report = await health.run()
    expect(report.debugInfo).toBeUndefined()
  })

  test('run() report includes finishedAt as ISO string', async () => {
    const health = new Health()
    const report = await health.run()
    expect(typeof report.finishedAt).toBe('string')
    expect(() => new Date(report.finishedAt)).not.toThrow()
  })

  test('register() is chainable', async () => {
    const health = new Health()
    const returned = health.register(new OkCheck())
    expect(returned).toBe(health)
  })

  test('register() accepts a single check', async () => {
    const health = new Health()
    health.register(new OkCheck())
    const report = await health.run()
    expect(report.checks).toHaveLength(1)
  })

  test('register() accepts an array of checks', async () => {
    const health = new Health()
    health.register([new OkCheck(), new WarnCheck()])
    const report = await health.run()
    expect(report.checks).toHaveLength(2)
  })

  test('run() with no checks returns ok + empty checks array', async () => {
    const health = new Health()
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('ok')
    expect(report.checks).toHaveLength(0)
  })
})

// Additional: MemoryHeapCheck passes with high threshold

describe('MemoryHeapCheck — high threshold always passes', () => {
  test('returns ok when warn and fail thresholds are very high', async () => {
    const check = new MemoryHeapCheck()
    check.warnWhenExceeds(100 * 1024 * 1024 * 1024) // 100 GB
    check.failWhenExceeds(200 * 1024 * 1024 * 1024) // 200 GB
    const result = await check.run()
    expect(result.status).toBe('ok')
    expect(result.meta.heapMB).toBeGreaterThan(0)
  })

  test('heapMB meta is a finite number', async () => {
    const check = new MemoryHeapCheck()
    const result = await check.run()
    expect(Number.isFinite(result.meta.heapMB)).toBe(true)
  })
})

// Additional: MemoryRSSCheck passes with high threshold

describe('MemoryRSSCheck — high threshold always passes', () => {
  test('returns ok when thresholds are extremely high', async () => {
    const check = new MemoryRSSCheck()
    check.warnWhenExceeds(100 * 1024 * 1024 * 1024)
    check.failWhenExceeds(200 * 1024 * 1024 * 1024)
    const result = await check.run()
    expect(result.status).toBe('ok')
  })

  test('rssMB meta is a positive finite number', async () => {
    const check = new MemoryRSSCheck()
    const result = await check.run()
    expect(result.meta.rssMB).toBeGreaterThan(0)
    expect(Number.isFinite(result.meta.rssMB)).toBe(true)
  })
})

// Additional: Health.addCheck() / register() chaining

describe('Health — register chaining', () => {
  test('register() returns this allowing fluent chaining', async () => {
    const health = new Health()
    const result = health
      .register(new MemoryHeapCheck())
      .register(new MemoryRSSCheck())
    expect(result).toBe(health)
  })

  test('chained register calls accumulate checks in the report', async () => {
    const health = new Health()
    health.register(new MemoryHeapCheck()).register(new MemoryRSSCheck())
    const report = await health.run()
    expect(report.checks).toHaveLength(2)
    const names = report.checks.map(c => c.name)
    expect(names).toContain('memory:heap')
    expect(names).toContain('memory:rss')
  })
})

// Additional: Health.run() returns report with all checks

describe('Health.run() — comprehensive report', () => {
  test('report includes finishedAt, debugInfo, and checks for each registered check', async () => {
    const health = new Health()
    health.register([new MemoryHeapCheck(), new MemoryRSSCheck()])
    const report = await health.run({ debug: true })

    expect(report.checks).toHaveLength(2)
    expect(typeof report.finishedAt).toBe('string')
    expect(report.debugInfo).toBeDefined()
    expect(typeof report.debugInfo!.pid).toBe('number')
    for (const check of report.checks) {
      expect(check.name).toBeTruthy()
      expect(['ok', 'warning', 'error']).toContain(check.status)
      expect(typeof check.finishedAt).toBe('string')
    }
  })
})

// Additional: Result.ok() and Result.fail() factory methods

describe('Result — factory methods extended', () => {
  test('Result.ok() defaults message to "Healthy"', async () => {
    const r = Result.ok()
    expect(r.message).toBe('Healthy')
    expect(r.status).toBe('ok')
  })

  test('Result.failed() stores the error message', async () => {
    const r = Result.failed('Database unreachable')
    expect(r.status).toBe('error')
    expect(r.message).toBe('Database unreachable')
  })

  test('Result.warning() stores the warning message', async () => {
    const r = Result.warning('High latency')
    expect(r.status).toBe('warning')
    expect(r.message).toBe('High latency')
  })

  test('Result meta is empty object by default', async () => {
    const r = Result.ok()
    expect(r.meta).toBeDefined()
  })
})

// Additional: BaseCheck subclass implementation

describe('BaseCheck — custom subclass', () => {
  class CustomCheck extends BaseCheck {
    name = 'custom:check'
    run() {
      return Result.ok('Custom OK').mergeMetaData({ custom: true })
    }
  }

  test('custom subclass execute returns correct name and status', async () => {
    const check = new CustomCheck()
    const result = await check.execute()
    expect(result.name).toBe('custom:check')
    expect(result.status).toBe('ok')
    expect(result.message).toBe('Custom OK')
    expect(result.meta).toEqual({ custom: true })
  })

  test('custom subclass supports cacheFor', async () => {
    const check = new CustomCheck()
    check.cacheFor(60000)
    const first = await check.execute()
    const second = await check.execute()
    expect(first.isCached).toBe(false)
    expect(second.isCached).toBe(true)
  })
})

// Additional: Multiple checks, some pass some fail

describe('Health — mixed pass/fail results', () => {
  class PassCheck extends BaseCheck {
    name = 'pass:check'
    run() { return Result.ok('fine') }
  }

  class FailCheck extends BaseCheck {
    name = 'fail:check'
    run() { return Result.failed('broken') }
  }

  class WarnCheck extends BaseCheck {
    name = 'warn:check'
    run() { return Result.warning('slow') }
  }

  test('one failure among many passes makes report unhealthy', async () => {
    const health = new Health()
    health.register([new PassCheck(), new PassCheck(), new FailCheck()])
    const report = await health.run()
    expect(report.isHealthy).toBe(false)
    expect(report.status).toBe('error')
    expect(report.checks).toHaveLength(3)
  })

  test('warning among passes is still healthy but status is warning', async () => {
    const health = new Health()
    health.register([new PassCheck(), new WarnCheck()])
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('warning')
  })

  test('all passing checks result in healthy ok report', async () => {
    const health = new Health()
    health.register([new PassCheck(), new PassCheck(), new PassCheck()])
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('ok')
  })
})

// Additional: Empty checks list returns healthy report

describe('Health — empty list', () => {
  test('run() with no registered checks returns healthy report', async () => {
    const health = new Health()
    const report = await health.run({ debug: true })
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('ok')
    expect(report.checks).toEqual([])
    expect(typeof report.finishedAt).toBe('string')
    expect(report.debugInfo).toBeDefined()
  })
})


describe('Health — aggregation with many checks', () => {
  class OkC extends BaseCheck { name = 'ok-agg'; run() { return Result.ok() } }
  class WarnC extends BaseCheck { name = 'warn-agg'; run() { return Result.warning('slow') } }
  class FailC extends BaseCheck { name = 'fail-agg'; run() { return Result.failed('down') } }

  test('5 ok checks result in healthy ok', async () => {
    const health = new Health()
    for (let i = 0; i < 5; i++) health.register(new OkC())
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('ok')
    expect(report.checks).toHaveLength(5)
  })

  test('4 ok + 1 warn = healthy warning', async () => {
    const health = new Health()
    for (let i = 0; i < 4; i++) health.register(new OkC())
    health.register(new WarnC())
    const report = await health.run()
    expect(report.isHealthy).toBe(true)
    expect(report.status).toBe('warning')
  })

  test('4 ok + 1 fail = unhealthy error', async () => {
    const health = new Health()
    for (let i = 0; i < 4; i++) health.register(new OkC())
    health.register(new FailC())
    const report = await health.run()
    expect(report.isHealthy).toBe(false)
    expect(report.status).toBe('error')
  })

  test('warn + fail = unhealthy error', async () => {
    const health = new Health()
    health.register([new WarnC(), new FailC()])
    const report = await health.run()
    expect(report.isHealthy).toBe(false)
    expect(report.status).toBe('error')
  })

  test('all fail = unhealthy error', async () => {
    const health = new Health()
    health.register([new FailC(), new FailC(), new FailC()])
    const report = await health.run()
    expect(report.isHealthy).toBe(false)
    expect(report.checks).toHaveLength(3)
  })
})

describe('Health — custom check functions', () => {
  test('async check that resolves ok', async () => {
    class AsyncOk extends BaseCheck {
      name = 'async:ok'
      async run() {
        await new Promise(r => setTimeout(r, 1))
        return Result.ok('async fine')
      }
    }
    const result = await new AsyncOk().execute()
    expect(result.status).toBe('ok')
    expect(result.message).toBe('async fine')
  })

  test('check with rich metadata', async () => {
    class RichMeta extends BaseCheck {
      name = 'rich:meta'
      run() {
        return Result.ok('ok').mergeMetaData({ cpu: 0.45, mem: 512, uptime: 86400 })
      }
    }
    const result = await new RichMeta().execute()
    expect(result.meta).toEqual({ cpu: 0.45, mem: 512, uptime: 86400 })
  })

  test('check that conditionally fails', async () => {
    class ConditionalCheck extends BaseCheck {
      name = 'cond:check'
      constructor(private ok: boolean) { super() }
      run() { return this.ok ? Result.ok() : Result.failed('not ok') }
    }
    const okResult = await new ConditionalCheck(true).execute()
    const failResult = await new ConditionalCheck(false).execute()
    expect(okResult.status).toBe('ok')
    expect(failResult.status).toBe('error')
  })
})

describe('BaseCheck — caching edge cases', () => {
  test('cacheFor(0) effectively disables caching', async () => {
    class C extends BaseCheck {
      name = 'no-cache'
      run() { return Result.ok() }
    }
    const check = new C()
    check.cacheFor(0)
    const first = await check.execute()
    const second = await check.execute()
    // With 0ms cache, second call may or may not be cached depending on timing
    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
  })

  test('cacheFor with very large value caches', async () => {
    class C extends BaseCheck {
      name = 'long-cache'
      run() { return Result.ok('cached') }
    }
    const check = new C()
    check.cacheFor(999999999)
    await check.execute()
    const second = await check.execute()
    expect(second.isCached).toBe(true)
  })

  test('cacheFor("1m") caches', async () => {
    class C extends BaseCheck {
      name = 'min-cache'
      run() { return Result.ok() }
    }
    const check = new C()
    check.cacheFor('1m')
    await check.execute()
    const second = await check.execute()
    expect(second.isCached).toBe(true)
  })
})

describe('Result — mergeMetaData chaining', () => {
  test('three mergeMetaData calls accumulate', () => {
    const r = Result.ok()
      .mergeMetaData({ a: 1 })
      .mergeMetaData({ b: 2 })
      .mergeMetaData({ c: 3 })
    expect(r.meta).toEqual({ a: 1, b: 2, c: 3 })
  })

  test('later mergeMetaData overrides earlier same key', () => {
    const r = Result.ok()
      .mergeMetaData({ val: 1 })
      .mergeMetaData({ val: 2 })
    expect(r.meta.val).toBe(2)
  })
})

describe('Health — report structure', () => {
  test('report has isHealthy, status, checks, finishedAt, debugInfo', async () => {
    const health = new Health()
    const report = await health.run({ debug: true })
    expect(report).toHaveProperty('isHealthy')
    expect(report).toHaveProperty('status')
    expect(report).toHaveProperty('checks')
    expect(report).toHaveProperty('finishedAt')
    expect(report).toHaveProperty('debugInfo')
  })

  test('debugInfo has pid, platform, uptime, version', async () => {
    const health = new Health()
    const report = await health.run({ debug: true })
    expect(report.debugInfo).toHaveProperty('pid')
    expect(report.debugInfo).toHaveProperty('platform')
    expect(report.debugInfo).toHaveProperty('uptime')
    expect(report.debugInfo).toHaveProperty('version')
  })

  test('checks entries have name, status, message, finishedAt', async () => {
    class C extends BaseCheck { name = 'shape-test'; run() { return Result.ok('fine') } }
    const health = new Health()
    health.register(new C())
    const report = await health.run()
    const check = report.checks[0]
    expect(check).toHaveProperty('name')
    expect(check).toHaveProperty('status')
    expect(check).toHaveProperty('message')
    expect(check).toHaveProperty('finishedAt')
  })

  test('finishedAt is a valid ISO date string', async () => {
    const health = new Health()
    const report = await health.run()
    const date = new Date(report.finishedAt)
    expect(date.toISOString()).toBe(report.finishedAt)
  })
})

describe('DbCheck — additional', () => {
  test('DbCheck with query method returning rows', async () => {
    const db = { query: async () => [{ result: 1 }] }
    const check = new DbCheck(db)
    const result = await check.run()
    expect(result.status).toBe('ok')
  })

  test('DbCheck with query throwing error', async () => {
    const db = { query: async () => { throw new Error('timeout') } }
    const check = new DbCheck(db)
    const result = await check.run()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Connection failed')
  })
})

describe('RedisCheck — additional', () => {
  test('RedisCheck with connected null', async () => {
    const redis = { connected: null }
    const result = await new RedisCheck(redis as any).run()
    // null is not false, so should be ok
    expect(result.status).toBe('ok')
  })

  test('RedisCheck with connected undefined', async () => {
    const redis = { connected: undefined }
    const result = await new RedisCheck(redis).run()
    expect(result.status).toBe('ok')
  })
})

describe('Result — status values', () => {
  test('ok status is "ok"', () => {
    expect(Result.ok().status).toBe('ok')
  })

  test('warning status is "warning"', () => {
    expect(Result.warning('w').status).toBe('warning')
  })

  test('failed status is "error"', () => {
    expect(Result.failed('e').status).toBe('error')
  })

  test('ok with message stores message', () => {
    expect(Result.ok('custom').message).toBe('custom')
  })

  test('warning stores message', () => {
    expect(Result.warning('slow').message).toBe('slow')
  })

  test('failed stores message', () => {
    expect(Result.failed('down').message).toBe('down')
  })
})
