import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Cron } from '../src/manager'

describe('Cron.registerDir', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-cron-regdir-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('registers decorator-style job classes (with __schedules)', async () => {
    writeFileSync(
      join(tmp, 'cleanup.ts'),
      `
class CleanupJob {
  run() {}
}
CleanupJob.__schedules = [{ name: 'cleanup', pattern: '0 * * * *', method: 'run' }]
export default CleanupJob
`,
    )

    const cron = new Cron()
    await cron.registerDir(tmp)
    const list = cron.list()
    expect(list.find(j => j.name === 'cleanup')).toBeDefined()
    cron.stopAll()
  })

  test('invokes a functional registrar with the manager instance', async () => {
    writeFileSync(
      join(tmp, 'health.ts'),
      `export default async (cron) => { await cron.add('health-ping', '* * * * *', () => {}) }`,
    )

    const cron = new Cron()
    await cron.registerDir(tmp)
    expect(cron.list().find(j => j.name === 'health-ping')).toBeDefined()
    cron.stopAll()
  })

  test('uses a class with a register(cron) method', async () => {
    writeFileSync(
      join(tmp, 'reports.ts'),
      `
export default class ReportsJob {
  async register(cron) {
    await cron.add('report-daily', '0 9 * * *', () => {})
  }
}
`,
    )

    const cron = new Cron()
    await cron.registerDir(tmp)
    expect(cron.list().find(j => j.name === 'report-daily')).toBeDefined()
    cron.stopAll()
  })

  test('skips unrecognized exports with a warning', async () => {
    writeFileSync(join(tmp, 'config.ts'), `export default { rate: 5 }`)

    const cron = new Cron()
    const original = console.warn
    let warned = ''
    console.warn = (msg: string) => { warned = msg }
    try {
      await cron.registerDir(tmp)
    } finally {
      console.warn = original
    }

    expect(warned).toContain('cron.registerDir')
    expect(warned).toContain('unrecognized')
  })
})
