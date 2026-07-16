import { join, resolve, basename } from 'path'
import { readdir, readFile, access } from 'node:fs/promises'
import type { I18nConfig } from './types'

export type { I18nConfig } from './types'

type Translations = Record<string, Record<string, string>>

// Keys that, if copied onto a plain object, can poison Object.prototype or
// be misread as inherited members during lookup. Locale JSON is usually
// trusted (developer-authored) but may come from a CMS or untrusted
// translation pipeline, so we strip these defensively on every merge.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// Copy `translations` onto `target`, skipping prototype-polluting keys.
// JSON.parse emits `__proto__` as an own enumerable property; assigning it
// with a normal `[]=` set would invoke the prototype setter, so we guard
// every key explicitly.
function safeMerge(
  target: Record<string, string>,
  translations: Record<string, string>,
): Record<string, string> {
  for (const key of Object.keys(translations)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    target[key] = translations[key]
  }
  return target
}

/** Internationalization service that loads locale JSON files and supports interpolation, pluralization, and locale detection middleware. */
export class I18n {
  private locales: Translations = {}
  private defaultLocale: string
  private fallbackLocale: string

  get locale(): string { return this.defaultLocale }
  set locale(value: string) { this.defaultLocale = value }
  private _ready: Promise<void>

  /**
   * Create a new I18n instance. Locale JSON files are loaded asynchronously from `localesDir`.
   *
   * @param config - Optional {@link I18nConfig} specifying default locale, fallback locale, and locales directory.
   *
   * @example
   * ```ts
   * const i18n = new I18n({ defaultLocale: 'en', fallbackLocale: 'en', localesDir: './lang' })
   * await i18n.ready()
   * ```
   */
  constructor(config: I18nConfig = {}) {
    this.defaultLocale = config.defaultLocale || 'en'
    this.fallbackLocale = config.fallbackLocale || this.defaultLocale

    const dir = config.localesDir || join(process.cwd(), 'resources', 'lang')
    this._ready = this._loadDir(dir).catch(() => {})
  }

  /**
   * Wait for locale files to be loaded from disk. Call this before using translations
   * if you need to ensure all files are available.
   *
   * @returns Resolves when all locale JSON files have been loaded.
   *
   * @example
   * ```ts
   * await i18n.ready()
   * console.log(i18n.t('welcome'))
   * ```
   */
  async ready(): Promise<void> { await this._ready }

  private async _loadDir(dir: string) {
    try { await access(dir) } catch { return }
    const files = (await readdir(dir)).filter(f => f.endsWith('.json'))
    for (const file of files) {
      // `readdir` only yields entries directly inside `dir`, but a hostile
      // filename (symlink, or a name containing separators on exotic
      // filesystems) could still steer `join` outside `dir`. Skip anything
      // whose resolved path is not contained under `dir`.
      const full = resolve(dir, file)
      if (full !== resolve(dir, basename(file))) continue
      const locale = file.replace(/\.json$/, '')
      if (FORBIDDEN_KEYS.has(locale)) continue
      try {
        const parsed = JSON.parse(await readFile(full, 'utf-8'))
        this.locales[locale] = safeMerge(Object.create(null), parsed)
      } catch {}
    }
  }

  /**
   * Load translations for a locale programmatically, merging with any existing translations.
   *
   * @param locale - The locale code (e.g. `'en'`, `'tr'`).
   * @param translations - A record of translation key-value pairs to merge.
   *
   * @example
   * ```ts
   * i18n.load('en', { 'greeting': 'Hello, {{ name }}!' })
   * ```
   */
  load(locale: string, translations: Record<string, string>): void {
    if (FORBIDDEN_KEYS.has(locale)) return
    const base = this.locales[locale] ?? Object.create(null)
    this.locales[locale] = safeMerge(base, translations)
  }

  // Resolve a single translation as an own-property string lookup. Returns
  // undefined when the locale is unknown, the key is absent, the key is a
  // forbidden prototype key, or the stored value is not a string.
  private lookup(locale: string, key: string): string | undefined {
    if (FORBIDDEN_KEYS.has(key)) return undefined
    const map = this.locales[locale]
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined
    const value = map[key]
    return typeof value === 'string' ? value : undefined
  }

  /**
   * Translate a key with optional interpolation parameters.
   * Falls back to the fallback locale, then returns the key itself if no translation is found.
   *
   * @param key - The translation key (e.g. `'messages.welcome'`).
   * @param params - Optional interpolation parameters. Replaces `{{ key }}` placeholders in the translation string.
   * @param locale - Optional locale override. Defaults to the current default locale.
   * @returns The translated (and interpolated) string, or the key if no translation exists.
   *
   * @remarks
   * The returned string is not HTML-escaped. Interpolated parameter values
   * are inserted verbatim, so the caller (or the view layer) must escape the
   * output before rendering it into HTML to avoid XSS.
   *
   * @example
   * ```ts
   * i18n.t('messages.welcome', { name: 'Ali' }, 'tr')
   * // => 'Merhaba, Ali!'
   * ```
   */
  t(key: string, params?: Record<string, string | number>, locale?: string): string {
    const lang = locale || this.defaultLocale
    // Own-property lookup only: a `key` of `__proto__`/`toString`/`constructor`
    // must never resolve to an inherited Object.prototype member. `lookup`
    // returns a string or undefined, so `value` is always a safe string.
    let value = this.lookup(lang, key)
      ?? this.lookup(this.fallbackLocale, key)
      ?? key

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        value = value.replace(new RegExp(`{{\\s*${escaped}\\s*}}`, 'g'), String(v))
      }
    }

    return value
  }

  /**
   * Translate a key with pluralization support.
   * Appends `_zero`, `_one`, or `_other` to the key based on `count`, then delegates to {@link t}.
   * A `{{ count }}` parameter is automatically injected.
   *
   * @param key - The base translation key (e.g. `'items'`). The actual keys should be `items_zero`, `items_one`, `items_other`.
   * @param count - The count used to determine the plural form.
   * @param params - Optional additional interpolation parameters.
   * @param locale - Optional locale override.
   * @returns The translated and pluralized string.
   *
   * @example
   * ```ts
   * i18n.plural('items', 0)  // => 'No items'
   * i18n.plural('items', 1)  // => '1 item'
   * i18n.plural('items', 5)  // => '5 items'
   * ```
   */
  plural(key: string, count: number, params?: Record<string, string | number>, locale?: string): string {
    let suffix = '_other'
    if (count === 0) suffix = '_zero'
    else if (count === 1) suffix = '_one'

    const fullKey = key + suffix
    return this.t(fullKey, { ...params, count }, locale)
  }

  /**
   * Get all translations for a given locale.
   *
   * @param locale - The locale code to retrieve translations for.
   * @returns A record of translation key-value pairs, or an empty object if the locale is not loaded.
   */
  getLocale(locale: string): Record<string, string> {
    return this.locales[locale] || {}
  }

  // List available locales
  get availableLocales(): string[] {
    return Object.keys(this.locales)
  }

  /**
   * Set the default locale for subsequent translation lookups.
   *
   * @param locale - The locale code to set as the default (e.g. `'en'`, `'tr'`).
   */
  setLocale(locale: string): void {
    this.defaultLocale = locale
  }

  /**
   * Create a middleware that detects the locale from the `Accept-Language` header
   * and injects `ctx.locale`, `ctx.t`, and `ctx.i18n` onto the request context.
   *
   * @returns A middleware function compatible with the framework's middleware signature.
   *
   * @example
   * ```ts
   * app.use(i18n.middleware())
   * ```
   */
  middleware() {
    return async (ctx: any, next: () => Promise<void>) => {
      const accept = ctx.request?.header?.('accept-language') || ctx.headers?.['accept-language'] || ''
      const preferred = this.resolveAcceptedLocale(String(accept))

      if (preferred && this.locales[preferred]) {
        ctx.locale = preferred
        ctx.t = (key: string, params?: Record<string, string | number>) => this.t(key, params, preferred)
      } else {
        ctx.locale = this.defaultLocale
        ctx.t = (key: string, params?: Record<string, string | number>) => this.t(key, params)
      }

      ctx.i18n = this
      await next()
    }
  }

  /** Select the highest-quality supported locale from an Accept-Language value. */
  private resolveAcceptedLocale(header: string): string | undefined {
    const available = new Map(
      Object.keys(this.locales).map((locale) => [locale.toLowerCase(), locale])
    )

    const candidates = header.split(',').map((part, index) => {
      const [rawTag, ...parameters] = part.trim().split(';')
      let quality = 1
      for (const parameter of parameters) {
        const match = parameter.trim().match(/^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/i)
        if (match) quality = Number(match[1])
      }
      return { tag: rawTag.trim().toLowerCase(), quality, index }
    }).filter(({ tag, quality }) => tag.length > 0 && quality > 0)

    candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
    for (const { tag } of candidates) {
      if (tag === '*') return this.locales[this.defaultLocale] ? this.defaultLocale : undefined
      const exact = available.get(tag)
      if (exact) return exact
      const base = available.get(tag.split('-')[0])
      if (base) return base
    }
    return undefined
  }
}

/**
 * Create a new I18n instance with the given configuration.
 *
 * @param config - Optional {@link I18nConfig} specifying default locale, fallback locale, and locales directory.
 * @returns A new {@link I18n} instance.
 *
 * @example
 * ```ts
 * const i18n = createI18n({ defaultLocale: 'en' })
 * await i18n.ready()
 * ```
 */
export function createI18n(config?: I18nConfig): I18n {
  return new I18n(config)
}
