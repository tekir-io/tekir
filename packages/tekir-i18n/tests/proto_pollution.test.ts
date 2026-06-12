import { test, expect, describe, afterEach } from 'bun:test'
import { I18n } from '../src/i18n'

describe('I18n — prototype pollution prevention', () => {
  afterEach(() => {
    // Ensure no test leaked a polluted prototype into the shared realm.
    expect(({} as any).polluted).toBeUndefined()
    delete (Object.prototype as any).polluted
  })

  test('load() ignores __proto__ key and does not pollute Object.prototype', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', JSON.parse('{"__proto__": {"polluted": "yes"}, "hello": "Hi"}'))
    expect(({} as any).polluted).toBeUndefined()
    expect(i.t('hello')).toBe('Hi')
  })

  test('load() ignores constructor and prototype keys', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', JSON.parse('{"constructor": "x", "prototype": "y", "ok": "good"}'))
    expect(i.t('ok')).toBe('good')
    // constructor/prototype were skipped, so the key itself is returned.
    expect(i.t('constructor')).toBe('constructor')
    expect(i.t('prototype')).toBe('prototype')
  })

  test('t(__proto__) returns the key, never an inherited member', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { hello: 'Hi' })
    expect(i.t('__proto__')).toBe('__proto__')
  })

  test('t(toString) returns the key, never the inherited function', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { hello: 'Hi' })
    const result = i.t('toString')
    expect(result).toBe('toString')
    expect(typeof result).toBe('string')
  })

  test('t(constructor) returns the key and never throws on .replace', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { hello: 'Hi' })
    expect(() => i.t('constructor', { x: '1' })).not.toThrow()
    expect(i.t('constructor', { x: '1' })).toBe('constructor')
  })

  test('load() with __proto__ locale name is ignored', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('__proto__', { hello: 'Hi' })
    expect(({} as any).hello).toBeUndefined()
    expect(i.availableLocales).not.toContain('__proto__')
  })

  test('a non-string stored value does not break t()', () => {
    const i = new I18n({ defaultLocale: 'en' })
    // Bypass the typed load signature to simulate malformed locale JSON.
    i.load('en', { num: 42 as any, hello: 'Hi' })
    // num resolves to a non-string, so the key is returned instead of throwing.
    expect(() => i.t('num', { a: '1' })).not.toThrow()
    expect(i.t('num')).toBe('num')
    expect(i.t('hello')).toBe('Hi')
  })

  test('merging trusted keys still works after filtering forbidden ones', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', JSON.parse('{"__proto__": {"x": 1}, "a": "A"}'))
    i.load('en', JSON.parse('{"constructor": "z", "b": "B"}'))
    expect(i.t('a')).toBe('A')
    expect(i.t('b')).toBe('B')
  })
})
