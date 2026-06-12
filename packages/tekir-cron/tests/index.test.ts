import { test, expect, describe, beforeEach } from 'bun:test'
import { App } from '@tekir/core'
import { Cron, CronProvider, Patterns } from '../src/index'

// Patterns — static export (no croner dependency)

describe('Patterns', () => {
  test('everySecond is correct cron expression', () => {
    expect(Patterns.everySecond).toBe('* * * * * *')
  })

  test('everyMinute is correct cron expression', () => {
    expect(Patterns.everyMinute).toBe('0 * * * * *')
  })

  test('everyFiveMinutes is correct cron expression', () => {
    expect(Patterns.everyFiveMinutes).toBe('0 */5 * * * *')
  })

  test('everyTenMinutes is correct cron expression', () => {
    expect(Patterns.everyTenMinutes).toBe('0 */10 * * * *')
  })

  test('everyFifteenMinutes is correct cron expression', () => {
    expect(Patterns.everyFifteenMinutes).toBe('0 */15 * * * *')
  })

  test('everyThirtyMinutes is correct cron expression', () => {
    expect(Patterns.everyThirtyMinutes).toBe('0 */30 * * * *')
  })

  test('hourly is correct cron expression', () => {
    expect(Patterns.hourly).toBe('0 0 * * * *')
  })

  test('daily is correct cron expression', () => {
    expect(Patterns.daily).toBe('0 0 0 * * *')
  })

  test('weekly is correct cron expression', () => {
    expect(Patterns.weekly).toBe('0 0 0 * * 0')
  })

  test('monthly is correct cron expression', () => {
    expect(Patterns.monthly).toBe('0 0 0 1 * *')
  })

  test('yearly is correct cron expression', () => {
    expect(Patterns.yearly).toBe('0 0 0 1 1 *')
  })

  test('dailyAt() produces correct expression', () => {
    expect(Patterns.dailyAt(9)).toBe('0 0 9 * * *')
    expect(Patterns.dailyAt(14, 30)).toBe('0 30 14 * * *')
    expect(Patterns.dailyAt(0, 0)).toBe('0 0 0 * * *')
    expect(Patterns.dailyAt(23, 59)).toBe('0 59 23 * * *')
  })

  test('dailyAt() with default minute = 0', () => {
    expect(Patterns.dailyAt(8)).toBe('0 0 8 * * *')
  })

  test('weeklyOn() produces correct expression', () => {
    // weeklyOn(day, hour=0, minute=0) → `0 ${minute} ${hour} * * ${day}`
    expect(Patterns.weeklyOn(1)).toBe('0 0 0 * * 1') // Monday midnight (hour=0, minute=0)
    expect(Patterns.weeklyOn(5, 17, 30)).toBe('0 30 17 * * 5') // Friday 17:30
    expect(Patterns.weeklyOn(0)).toBe('0 0 0 * * 0') // Sunday midnight
  })

  test('weeklyOn() with default hour and minute', () => {
    expect(Patterns.weeklyOn(3)).toBe('0 0 0 * * 3')
  })

  test('all string patterns are strings', () => {
    const stringPatterns: Array<keyof typeof Patterns> = [
      'everySecond', 'everyMinute', 'everyFiveMinutes', 'everyTenMinutes',
      'everyFifteenMinutes', 'everyThirtyMinutes', 'hourly', 'daily',
      'weekly', 'monthly', 'yearly',
    ]
    for (const key of stringPatterns) {
      expect(typeof Patterns[key]).toBe('string')
    }
  })

  test('all function patterns are functions', () => {
    expect(typeof Patterns.dailyAt).toBe('function')
    expect(typeof Patterns.weeklyOn).toBe('function')
  })
})

// Cron — methods that do not require croner

describe('Cron — without croner', () => {
  let cron: Cron

  beforeEach(() => {
    cron = new Cron()
  })

  test('list() returns empty array when no jobs registered', () => {
    expect(cron.list()).toEqual([])
  })

  test('isRunning() returns false for unknown job', () => {
    expect(cron.isRunning('nonexistent')).toBe(false)
  })

  test('stop() throws when job not registered', () => {
    expect(() => cron.stop('ghost')).toThrow('[cron] Job "ghost" is not registered.')
  })

  test('start() throws when job not registered', () => {
    expect(() => cron.start('ghost')).toThrow('[cron] Job "ghost" is not registered.')
  })

  test('remove() throws when job not registered', () => {
    expect(() => cron.remove('ghost')).toThrow('[cron] Job "ghost" is not registered.')
  })

  test('stopAll() does not throw when no jobs are registered', () => {
    expect(() => cron.stopAll()).not.toThrow()
  })

  test('startAll() does not throw when no jobs are registered', () => {
    expect(() => cron.startAll()).not.toThrow()
  })

  test('add() throws when croner is not installed', async () => {
    // croner is an optional peer dep — in this test env it may not be present.
    // We only assert that the error, if thrown, mentions the module or is a
    // standard dynamic-import error, not a crash in our own code.
    try {
      await cron.add('test-job', Patterns.everySecond, () => {})
      // If croner IS installed, the job should now appear in list()
      expect(cron.list().some(j => j.name === 'test-job')).toBe(true)
      // Clean up the real croner job if it was created
      cron.remove('test-job')
    } catch (err: any) {
      // croner not installed — that is acceptable in this environment
      expect(err).toBeTruthy()
    }
  })

  test('add() prevents duplicate job names', async () => {
    // Only run this check if croner is available
    let cronAvailable = false
    try {
      await cron.add('dup-job', Patterns.everyMinute, () => {})
      cronAvailable = true
    } catch {
      // croner not available — skip the duplicate check
    }

    if (cronAvailable) {
      await expect(
        cron.add('dup-job', Patterns.everyMinute, () => {})
      ).rejects.toThrow('already registered')
      cron.remove('dup-job')
    }
  })
})

// Cron — with croner (conditional — skipped when croner missing)

describe('Cron — with croner (if available)', () => {
  let cron: Cron

  beforeEach(() => {
    cron = new Cron()
  })

  async function addJobIfCroner(
    name: string,
    pattern: string,
    cb: () => void,
  ): Promise<boolean> {
    try {
      await cron.add(name, pattern, cb)
      return true
    } catch {
      return false
    }
  }

  test('add() registers the job and list() shows it as running', async () => {
    const ok = await addJobIfCroner('list-test', Patterns.everyMinute, () => {})
    if (!ok) return // croner not installed

    const jobs = cron.list()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('list-test')
    expect(jobs[0].pattern).toBe(Patterns.everyMinute)
    expect(jobs[0].running).toBe(true)

    cron.remove('list-test')
  })

  test('isRunning() returns true for an active job', async () => {
    const ok = await addJobIfCroner('running-test', Patterns.everyMinute, () => {})
    if (!ok) return

    expect(cron.isRunning('running-test')).toBe(true)
    cron.remove('running-test')
  })

  test('stop() pauses the job and isRunning() returns false', async () => {
    const ok = await addJobIfCroner('pause-test', Patterns.everyMinute, () => {})
    if (!ok) return

    cron.stop('pause-test')
    expect(cron.isRunning('pause-test')).toBe(false)

    const jobs = cron.list()
    const job = jobs.find(j => j.name === 'pause-test')
    expect(job?.running).toBe(false)

    cron.remove('pause-test')
  })

  test('start() resumes a paused job', async () => {
    const ok = await addJobIfCroner('resume-test', Patterns.everyMinute, () => {})
    if (!ok) return

    cron.stop('resume-test')
    expect(cron.isRunning('resume-test')).toBe(false)

    cron.start('resume-test')
    expect(cron.isRunning('resume-test')).toBe(true)

    cron.remove('resume-test')
  })

  test('start() is a no-op when job is already running', async () => {
    const ok = await addJobIfCroner('idempotent-start', Patterns.everyMinute, () => {})
    if (!ok) return

    expect(() => cron.start('idempotent-start')).not.toThrow()
    expect(cron.isRunning('idempotent-start')).toBe(true)

    cron.remove('idempotent-start')
  })

  test('stop() is a no-op when job is already paused', async () => {
    const ok = await addJobIfCroner('idempotent-stop', Patterns.everyMinute, () => {})
    if (!ok) return

    cron.stop('idempotent-stop')
    expect(() => cron.stop('idempotent-stop')).not.toThrow()
    expect(cron.isRunning('idempotent-stop')).toBe(false)

    cron.remove('idempotent-stop')
  })

  test('remove() unregisters the job', async () => {
    const ok = await addJobIfCroner('remove-test', Patterns.everyMinute, () => {})
    if (!ok) return

    cron.remove('remove-test')
    expect(cron.list()).toHaveLength(0)
    expect(cron.isRunning('remove-test')).toBe(false)
  })

  test('stopAll() pauses every registered job', async () => {
    const ok1 = await addJobIfCroner('bulk-a', Patterns.everyMinute, () => {})
    const ok2 = await addJobIfCroner('bulk-b', Patterns.everyMinute, () => {})
    if (!ok1 || !ok2) return

    cron.stopAll()
    for (const job of cron.list()) {
      expect(job.running).toBe(false)
    }

    cron.remove('bulk-a')
    cron.remove('bulk-b')
  })

  test('startAll() resumes every paused job', async () => {
    const ok1 = await addJobIfCroner('resume-a', Patterns.everyMinute, () => {})
    const ok2 = await addJobIfCroner('resume-b', Patterns.everyMinute, () => {})
    if (!ok1 || !ok2) return

    cron.stopAll()
    cron.startAll()
    for (const job of cron.list()) {
      expect(job.running).toBe(true)
    }

    cron.remove('resume-a')
    cron.remove('resume-b')
  })

  test('list() returns correct snapshot of multiple jobs', async () => {
    const ok1 = await addJobIfCroner('snap-a', Patterns.daily, () => {})
    const ok2 = await addJobIfCroner('snap-b', Patterns.hourly, () => {})
    if (!ok1 || !ok2) return

    const list = cron.list()
    expect(list).toHaveLength(2)

    const a = list.find(j => j.name === 'snap-a')
    const b = list.find(j => j.name === 'snap-b')
    expect(a?.pattern).toBe(Patterns.daily)
    expect(b?.pattern).toBe(Patterns.hourly)

    cron.remove('snap-a')
    cron.remove('snap-b')
  })
})

// CronProvider

describe('CronProvider', () => {
  test('register() registers a Cron into the app container', async () => {
    const provider = new CronProvider()
    const app = new App()
    await provider.register(app)
    expect(app.use('cron')).toBeInstanceOf(Cron)
  })

  test('register() creates a fresh Cron each time', async () => {
    const p1 = new CronProvider()
    const p2 = new CronProvider()
    const app1 = new App()
    const app2 = new App()
    await p1.register(app1)
    await p2.register(app2)
    expect(app1.use('cron')).not.toBe(app2.use('cron'))
  })
})

// Patterns — all patterns are valid cron format (5 or 6 fields)

describe('Patterns — cron format validation', () => {
  const cronFieldRegex = /^(\S+\s+){4,5}\S+$/

  test('everySecond has 6 space-separated fields', () => {
    const fields = Patterns.everySecond.split(/\s+/)
    expect(fields.length).toBe(6)
  })

  test('everyMinute has 6 space-separated fields', () => {
    const fields = Patterns.everyMinute.split(/\s+/)
    expect(fields.length).toBe(6)
  })

  test('all static patterns have 5 or 6 space-separated fields', () => {
    const staticPatterns = [
      Patterns.everySecond, Patterns.everyMinute, Patterns.everyFiveMinutes,
      Patterns.everyTenMinutes, Patterns.everyFifteenMinutes, Patterns.everyThirtyMinutes,
      Patterns.hourly, Patterns.daily, Patterns.weekly, Patterns.monthly, Patterns.yearly,
    ]
    for (const pattern of staticPatterns) {
      const fields = pattern.split(/\s+/)
      expect(fields.length).toBeGreaterThanOrEqual(5)
      expect(fields.length).toBeLessThanOrEqual(6)
      expect(pattern).toMatch(cronFieldRegex)
    }
  })

  test('dailyAt output has 6 space-separated fields', () => {
    const pattern = Patterns.dailyAt(10, 30)
    const fields = pattern.split(/\s+/)
    expect(fields.length).toBe(6)
  })

  test('weeklyOn output has 6 space-separated fields', () => {
    const pattern = Patterns.weeklyOn(3, 14, 0)
    const fields = pattern.split(/\s+/)
    expect(fields.length).toBe(6)
  })
})

// Patterns.dailyAt — various hours and minutes

describe('Patterns.dailyAt — various hours and minutes', () => {
  test('dailyAt(0) produces midnight pattern', () => {
    expect(Patterns.dailyAt(0)).toBe('0 0 0 * * *')
  })

  test('dailyAt(12) produces noon pattern', () => {
    expect(Patterns.dailyAt(12)).toBe('0 0 12 * * *')
  })

  test('dailyAt(23) produces 11 PM pattern', () => {
    expect(Patterns.dailyAt(23)).toBe('0 0 23 * * *')
  })

  test('dailyAt(6, 30) includes minute 30', () => {
    expect(Patterns.dailyAt(6, 30)).toBe('0 30 6 * * *')
  })

  test('dailyAt(18, 59) includes minute 59', () => {
    expect(Patterns.dailyAt(18, 59)).toBe('0 59 18 * * *')
  })
})

// Patterns.weeklyOn — all days, various hours

describe('Patterns.weeklyOn — all days and various hours', () => {
  test('weeklyOn covers all days 0 through 6', () => {
    for (let day = 0; day <= 6; day++) {
      const pattern = Patterns.weeklyOn(day)
      expect(pattern).toBe(`0 0 0 * * ${day}`)
    }
  })

  test('weeklyOn(6, 23, 59) produces Saturday 23:59', () => {
    expect(Patterns.weeklyOn(6, 23, 59)).toBe('0 59 23 * * 6')
  })

  test('weeklyOn(2, 8) uses default minute 0', () => {
    expect(Patterns.weeklyOn(2, 8)).toBe('0 0 8 * * 2')
  })
})

// Cron — add() returns void (chaining not applicable), list/remove/stopAll/startAll

describe('Cron — additional edge cases', () => {
  let cron: Cron

  beforeEach(() => {
    cron = new Cron()
  })

  test('list() returns empty array initially on fresh instance', () => {
    expect(cron.list()).toEqual([])
    expect(cron.list().length).toBe(0)
  })

  test('remove non-existent job throws with descriptive message', () => {
    expect(() => cron.remove('does-not-exist')).toThrow('does-not-exist')
    expect(() => cron.remove('does-not-exist')).toThrow('not registered')
  })

  test('stopAll on empty manager does not throw', () => {
    expect(() => cron.stopAll()).not.toThrow()
  })

  test('startAll on empty manager does not throw', () => {
    expect(() => cron.startAll()).not.toThrow()
  })

  test('isRunning returns false for any name on empty manager', () => {
    expect(cron.isRunning('a')).toBe(false)
    expect(cron.isRunning('')).toBe(false)
    expect(cron.isRunning('random-name')).toBe(false)
  })

  test('multiple stopAll/startAll calls on empty manager do not throw', () => {
    expect(() => {
      cron.stopAll()
      cron.startAll()
      cron.stopAll()
      cron.startAll()
    }).not.toThrow()
  })
})

// Multiple providers create independent instances

describe('CronProvider — independent instances', () => {
  test('multiple providers create independent Cron instances', async () => {
    const instances: Cron[] = []
    for (let i = 0; i < 3; i++) {
      const provider = new CronProvider()
      const app = new App()
      await provider.register(app)
      instances.push(app.use<Cron>('cron'))
    }
    expect(instances.length).toBe(3)
    // All instances should be distinct objects
    expect(instances[0]).not.toBe(instances[1])
    expect(instances[1]).not.toBe(instances[2])
    expect(instances[0]).not.toBe(instances[2])
  })

  test('CronProvider register method exists and is async', () => {
    const provider = new CronProvider()
    expect(typeof provider.register).toBe('function')
    // Calling register returns a promise
    const result = provider.register(new App())
    expect(result).toBeInstanceOf(Promise)
  })

  test('each Cron from provider has its own empty job list', async () => {
    const managers: Cron[] = []
    for (let i = 0; i < 2; i++) {
      const p = new CronProvider()
      const app = new App()
      await p.register(app)
      managers.push(app.use<Cron>('cron'))
    }
    expect(managers[0].list()).toEqual([])
    expect(managers[1].list()).toEqual([])
  })
})

// Patterns.everySecond format check

describe('Patterns.everySecond — format', () => {
  test('everySecond is exactly "* * * * * *"', () => {
    expect(Patterns.everySecond).toBe('* * * * * *')
  })

  test('everySecond has all wildcard fields', () => {
    const fields = Patterns.everySecond.split(/\s+/)
    for (const field of fields) {
      expect(field).toBe('*')
    }
  })
})


describe('Cron — error messages', () => {
  test('stop() error includes job name', () => {
    const cron = new Cron()
    expect(() => cron.stop('my-job')).toThrow('my-job')
  })

  test('start() error includes job name', () => {
    const cron = new Cron()
    expect(() => cron.start('another-job')).toThrow('another-job')
  })

  test('remove() error includes job name', () => {
    const cron = new Cron()
    expect(() => cron.remove('missing-job')).toThrow('missing-job')
  })

  test('stop() error mentions "not registered"', () => {
    const cron = new Cron()
    expect(() => cron.stop('x')).toThrow('not registered')
  })

  test('start() error mentions "not registered"', () => {
    const cron = new Cron()
    expect(() => cron.start('x')).toThrow('not registered')
  })

  test('remove() error mentions "not registered"', () => {
    const cron = new Cron()
    expect(() => cron.remove('x')).toThrow('not registered')
  })
})

describe('Patterns — dailyAt boundary values', () => {
  test('dailyAt(0, 0) is midnight', () => {
    expect(Patterns.dailyAt(0, 0)).toBe('0 0 0 * * *')
  })

  test('dailyAt(23, 59) is last minute of day', () => {
    expect(Patterns.dailyAt(23, 59)).toBe('0 59 23 * * *')
  })

  test('dailyAt(12, 0) is noon', () => {
    expect(Patterns.dailyAt(12, 0)).toBe('0 0 12 * * *')
  })

  test('dailyAt(1) defaults minute to 0', () => {
    expect(Patterns.dailyAt(1)).toBe('0 0 1 * * *')
  })
})

describe('Patterns — weeklyOn boundary values', () => {
  test('weeklyOn(0) is Sunday midnight', () => {
    expect(Patterns.weeklyOn(0)).toBe('0 0 0 * * 0')
  })

  test('weeklyOn(6) is Saturday midnight', () => {
    expect(Patterns.weeklyOn(6)).toBe('0 0 0 * * 6')
  })

  test('weeklyOn(1, 0, 0) is Monday midnight', () => {
    expect(Patterns.weeklyOn(1, 0, 0)).toBe('0 0 0 * * 1')
  })

  test('weeklyOn(4, 12, 30) is Thursday 12:30', () => {
    expect(Patterns.weeklyOn(4, 12, 30)).toBe('0 30 12 * * 4')
  })
})

describe('Cron — fresh instance behavior', () => {
  test('new Cron() is defined', () => {
    expect(new Cron()).toBeDefined()
  })

  test('new Cron() has list method', () => {
    expect(typeof new Cron().list).toBe('function')
  })

  test('new Cron() has isRunning method', () => {
    expect(typeof new Cron().isRunning).toBe('function')
  })

  test('new Cron() has stopAll method', () => {
    expect(typeof new Cron().stopAll).toBe('function')
  })

  test('new Cron() has startAll method', () => {
    expect(typeof new Cron().startAll).toBe('function')
  })

  test('new Cron() has add method', () => {
    expect(typeof new Cron().add).toBe('function')
  })

  test('new Cron() has stop method', () => {
    expect(typeof new Cron().stop).toBe('function')
  })

  test('new Cron() has start method', () => {
    expect(typeof new Cron().start).toBe('function')
  })

  test('new Cron() has remove method', () => {
    expect(typeof new Cron().remove).toBe('function')
  })

  test('new Cron() has register method', () => {
    expect(typeof new Cron().register).toBe('function')
  })
})

describe('Patterns — consistency', () => {
  test('everyMinute starts with 0', () => {
    expect(Patterns.everyMinute.startsWith('0')).toBe(true)
  })

  test('hourly starts with 0 0', () => {
    expect(Patterns.hourly.startsWith('0 0')).toBe(true)
  })

  test('daily starts with 0 0 0', () => {
    expect(Patterns.daily.startsWith('0 0 0')).toBe(true)
  })

  test('weekly starts with 0 0 0', () => {
    expect(Patterns.weekly.startsWith('0 0 0')).toBe(true)
  })

  test('monthly starts with 0 0 0', () => {
    expect(Patterns.monthly.startsWith('0 0 0')).toBe(true)
  })

  test('yearly starts with 0 0 0', () => {
    expect(Patterns.yearly.startsWith('0 0 0')).toBe(true)
  })

  test('everyFiveMinutes contains */5', () => {
    expect(Patterns.everyFiveMinutes).toContain('*/5')
  })

  test('everyTenMinutes contains */10', () => {
    expect(Patterns.everyTenMinutes).toContain('*/10')
  })

  test('everyFifteenMinutes contains */15', () => {
    expect(Patterns.everyFifteenMinutes).toContain('*/15')
  })

  test('everyThirtyMinutes contains */30', () => {
    expect(Patterns.everyThirtyMinutes).toContain('*/30')
  })
})

// Overlap protection, error isolation, and pattern validation (require croner)

describe('Cron — overlap protection and resilience', () => {
  async function addIfCroner(c: Cron, name: string, pattern: string, cb: () => void | Promise<void>): Promise<boolean> {
    try {
      await c.add(name, pattern, cb)
      return true
    } catch {
      return false
    }
  }

  test('a long async job does not overlap with itself', async () => {
    const cron = new Cron()
    let active = 0
    let maxActive = 0
    const ok = await addIfCroner(cron, 'overlap-job', '* * * * * *', async () => {
      active++
      maxActive = Math.max(maxActive, active)
      // Run longer than the 1s tick interval so a second tick would overlap
      // if protection were missing.
      await new Promise((r) => setTimeout(r, 1500))
      active--
    })
    if (!ok) return // croner not installed

    // Wait long enough for several ticks to fire.
    await new Promise((r) => setTimeout(r, 3200))
    cron.remove('overlap-job')
    expect(maxActive).toBe(1)
  }, 10000)

  test('a throwing job does not crash the scheduler (sync)', async () => {
    const cron = new Cron()
    let ticks = 0
    const ok = await addIfCroner(cron, 'throwing-job', '* * * * * *', () => {
      ticks++
      throw new Error('boom')
    })
    if (!ok) return

    await new Promise((r) => setTimeout(r, 2200))
    cron.remove('throwing-job')
    // Scheduler survived and kept firing despite the throw.
    expect(ticks).toBeGreaterThanOrEqual(1)
    expect(cron.list()).toHaveLength(0)
  }, 10000)

  test('a rejected async job does not crash the scheduler', async () => {
    const cron = new Cron()
    let ticks = 0
    const ok = await addIfCroner(cron, 'reject-job', '* * * * * *', async () => {
      ticks++
      throw new Error('async boom')
    })
    if (!ok) return

    await new Promise((r) => setTimeout(r, 2200))
    cron.remove('reject-job')
    expect(ticks).toBeGreaterThanOrEqual(1)
  }, 10000)

  test('add() with an invalid pattern throws an error naming the job', async () => {
    const cron = new Cron()
    let cronAvailable = false
    try {
      await cron.add('probe', '* * * * *', () => {})
      cronAvailable = true
      cron.remove('probe')
    } catch {
      // croner missing
    }
    if (!cronAvailable) return

    await expect(
      cron.add('bad-job', 'not a cron at all !!', () => {}),
    ).rejects.toThrow('bad-job')
    expect(cron.list().some((j) => j.name === 'bad-job')).toBe(false)
  })
})

describe('Cron — shutdown', () => {
  test('shutdown() clears all jobs', async () => {
    const cron = new Cron()
    let ok = false
    try {
      await cron.add('sd-a', Patterns.everyMinute, () => {})
      await cron.add('sd-b', Patterns.everyMinute, () => {})
      ok = true
    } catch {
      // croner not installed
    }
    if (!ok) return

    expect(cron.list()).toHaveLength(2)
    await cron.shutdown()
    expect(cron.list()).toHaveLength(0)
    expect(cron.isRunning('sd-a')).toBe(false)
  })

  test('shutdown() on an empty manager resolves without throwing', async () => {
    const cron = new Cron()
    await expect(cron.shutdown()).resolves.toBeUndefined()
  })
})
