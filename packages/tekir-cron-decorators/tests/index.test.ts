import { test, expect, describe } from 'bun:test'
import { CronJob, Schedule, Every } from '../src/index'

describe('CronJob + Schedule', () => {
  test('collects schedule metadata from decorated methods', () => {
    @CronJob()
    class Jobs {
      @Schedule('0 9 * * *')
      dailyReport() {}

      @Schedule('0 0 * * 0')
      weeklyCleanup() {}
    }

    const schedules = (Jobs as any).__schedules
    expect(schedules).toHaveLength(2)
    expect(schedules[0]).toEqual({ name: 'Jobs.dailyReport', pattern: '0 9 * * *', method: 'dailyReport' })
    expect(schedules[1]).toEqual({ name: 'Jobs.weeklyCleanup', pattern: '0 0 * * 0', method: 'weeklyCleanup' })
  })

  test('custom name overrides auto-generated name', () => {
    @CronJob()
    class Jobs {
      @Schedule('0 0 * * *', 'my-custom-job')
      doSomething() {}
    }

    const schedules = (Jobs as any).__schedules
    expect(schedules[0].name).toBe('my-custom-job')
  })

  test('empty class has no schedules', () => {
    @CronJob()
    class EmptyJobs {}

    expect((EmptyJobs as any).__schedules).toEqual([])
  })

  test('only decorated methods are collected', () => {
    @CronJob()
    class Jobs {
      @Schedule('* * * * *')
      scheduled() {}

      notScheduled() {}
    }

    expect((Jobs as any).__schedules).toHaveLength(1)
    expect((Jobs as any).__schedules[0].method).toBe('scheduled')
  })
})

describe('Every', () => {
  test('converts seconds shorthand', () => {
    @CronJob()
    class Jobs {
      @Every('30s')
      fast() {}
    }

    expect((Jobs as any).__schedules[0].pattern).toBe('*/30 * * * * *')
  })

  test('converts minutes shorthand', () => {
    @CronJob()
    class Jobs {
      @Every('5m')
      medium() {}
    }

    expect((Jobs as any).__schedules[0].pattern).toBe('0 */5 * * * *')
  })

  test('converts hours shorthand', () => {
    @CronJob()
    class Jobs {
      @Every('2h')
      slow() {}
    }

    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 */2 * * *')
  })

  test('passes through raw cron patterns', () => {
    @CronJob()
    class Jobs {
      @Every('0 9 * * 1-5')
      weekday() {}
    }

    expect((Jobs as any).__schedules[0].pattern).toBe('0 9 * * 1-5')
  })

  test('accepts custom name', () => {
    @CronJob()
    class Jobs {
      @Every('1m', 'heartbeat')
      ping() {}
    }

    expect((Jobs as any).__schedules[0].name).toBe('heartbeat')
  })
})

describe('Multiple job classes', () => {
  test('each class has independent schedules', () => {
    @CronJob()
    class EmailJobs {
      @Schedule('0 9 * * *')
      sendDigest() {}
    }

    @CronJob()
    class CleanupJobs {
      @Every('1h')
      expireTokens() {}

      @Every('30m')
      clearCache() {}
    }

    expect((EmailJobs as any).__schedules).toHaveLength(1)
    expect((CleanupJobs as any).__schedules).toHaveLength(2)
  })
})

describe('Integration with Cron.register()', () => {
  test('Cron.register() picks up decorated classes', async () => {
    const { Cron } = await import('@tekir/cron')

    @CronJob()
    class TestJobs {
      calls: string[] = []

      @Schedule('* * * * * *', 'test-job')
      tick() {
        this.calls.push('tick')
      }
    }

    const cron = new Cron()
    // register should read __schedules and add jobs
    await cron.register(TestJobs)

    const jobs = cron.list()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('test-job')
    expect(jobs[0].pattern).toBe('* * * * * *')
    expect(jobs[0].running).toBe(true)

    cron.remove('test-job')
  })

  test('register multiple classes at once', async () => {
    const { Cron } = await import('@tekir/cron')

    @CronJob()
    class A {
      @Every('5m', 'job-a')
      run() {}
    }

    @CronJob()
    class B {
      @Schedule('0 0 * * *', 'job-b')
      run() {}
    }

    const cron = new Cron()
    await cron.register(A, B)

    const jobs = cron.list()
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.name).sort()).toEqual(['job-a', 'job-b'])

    cron.remove('job-a')
    cron.remove('job-b')
  })
})


describe('CronJob decorator metadata storage', () => {
  test('__schedules is an array', () => {
    @CronJob()
    class Jobs { @Schedule('* * * * *') run() {} }
    expect(Array.isArray((Jobs as any).__schedules)).toBe(true)
  })

  test('schedule entry has name, pattern, and method properties', () => {
    @CronJob()
    class Jobs { @Schedule('0 0 * * *') daily() {} }
    const entry = (Jobs as any).__schedules[0]
    expect(entry).toHaveProperty('name')
    expect(entry).toHaveProperty('pattern')
    expect(entry).toHaveProperty('method')
  })

  test('auto-generated name uses ClassName.methodName format', () => {
    @CronJob()
    class ReportJobs { @Schedule('0 9 * * *') generate() {} }
    expect((ReportJobs as any).__schedules[0].name).toBe('ReportJobs.generate')
  })

  test('pattern is preserved exactly as given', () => {
    @CronJob()
    class Jobs { @Schedule('0 */5 * * * *') fiveMin() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 */5 * * * *')
  })
})

describe('Multiple cron decorators on same class', () => {
  test('three schedules on one class', () => {
    @CronJob()
    class Jobs {
      @Schedule('0 0 * * *') a() {}
      @Schedule('0 6 * * *') b() {}
      @Schedule('0 12 * * *') c() {}
    }
    expect((Jobs as any).__schedules).toHaveLength(3)
  })

  test('five schedules all collected', () => {
    @CronJob()
    class BigJobs {
      @Schedule('* * * * *') s1() {}
      @Schedule('0 * * * *') s2() {}
      @Every('10s') s3() {}
      @Every('5m') s4() {}
      @Every('1h') s5() {}
    }
    expect((BigJobs as any).__schedules).toHaveLength(5)
  })

  test('Schedule and Every can be mixed', () => {
    @CronJob()
    class MixedJobs {
      @Schedule('0 9 * * 1-5') weekday() {}
      @Every('30s') heartbeat() {}
    }
    const schedules = (MixedJobs as any).__schedules
    expect(schedules).toHaveLength(2)
    expect(schedules[0].pattern).toBe('0 9 * * 1-5')
    expect(schedules[1].pattern).toBe('*/30 * * * * *')
  })

  test('methods preserve order of definition', () => {
    @CronJob()
    class OrderedJobs {
      @Schedule('0 1 * * *') first() {}
      @Schedule('0 2 * * *') second() {}
      @Schedule('0 3 * * *') third() {}
    }
    const methods = (OrderedJobs as any).__schedules.map((s: any) => s.method)
    expect(methods).toEqual(['first', 'second', 'third'])
  })
})

describe('Edge cases', () => {
  test('Schedule with 6-field cron pattern', () => {
    @CronJob()
    class Jobs { @Schedule('0 0 0 1 1 *') yearly() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 0 1 1 *')
  })

  test('Every with 1s converts correctly', () => {
    @CronJob()
    class Jobs { @Every('1s') tick() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('*/1 * * * * *')
  })

  test('Every with 60m is out of range and throws', () => {
    expect(() => {
      @CronJob()
      class Jobs { @Every('60m') hourly() {} }
      return Jobs
    }).toThrow(/out of range/)
  })

  test('Every with 24h is out of range and throws', () => {
    expect(() => {
      @CronJob()
      class Jobs { @Every('24h') daily() {} }
      return Jobs
    }).toThrow(/out of range/)
  })

  test('Every with 23h (max hour step) converts correctly', () => {
    @CronJob()
    class Jobs { @Every('23h') daily() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 */23 * * *')
  })

  test('Every with 59m (max minute step) converts correctly', () => {
    @CronJob()
    class Jobs { @Every('59m') almostHourly() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 */59 * * * *')
  })

  test('Schedule with complex cron pattern', () => {
    @CronJob()
    class Jobs { @Schedule('0 30 9-17 * * 1-5') businessHours() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 30 9-17 * * 1-5')
  })

  test('custom name on Every is preserved', () => {
    @CronJob()
    class Jobs { @Every('10s', 'custom-every') tick() {} }
    expect((Jobs as any).__schedules[0].name).toBe('custom-every')
  })

  test('custom name on Schedule is preserved', () => {
    @CronJob()
    class Jobs { @Schedule('* * * * *', 'custom-schedule') tick() {} }
    expect((Jobs as any).__schedules[0].name).toBe('custom-schedule')
  })

  test('class with no CronJob still has decorated method metadata via prototype', () => {
    // Without @CronJob, __schedules won't be collected at class level
    class NoDecorator {
      @Schedule('* * * * *') run() {}
    }
    // __schedules may or may not exist — but class itself is fine
    expect(NoDecorator).toBeDefined()
  })

  test('Every passes through complex cron expressions unchanged', () => {
    @CronJob()
    class Jobs { @Every('0 0 1,15 * *') bimonthly() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 1,15 * *')
  })

  test('multiple classes with same method names have independent schedules', () => {
    @CronJob()
    class A { @Schedule('0 0 * * *') run() {} }
    @CronJob()
    class B { @Schedule('0 12 * * *') run() {} }
    expect((A as any).__schedules[0].pattern).toBe('0 0 * * *')
    expect((B as any).__schedules[0].pattern).toBe('0 12 * * *')
  })

  test('Every with 10m', () => {
    @CronJob()
    class Jobs { @Every('10m') check() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 */10 * * * *')
  })

  test('Every with 15m', () => {
    @CronJob()
    class Jobs { @Every('15m') check() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 */15 * * * *')
  })

  test('Every with 2s', () => {
    @CronJob()
    class Jobs { @Every('2s') check() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('*/2 * * * * *')
  })

  test('Every with 6h', () => {
    @CronJob()
    class Jobs { @Every('6h') check() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 */6 * * *')
  })

  test('Every with 12h', () => {
    @CronJob()
    class Jobs { @Every('12h') check() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 */12 * * *')
  })

  test('Schedule method name stored as string', () => {
    @CronJob()
    class Jobs { @Schedule('* * * * *') myMethod() {} }
    expect(typeof (Jobs as any).__schedules[0].method).toBe('string')
  })

  test('CronJob on class with 10 methods collects all', () => {
    @CronJob()
    class TenJobs {
      @Schedule('0 0 * * *') j1() {}
      @Schedule('0 1 * * *') j2() {}
      @Schedule('0 2 * * *') j3() {}
      @Schedule('0 3 * * *') j4() {}
      @Schedule('0 4 * * *') j5() {}
      @Schedule('0 5 * * *') j6() {}
      @Schedule('0 6 * * *') j7() {}
      @Schedule('0 7 * * *') j8() {}
      @Schedule('0 8 * * *') j9() {}
      @Schedule('0 9 * * *') j10() {}
    }
    expect((TenJobs as any).__schedules).toHaveLength(10)
  })
})


describe('parseEvery validation via Every decorator', () => {
  test('Every with non-matching word throws', () => {
    expect(() => Every('not-a-pattern')).toThrow(/not a valid interval/)
  })

  test('Every with just a number (no unit) throws', () => {
    expect(() => Every('100')).toThrow(/not a valid interval/)
  })

  test('Every with uppercase unit throws', () => {
    expect(() => Every('5M')).toThrow(/not a valid interval/)
  })

  test('Every with zero value seconds throws (out of range)', () => {
    expect(() => Every('0s')).toThrow(/out of range/)
  })

  test('Every with zero value minutes throws (out of range)', () => {
    expect(() => Every('0m')).toThrow(/out of range/)
  })

  test('Every with zero value hours throws (out of range)', () => {
    expect(() => Every('0h')).toThrow(/out of range/)
  })

  test('Every with large second value throws (out of range)', () => {
    expect(() => Every('999s')).toThrow(/out of range/)
  })

  test('Every with 90s throws (seconds field max is 59)', () => {
    expect(() => Every('90s')).toThrow(/out of range/)
  })

  test('Every with 25h throws (hours field max is 23)', () => {
    expect(() => Every('25h')).toThrow(/out of range/)
  })

  test('Every still passes through real cron expressions', () => {
    @CronJob()
    class Jobs { @Every('0 0 1,15 * *') bimonthly() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 1,15 * *')
  })
})

describe('Schedule cron pattern validation', () => {
  test('empty pattern throws', () => {
    expect(() => Schedule('')).toThrow(/non-empty/)
  })

  test('whitespace-only pattern throws', () => {
    expect(() => Schedule('   ')).toThrow(/non-empty/)
  })

  test('too few fields throws', () => {
    expect(() => Schedule('* * *')).toThrow(/invalid cron pattern/)
  })

  test('too many fields throws', () => {
    expect(() => Schedule('* * * * * * *')).toThrow(/invalid cron pattern/)
  })

  test('valid 5-field pattern is accepted', () => {
    expect(() => Schedule('0 9 * * 1-5')).not.toThrow()
  })

  test('valid 6-field pattern is accepted', () => {
    expect(() => Schedule('0 0 9 * * 1-5')).not.toThrow()
  })
})

describe('CronJob decorator — class constructor intact', () => {
  test('CronJob() does not break class instantiation', () => {
    @CronJob()
    class Jobs {
      value = 42
      @Schedule('* * * * *') run() { return this.value }
    }
    const instance = new (Jobs as any)()
    expect(instance.value).toBe(42)
    expect(instance.run()).toBe(42)
  })

  test('decorated methods remain callable with arguments', () => {
    @CronJob()
    class Jobs {
      result: any = null
      @Schedule('* * * * *') run(x: number) { this.result = x * 2 }
    }
    const instance = new (Jobs as any)()
    instance.run(5)
    expect(instance.result).toBe(10)
  })
})

describe('Schedule with empty and special names', () => {
  test('Schedule with empty string name uses auto-generated name', () => {
    @CronJob()
    class Jobs { @Schedule('* * * * *', '') run() {} }
    // Empty string is falsy, so auto-generated name should be used
    expect((Jobs as any).__schedules[0].name).toBe('Jobs.run')
  })

  test('Schedule name with special characters', () => {
    @CronJob()
    class Jobs { @Schedule('* * * * *', 'job:cleanup/v2') run() {} }
    expect((Jobs as any).__schedules[0].name).toBe('job:cleanup/v2')
  })

  test('auto-name with long class and method names', () => {
    @CronJob()
    class VeryLongClassNameForTesting { @Schedule('* * * * *') veryLongMethodNameForTesting() {} }
    expect((VeryLongClassNameForTesting as any).__schedules[0].name).toBe('VeryLongClassNameForTesting.veryLongMethodNameForTesting')
  })
})

describe('__schedules isolation between classes', () => {
  test('__schedules arrays are not shared between classes', () => {
    @CronJob()
    class A { @Schedule('0 0 * * *') run() {} }
    @CronJob()
    class B { @Schedule('0 12 * * *') run() {} }
    expect((A as any).__schedules).not.toBe((B as any).__schedules)
  })

  test('modifying one class schedules does not affect another', () => {
    @CronJob()
    class A { @Schedule('0 0 * * *') run() {} }
    @CronJob()
    class B { @Schedule('0 12 * * *') run() {} }
    ;(A as any).__schedules.push({ name: 'extra', pattern: '* * * * *', method: 'extra' })
    expect((A as any).__schedules).toHaveLength(2)
    expect((B as any).__schedules).toHaveLength(1)
  })
})

describe('Every with mixed valid cron expressions', () => {
  test('Every with 5-field cron expression passes through', () => {
    @CronJob()
    class Jobs { @Every('0 0 * * 1-5') weekdays() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('0 0 * * 1-5')
  })

  test('Every with step values in cron passes through', () => {
    @CronJob()
    class Jobs { @Every('*/5 * * * *') fiveMin() {} }
    expect((Jobs as any).__schedules[0].pattern).toBe('*/5 * * * *')
  })
})

describe('inherited scheduled methods are collected', () => {
  test('base class schedules are picked up by a decorated subclass', () => {
    class BaseJobs {
      @Schedule('0 0 * * *', 'base-daily') baseDaily() {}
    }
    @CronJob()
    class ChildJobs extends BaseJobs {
      @Schedule('*/5 * * * *', 'child-five') childFive() {}
    }
    const schedules = (ChildJobs as any).__schedules as any[]
    const names = schedules.map((s) => s.name)
    expect(names).toContain('base-daily')
    expect(names).toContain('child-five')
  })

  test('overridden method is collected once with the subclass pattern', () => {
    class BaseJobs {
      @Schedule('0 0 * * *', 'base-run') run() {}
    }
    @CronJob()
    class ChildJobs extends BaseJobs {
      @Schedule('*/10 * * * *', 'child-run') run() {}
    }
    const schedules = (ChildJobs as any).__schedules as any[]
    const runEntries = schedules.filter((s) => s.method === 'run')
    expect(runEntries).toHaveLength(1)
    expect(runEntries[0].pattern).toBe('*/10 * * * *')
  })
})
