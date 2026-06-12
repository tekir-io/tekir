import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Emitter } from '../src/emitter'

describe('Emitter.registerDir', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-emitter-regdir-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('registers decorator-style listener classes (with __listeners)', async () => {
    writeFileSync(
      join(tmp, 'user.ts'),
      `
class UserListener {
  static seen = []
  onCreated(data) { UserListener.seen.push(data) }
}
UserListener.__listeners = [{ event: 'user:created', method: 'onCreated', once: false }]
export default UserListener
`,
    )

    const emitter = new Emitter()
    await emitter.registerDir(tmp)
    expect(emitter.listenerCount('user:created')).toBe(1)
    emitter.clearListeners()
  })

  test('invokes a functional registrar with the emitter instance', async () => {
    writeFileSync(
      join(tmp, 'analytics.ts'),
      `export default (emitter) => emitter.on('page:view', () => {})`,
    )

    const emitter = new Emitter()
    await emitter.registerDir(tmp)
    expect(emitter.listenerCount('page:view')).toBe(1)
    emitter.clearListeners()
  })

  test('uses a class with a register(emitter) method', async () => {
    writeFileSync(
      join(tmp, 'orders.ts'),
      `
export default class OrderListener {
  register(emitter) {
    emitter.on('order:placed', () => {})
  }
}
`,
    )

    const emitter = new Emitter()
    await emitter.registerDir(tmp)
    expect(emitter.listenerCount('order:placed')).toBe(1)
    emitter.clearListeners()
  })

  test('skips unrecognized exports with a warning', async () => {
    writeFileSync(join(tmp, 'config.ts'), `export default { topic: 'noop' }`)

    const emitter = new Emitter()
    const original = console.warn
    let warned = ''
    console.warn = (msg: string) => { warned = msg }
    try {
      await emitter.registerDir(tmp)
    } finally {
      console.warn = original
    }

    expect(warned).toContain('emitter.registerDir')
    expect(warned).toContain('unrecognized')
  })
})
