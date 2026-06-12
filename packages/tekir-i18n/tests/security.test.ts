import { test, expect, describe } from 'bun:test'
import { I18n } from '../src/i18n'

describe('I18n — ReDoS prevention in param keys', () => {
  const i18n = new I18n({ defaultLocale: 'en', fallbackLocale: 'en' })
  i18n.load('en', {
    hello: 'Hello {{ name }}!',
    greeting: 'Welcome {{ first }} {{ last }}',
    count: 'You have {{ count }} items',
    dotted: 'Value: {{ user.name }}',
    bracketed: 'Item: {{ data[0] }}',
    piped: 'Choice: {{ a|b }}',
    multi: '{{ a }} and {{ b }} and {{ c }}',
  })

  test('normal param replacement works', () => {
    expect(i18n.t('hello', { name: 'Ali' })).toBe('Hello Ali!')
  })

  test('multiple params work', () => {
    expect(i18n.t('greeting', { first: 'Ali', last: 'Veli' })).toBe('Welcome Ali Veli')
  })

  test('numeric params work', () => {
    expect(i18n.t('count', { count: 42 })).toBe('You have 42 items')
  })

  test('three params work', () => {
    expect(i18n.t('multi', { a: '1', b: '2', c: '3' })).toBe('1 and 2 and 3')
  })

  test('regex metacharacters in key do not cause ReDoS', () => {
    const start = Date.now()
    i18n.t('hello', { '(a+)+b': 'test' })
    i18n.t('hello', { '.*+?^${}()|[]\\': 'test' })
    i18n.t('hello', { '((((a+)+)+)+)': 'test' })
    i18n.t('hello', { '[a-z]+': 'test' })
    i18n.t('hello', { '(?:a|b)+': 'test' })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  test('param key with dots is escaped properly', () => {
    expect(i18n.t('dotted', { 'user.name': 'Ali' })).toBe('Value: Ali')
  })

  test('param key with brackets is escaped', () => {
    expect(i18n.t('bracketed', { 'data[0]': 'first' })).toBe('Item: first')
  })

  test('param key with pipe is escaped', () => {
    expect(i18n.t('piped', { 'a|b': 'either' })).toBe('Choice: either')
  })

  test('missing key falls back to key string', () => {
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key')
  })

  test('missing param stays as template', () => {
    expect(i18n.t('hello', {})).toBe('Hello {{ name }}!')
  })

  test('param value with HTML passes through', () => {
    const result = i18n.t('hello', { name: '<script>alert(1)</script>' })
    expect(result).toContain('<script>')
  })

  test('empty string param value', () => {
    expect(i18n.t('hello', { name: '' })).toBe('Hello !')
  })

  test('zero as param value', () => {
    expect(i18n.t('count', { count: 0 })).toBe('You have 0 items')
  })

  test('whitespace around param key in template', () => {
    // Template has {{ name }} with spaces — should still match 'name'
    expect(i18n.t('hello', { name: 'Test' })).toBe('Hello Test!')
  })

  test('long ReDoS attack string in key is handled fast', () => {
    const evilKey = '(' + 'a+'.repeat(20) + ')'
    const start = Date.now()
    i18n.t('hello', { [evilKey]: 'x' })
    expect(Date.now() - start).toBeLessThan(50)
  })

  test('param key with backslash is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Path: {{ path\\to }}' })
    expect(i.t('msg', { 'path\\to': '/usr/bin' })).toBe('Path: /usr/bin')
  })

  test('param key with caret is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ ^start }}' })
    expect(i.t('msg', { '^start': 'begin' })).toBe('Val: begin')
  })

  test('param key with plus is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ a+b }}' })
    expect(i.t('msg', { 'a+b': 'sum' })).toBe('Val: sum')
  })

  test('param key with star is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ a*b }}' })
    expect(i.t('msg', { 'a*b': 'prod' })).toBe('Val: prod')
  })

  test('param key with question mark is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ a? }}' })
    expect(i.t('msg', { 'a?': 'maybe' })).toBe('Val: maybe')
  })

  test('param key with curly braces is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ a{2} }}' })
    expect(i.t('msg', { 'a{2}': 'twice' })).toBe('Val: twice')
  })

  test('param key with dollar is escaped', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'Val: {{ $price }}' })
    expect(i.t('msg', { '$price': '9.99' })).toBe('Val: 9.99')
  })

  test('fallback locale works', () => {
    const i = new I18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
    i.load('en', { hello: 'Hello {{ name }}!' })
    expect(i.t('hello', { name: 'Ali' })).toBe('Hello Ali!')
  })

  test('locale setter works', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'EN' })
    i.load('tr', { msg: 'TR' })
    expect(i.t('msg')).toBe('EN')
    i.locale = 'tr'
    expect(i.t('msg')).toBe('TR')
  })

  test('explicit locale param overrides default', () => {
    const i = new I18n({ defaultLocale: 'en' })
    i.load('en', { msg: 'EN' })
    i.load('tr', { msg: 'TR' })
    expect(i.t('msg', undefined, 'tr')).toBe('TR')
  })
})
