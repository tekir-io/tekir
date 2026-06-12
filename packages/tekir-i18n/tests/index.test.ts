import { test, expect, describe } from 'bun:test'
import { I18n, createI18n } from '../src/index'

// All tests use the programmatic load() API so no filesystem access is needed.

describe('I18n', () => {
  describe('constructor', () => {
    test('creates instance with default locale "en"', () => {
      const i18n = new I18n()
      expect(i18n.locale).toBe('en')
    })

    test('accepts custom defaultLocale', () => {
      const i18n = new I18n({ defaultLocale: 'tr' })
      expect(i18n.locale).toBe('tr')
    })

    test('createI18n factory returns an I18n instance', () => {
      const i18n = createI18n()
      expect(i18n).toBeInstanceOf(I18n)
    })

    test('createI18n accepts config', () => {
      const i18n = createI18n({ defaultLocale: 'fr' })
      expect(i18n.locale).toBe('fr')
    })
  })

  describe('load() + t()', () => {
    test('translates a key after loading', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'hello': 'Hello!' })
      expect(i18n.t('hello')).toBe('Hello!')
    })

    test('returns the key itself when no translation found', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      expect(i18n.t('missing.key')).toBe('missing.key')
    })

    test('interpolates params in translation', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'greeting': 'Hello, {{ name }}!' })
      expect(i18n.t('greeting', { name: 'Ali' })).toBe('Hello, Ali!')
    })

    test('interpolates numeric params', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'score': 'Your score is {{ score }}' })
      expect(i18n.t('score', { score: 99 })).toBe('Your score is 99')
    })

    test('replaces multiple params in single string', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'msg': '{{ a }} and {{ b }}' })
      expect(i18n.t('msg', { a: 'foo', b: 'bar' })).toBe('foo and bar')
    })

    test('replaces param with spaces around key ({{ name }} and {{name}})', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'msg': 'Hello {{name}}!' })
      expect(i18n.t('msg', { name: 'World' })).toBe('Hello World!')
    })

    test('translates with explicit locale override', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'hi': 'Hello' })
      i18n.load('tr', { 'hi': 'Merhaba' })
      expect(i18n.t('hi', undefined, 'tr')).toBe('Merhaba')
      expect(i18n.t('hi', undefined, 'en')).toBe('Hello')
    })

    test('falls back to fallbackLocale when key missing in requested locale', () => {
      const i18n = new I18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
      i18n.load('en', { 'only_in_en': 'English value' })
      // 'tr' does not have this key → falls back to 'en'
      expect(i18n.t('only_in_en')).toBe('English value')
    })

    test('load() merges into existing locale translations', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { a: 'A' })
      i18n.load('en', { b: 'B' })
      expect(i18n.t('a')).toBe('A')
      expect(i18n.t('b')).toBe('B')
    })

    test('later load() overwrites existing key', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { key: 'original' })
      i18n.load('en', { key: 'updated' })
      expect(i18n.t('key')).toBe('updated')
    })
  })

  describe('plural()', () => {
    test('uses _zero suffix when count is 0', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', {
        'items_zero': 'No items',
        'items_one': 'One item',
        'items_other': '{{ count }} items',
      })
      expect(i18n.plural('items', 0)).toBe('No items')
    })

    test('uses _one suffix when count is 1', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', {
        'items_zero': 'No items',
        'items_one': 'One item',
        'items_other': '{{ count }} items',
      })
      expect(i18n.plural('items', 1)).toBe('One item')
    })

    test('uses _other suffix for counts > 1', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', {
        'items_zero': 'No items',
        'items_one': 'One item',
        'items_other': '{{ count }} items',
      })
      expect(i18n.plural('items', 5)).toBe('5 items')
    })

    test('injects count param automatically', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { 'things_other': 'There are {{ count }} things' })
      expect(i18n.plural('things', 3)).toBe('There are 3 things')
    })

    test('falls back to key when plural key not found', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      expect(i18n.plural('missing', 2)).toBe('missing_other')
    })
  })

  describe('setLocale() + locale getter', () => {
    test('setLocale changes the active locale', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.setLocale('fr')
      expect(i18n.locale).toBe('fr')
    })

    test('t() uses the new locale after setLocale', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { hello: 'Hello' })
      i18n.load('fr', { hello: 'Bonjour' })
      i18n.setLocale('fr')
      expect(i18n.t('hello')).toBe('Bonjour')
    })
  })

  describe('getLocale()', () => {
    test('returns translations for a known locale', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      i18n.load('en', { a: 'A', b: 'B' })
      const translations = i18n.getLocale('en')
      expect(translations).toEqual({ a: 'A', b: 'B' })
    })

    test('returns empty object for unknown locale', () => {
      const i18n = new I18n({ defaultLocale: 'en' })
      expect(i18n.getLocale('jp')).toEqual({})
    })
  })

  describe('availableLocales getter', () => {
    test('returns empty array when no locales loaded', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      expect(i18n.availableLocales).toEqual([])
    })

    test('returns all loaded locales', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hi: 'Hi' })
      i18n.load('tr', { hi: 'Merhaba' })
      i18n.load('fr', { hi: 'Salut' })
      const locales = i18n.availableLocales
      expect(locales).toContain('en')
      expect(locales).toContain('tr')
      expect(locales).toContain('fr')
      expect(locales).toHaveLength(3)
    })
  })

  describe('middleware()', () => {
    test('attaches locale and t() to ctx when header matches a loaded locale', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hello: 'Hello' })
      i18n.load('tr', { hello: 'Merhaba' })

      const middleware = i18n.middleware()
      const ctx: any = { headers: { 'accept-language': 'tr,en;q=0.8' } }
      await middleware(ctx, async () => {})

      expect(ctx.locale).toBe('tr')
      expect(typeof ctx.t).toBe('function')
      expect(ctx.t('hello')).toBe('Merhaba')
      expect(ctx.i18n).toBe(i18n)
    })

    test('falls back to defaultLocale when accept-language header is absent', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hello: 'Hello' })

      const middleware = i18n.middleware()
      const ctx: any = { headers: {} }
      await middleware(ctx, async () => {})

      expect(ctx.locale).toBe('en')
    })

    test('falls back to defaultLocale when preferred locale not loaded', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hello: 'Hello' })

      const middleware = i18n.middleware()
      const ctx: any = { headers: { 'accept-language': 'jp' } }
      await middleware(ctx, async () => {})

      expect(ctx.locale).toBe('en')
    })

    test('middleware calls next()', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      const middleware = i18n.middleware()
      const ctx: any = { headers: {} }
      let nextCalled = false
      await middleware(ctx, async () => { nextCalled = true })
      expect(nextCalled).toBe(true)
    })
  })
})

// Additional tests

describe('I18n - additional', () => {
  describe('multiple locales loaded simultaneously', () => {
    test('loading three locales makes all available', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hello: 'Hello' })
      i18n.load('fr', { hello: 'Bonjour' })
      i18n.load('de', { hello: 'Hallo' })
      expect(i18n.availableLocales).toContain('en')
      expect(i18n.availableLocales).toContain('fr')
      expect(i18n.availableLocales).toContain('de')
    })

    test('t() with locale override picks the correct locale', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { greeting: 'Hi' })
      i18n.load('es', { greeting: 'Hola' })
      i18n.load('ja', { greeting: 'Konnichiwa' })
      expect(i18n.t('greeting', undefined, 'es')).toBe('Hola')
      expect(i18n.t('greeting', undefined, 'ja')).toBe('Konnichiwa')
    })
  })

  describe('parameter interpolation edge cases', () => {
    test('missing param placeholder is left as-is', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { msg: 'Hello {{ name }}, your code is {{ code }}' })
      expect(i18n.t('msg', { name: 'Ali' })).toBe('Hello Ali, your code is {{ code }}')
    })

    test('extra params that are not in the template are ignored', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { msg: 'Hello {{ name }}' })
      expect(i18n.t('msg', { name: 'Ali', extra: 'unused' })).toBe('Hello Ali')
    })

    test('same param used multiple times is replaced everywhere', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { msg: '{{ x }} + {{ x }} = {{ result }}' })
      expect(i18n.t('msg', { x: '2', result: '4' })).toBe('2 + 2 = 4')
    })

    test('interpolation with numeric zero value', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { msg: 'Count: {{ n }}' })
      expect(i18n.t('msg', { n: 0 })).toBe('Count: 0')
    })
  })

  describe('plural() edge cases', () => {
    test('negative numbers use _other suffix', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', {
        'temp_zero': 'Zero degrees',
        'temp_one': 'One degree',
        'temp_other': '{{ count }} degrees',
      })
      expect(i18n.plural('temp', -5)).toBe('-5 degrees')
    })

    test('large numbers use _other suffix', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { 'items_other': '{{ count }} items' })
      expect(i18n.plural('items', 1000000)).toBe('1000000 items')
    })

    test('decimal numbers use _other suffix', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { 'weight_other': '{{ count }} kg' })
      expect(i18n.plural('weight', 2.5)).toBe('2.5 kg')
    })

    test('plural with additional params besides count', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { 'msg_other': '{{ name }} has {{ count }} items' })
      expect(i18n.plural('msg', 3, { name: 'Ali' })).toBe('Ali has 3 items')
    })
  })

  describe('setLocale() changes default for subsequent t() calls', () => {
    test('after setLocale, t() without locale param uses the new locale', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { word: 'Apple' })
      i18n.load('tr', { word: 'Elma' })
      expect(i18n.t('word')).toBe('Apple')
      i18n.setLocale('tr')
      expect(i18n.t('word')).toBe('Elma')
    })

    test('setLocale updates the locale getter', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.setLocale('de')
      expect(i18n.locale).toBe('de')
      i18n.setLocale('fr')
      expect(i18n.locale).toBe('fr')
    })
  })

  describe('getLocale() for non-existent locale', () => {
    test('returns empty object for a locale that was never loaded', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      expect(i18n.getLocale('zz')).toEqual({})
    })

    test('returns translations only for loaded keys', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { a: 'A' })
      const result = i18n.getLocale('en')
      expect(result).toEqual({ a: 'A' })
      expect(result).not.toHaveProperty('b')
    })
  })

  describe('middleware() with complex Accept-Language headers', () => {
    test('picks the first language from q-value header', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hi: 'Hello' })
      i18n.load('fr', { hi: 'Bonjour' })
      const mw = i18n.middleware()
      const ctx: any = { headers: { 'accept-language': 'fr;q=0.9,en;q=0.8' } }
      await mw(ctx, async () => {})
      expect(ctx.locale).toBe('fr')
    })

    test('falls back to default when all q-value languages are unavailable', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hi: 'Hello' })
      const mw = i18n.middleware()
      const ctx: any = { headers: { 'accept-language': 'zh;q=0.9,ko;q=0.8' } }
      await mw(ctx, async () => {})
      expect(ctx.locale).toBe('en')
    })

    test('handles empty Accept-Language header', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hi: 'Hello' })
      const mw = i18n.middleware()
      const ctx: any = { headers: { 'accept-language': '' } }
      await mw(ctx, async () => {})
      expect(ctx.locale).toBe('en')
    })

    test('handles missing Accept-Language header entirely', async () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { hi: 'Hello' })
      const mw = i18n.middleware()
      const ctx: any = { headers: {} }
      await mw(ctx, async () => {})
      expect(ctx.locale).toBe('en')
    })
  })

  describe('t() with special keys', () => {
    test('empty string key returns empty string when not found', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      expect(i18n.t('')).toBe('')
    })

    test('key with dots works as a flat key', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { 'user.name.label': 'Username' })
      expect(i18n.t('user.name.label')).toBe('Username')
    })

    test('key with special characters', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { 'key-with-dashes': 'Dashed' })
      expect(i18n.t('key-with-dashes')).toBe('Dashed')
    })
  })

  describe('load() overwriting existing keys', () => {
    test('second load overwrites a key but keeps others', () => {
      const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
      i18n.load('en', { a: 'A1', b: 'B1' })
      i18n.load('en', { a: 'A2' })
      expect(i18n.t('a')).toBe('A2')
      expect(i18n.t('b')).toBe('B1')
    })
  })

  describe('createI18n factory with config', () => {
    test('createI18n with defaultLocale and fallbackLocale', () => {
      const i18n = createI18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
      i18n.load('en', { msg: 'English fallback' })
      expect(i18n.locale).toBe('tr')
      expect(i18n.t('msg')).toBe('English fallback')
    })

    test('createI18n without config defaults to en', () => {
      const i18n = createI18n()
      expect(i18n.locale).toBe('en')
    })
  })
})

// Additional I18n tests

describe('I18n — additional translations', () => {
  test('translate with multiple params', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'welcome': 'Hello {{ name }}, you have {{ count }} messages' })
    expect(i18n.t('welcome', { name: 'Ali', count: 5 })).toBe('Hello Ali, you have 5 messages')
  })

  test('translate preserves literal text around params', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'price': 'Total: ${{ amount }} USD' })
    expect(i18n.t('price', { amount: '99.99' })).toBe('Total: $99.99 USD')
  })

  test('translate with empty params object', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'static': 'No params here' })
    expect(i18n.t('static', {})).toBe('No params here')
  })

  test('translate key returns key when locale not loaded', () => {
    const i18n = new I18n({ defaultLocale: 'fr' })
    expect(i18n.t('anything')).toBe('anything')
  })

  test('load multiple locales and use default', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'hello': 'Hello' })
    i18n.load('tr', { 'hello': 'Merhaba' })
    expect(i18n.t('hello')).toBe('Hello')
  })

  test('different default locales see different translations', () => {
    const i18nEn = new I18n({ defaultLocale: 'en' })
    i18nEn.load('en', { 'greeting': 'Hi' })
    const i18nDe = new I18n({ defaultLocale: 'de' })
    i18nDe.load('de', { 'greeting': 'Hallo' })
    expect(i18nEn.t('greeting')).toBe('Hi')
    expect(i18nDe.t('greeting')).toBe('Hallo')
  })

  test('many keys in same locale', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    const translations: Record<string, string> = {}
    for (let i = 0; i < 100; i++) translations[`key${i}`] = `Value ${i}`
    i18n.load('en', translations)
    expect(i18n.t('key0')).toBe('Value 0')
    expect(i18n.t('key99')).toBe('Value 99')
    expect(i18n.t('key50')).toBe('Value 50')
  })

  test('overwrite preserves other keys', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { a: '1', b: '2', c: '3' })
    i18n.load('en', { b: 'updated' })
    expect(i18n.t('a')).toBe('1')
    expect(i18n.t('b')).toBe('updated')
    expect(i18n.t('c')).toBe('3')
  })

  test('locale property reflects default locale', () => {
    const i18n = new I18n({ defaultLocale: 'ja' })
    expect(i18n.locale).toBe('ja')
  })

  test('translation with param not in template is ignored', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'msg': 'Hello world' })
    expect(i18n.t('msg', { unused: 'param' })).toBe('Hello world')
  })

  test('translation value with only spaces', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'spaces': '   ' })
    expect(i18n.t('spaces')).toBe('   ')
  })

  test('unicode translation values', () => {
    const i18n = new I18n({ defaultLocale: 'ja' })
    i18n.load('ja', { 'greeting': 'こんにちは、{{ name }}さん' })
    expect(i18n.t('greeting', { name: '太郎' })).toBe('こんにちは、太郎さん')
  })
})

describe('I18n — fallback locale', () => {
  test('falls back to fallbackLocale when key missing in current locale', () => {
    const i18n = createI18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
    i18n.load('en', { 'app.title': 'My App' })
    i18n.load('tr', {})
    expect(i18n.t('app.title')).toBe('My App')
  })

  test('current locale takes priority over fallback', () => {
    const i18n = createI18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
    i18n.load('en', { 'msg': 'English' })
    i18n.load('tr', { 'msg': 'Turkish' })
    expect(i18n.t('msg')).toBe('Turkish')
  })

  test('returns key when both locale and fallback miss', () => {
    const i18n = createI18n({ defaultLocale: 'tr', fallbackLocale: 'en' })
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key')
  })
})

// Additional edge-case tests

describe('I18n — locale switching round-trips', () => {
  test('switching locale back and forth returns correct translations', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { msg: 'English' })
    i18n.load('fr', { msg: 'Francais' })
    i18n.load('de', { msg: 'Deutsch' })
    expect(i18n.t('msg')).toBe('English')
    i18n.setLocale('fr')
    expect(i18n.t('msg')).toBe('Francais')
    i18n.setLocale('de')
    expect(i18n.t('msg')).toBe('Deutsch')
    i18n.setLocale('en')
    expect(i18n.t('msg')).toBe('English')
  })

  test('setLocale to unloaded locale causes t() to return fallback', () => {
    const i18n = new I18n({ defaultLocale: 'en', fallbackLocale: 'en' })
    i18n.load('en', { hello: 'Hello' })
    i18n.setLocale('zz')
    expect(i18n.t('hello')).toBe('Hello')
  })

  test('setLocale to unloaded locale without fallback returns key', () => {
    const i18n = new I18n({ defaultLocale: 'xx' })
    expect(i18n.t('anything')).toBe('anything')
  })
})

describe('I18n — nested dot-key translations', () => {
  test('dot-separated keys are stored and retrieved as flat keys', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', {
      'nav.home': 'Home',
      'nav.about': 'About',
      'nav.contact': 'Contact',
    })
    expect(i18n.t('nav.home')).toBe('Home')
    expect(i18n.t('nav.about')).toBe('About')
    expect(i18n.t('nav.contact')).toBe('Contact')
  })

  test('deeply nested dot keys work correctly', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'a.b.c.d.e': 'deep value' })
    expect(i18n.t('a.b.c.d.e')).toBe('deep value')
  })
})

describe('I18n — missing key behavior', () => {
  test('missing key with params still returns the raw key', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    expect(i18n.t('no.such.key', { name: 'test' })).toBe('no.such.key')
  })

  test('missing key in current locale falls back even with params', () => {
    const i18n = new I18n({ defaultLocale: 'fr', fallbackLocale: 'en' })
    i18n.load('en', { greeting: 'Hello {{ name }}' })
    expect(i18n.t('greeting', { name: 'World' })).toBe('Hello World')
  })

  test('key present in fallback but not current locale uses fallback with interpolation', () => {
    const i18n = new I18n({ defaultLocale: 'de', fallbackLocale: 'en' })
    i18n.load('en', { 'errors.required': '{{ field }} is required' })
    i18n.load('de', {})
    expect(i18n.t('errors.required', { field: 'Email' })).toBe('Email is required')
  })
})

describe('I18n — pluralization edge cases', () => {
  test('plural with count 0 and no _zero key falls back to _other', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'files_other': '{{ count }} files' })
    // No files_zero defined, so files_zero key is missing; falls back to key itself
    expect(i18n.plural('files', 0)).toBe('files_zero')
  })

  test('plural with count 1 and no _one key falls back to key itself', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'files_other': '{{ count }} files' })
    expect(i18n.plural('files', 1)).toBe('files_one')
  })

  test('plural with explicit locale override', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('en', { 'items_other': '{{ count }} items' })
    i18n.load('tr', { 'items_other': '{{ count }} oge' })
    expect(i18n.plural('items', 5, undefined, 'tr')).toBe('5 oge')
  })

  test('plural with additional params and locale override', () => {
    const i18n = new I18n({ defaultLocale: 'en' })
    i18n.load('fr', { 'cart_other': '{{ name }} a {{ count }} articles' })
    expect(i18n.plural('cart', 3, { name: 'Pierre' }, 'fr')).toBe('Pierre a 3 articles')
  })
})

describe('I18n — availableLocales after various operations', () => {
  test('availableLocales grows as locales are loaded', () => {
    const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
    expect(i18n.availableLocales).toHaveLength(0)
    i18n.load('en', { a: 'A' })
    expect(i18n.availableLocales).toHaveLength(1)
    i18n.load('fr', { a: 'A' })
    expect(i18n.availableLocales).toHaveLength(2)
  })

  test('loading same locale twice does not duplicate in availableLocales', () => {
    const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
    i18n.load('en', { a: 'A' })
    i18n.load('en', { b: 'B' })
    expect(i18n.availableLocales).toHaveLength(1)
  })
})

describe('I18n — middleware with locale-specific t()', () => {
  test('ctx.t uses the detected locale for interpolation', async () => {
    const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
    i18n.load('en', { msg: 'Hello {{ name }}' })
    i18n.load('es', { msg: 'Hola {{ name }}' })
    const mw = i18n.middleware()
    const ctx: any = { headers: { 'accept-language': 'es' } }
    await mw(ctx, async () => {})
    expect(ctx.t('msg', { name: 'Carlos' })).toBe('Hola Carlos')
  })

  test('middleware sets ctx.i18n to the i18n instance', async () => {
    const i18n = new I18n({ defaultLocale: 'en', localesDir: '/nonexistent/path' })
    i18n.load('en', { hi: 'Hi' })
    const mw = i18n.middleware()
    const ctx: any = { headers: {} }
    await mw(ctx, async () => {})
    expect(ctx.i18n).toBe(i18n)
    expect(ctx.i18n.locale).toBe('en')
  })
})
