import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { createConfigStore } from '../src/index'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ── getAll secret redaction ──────────────────────────────────────────────────

describe('getAll secret redaction', () => {
  test('redacts top-level sensitive keys by default', () => {
    const store = createConfigStore()
    store.register('mail', { host: 'smtp.example.com', password: 'hunter2' })
    const all = store.getAll()
    expect(all.mail.password).toBe('[REDACTED]')
    expect(all.mail.host).toBe('smtp.example.com')
  })

  test('redacts nested sensitive keys', () => {
    const store = createConfigStore()
    store.register('db', { conn: { user: 'admin', password: 'p', host: 'db' } })
    const all = store.getAll()
    expect(all.db.conn.password).toBe('[REDACTED]')
    expect(all.db.conn.user).toBe('admin')
  })

  test('redacts various sensitive key names', () => {
    const store = createConfigStore()
    store.register('svc', {
      apiKey: 'a',
      api_key: 'b',
      secret: 'c',
      token: 'd',
      accessKey: 'e',
      privateKey: 'f',
    })
    const all = store.getAll()
    expect(all.svc.apiKey).toBe('[REDACTED]')
    expect(all.svc.api_key).toBe('[REDACTED]')
    expect(all.svc.secret).toBe('[REDACTED]')
    expect(all.svc.token).toBe('[REDACTED]')
    expect(all.svc.accessKey).toBe('[REDACTED]')
    expect(all.svc.privateKey).toBe('[REDACTED]')
  })

  test('does not redact non-sensitive keys', () => {
    const store = createConfigStore()
    store.register('app', { name: 'MyApp', port: 3000 })
    const all = store.getAll()
    expect(all.app.name).toBe('MyApp')
    expect(all.app.port).toBe(3000)
  })

  test('redact: false returns raw values', () => {
    const store = createConfigStore()
    store.register('mail', { password: 'hunter2' })
    const all = store.getAll({ redact: false })
    expect(all.mail.password).toBe('hunter2')
  })

  test('redaction does not mutate the underlying store', () => {
    const store = createConfigStore()
    store.register('mail', { password: 'hunter2' })
    store.getAll()
    expect(store.get<string>('mail.password')).toBe('hunter2')
  })

  test('redacts sensitive keys inside arrays', () => {
    const store = createConfigStore()
    store.register('list', { items: [{ token: 'x' }, { token: 'y' }] })
    const all = store.getAll()
    expect(all.list.items[0].token).toBe('[REDACTED]')
    expect(all.list.items[1].token).toBe('[REDACTED]')
  })
})

// ── Schema validation ────────────────────────────────────────────────────────

describe('schema validation', () => {
  test('register throws when schema returns false', () => {
    const store = createConfigStore()
    expect(() => store.register('app', { port: 'oops' }, (v) => typeof v.port === 'number'))
      .toThrow(/app/)
  })

  test('register throws with custom message when schema returns string', () => {
    const store = createConfigStore()
    expect(() => store.register('app', {}, () => 'port is required'))
      .toThrow(/port is required/)
  })

  test('register succeeds when schema returns true', () => {
    const store = createConfigStore()
    expect(() => store.register('app', { port: 3000 }, (v) => typeof v.port === 'number'))
      .not.toThrow()
    expect(store.get<number>('app.port')).toBe(3000)
  })

  test('register without schema still works', () => {
    const store = createConfigStore()
    store.register('app', { port: 3000 })
    expect(store.get<number>('app.port')).toBe(3000)
  })
})

// ── Prototype-pollution / unsafe path access ─────────────────────────────────

describe('dot-path own-property safety', () => {
  test('get on __proto__ returns default', () => {
    const store = createConfigStore()
    store.register('app', { name: 'x' })
    expect(store.get('app.__proto__', 'safe')).toBe('safe')
  })

  test('get on constructor returns default', () => {
    const store = createConfigStore()
    store.register('app', { name: 'x' })
    expect(store.get('app.constructor', 'safe')).toBe('safe')
  })

  test('get on prototype returns default', () => {
    const store = createConfigStore()
    store.register('app', { name: 'x' })
    expect(store.get('app.prototype', 'safe')).toBe('safe')
  })
})

// ── loadDir error visibility ─────────────────────────────────────────────────

describe('loadDir error visibility', () => {
  let warnSpy: ReturnType<typeof mock>
  const originalWarn = console.warn
  let dir: string

  beforeEach(() => {
    warnSpy = mock(() => {})
    console.warn = warnSpy as any
    dir = mkdtempSync(join(tmpdir(), 'tekir-config-'))
  })

  afterEach(() => {
    console.warn = originalWarn
    rmSync(dir, { recursive: true, force: true })
  })

  test('warns instead of silently swallowing a broken config file', async () => {
    writeFileSync(join(dir, 'broken.ts'), 'this is not valid typescript !!! throw <<<')
    const store = createConfigStore()
    await store.loadDir(dir)
    expect(warnSpy).toHaveBeenCalled()
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(msg).toContain('broken')
  })

  test('loads a valid config file and registers it', async () => {
    writeFileSync(join(dir, 'good.ts'), 'export default { name: "Loaded" }')
    const store = createConfigStore()
    await store.loadDir(dir)
    expect(store.get<string>('good.name')).toBe('Loaded')
  })
})
