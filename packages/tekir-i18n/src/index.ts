export type { I18nConfig } from './i18n'
export { I18n, createI18n } from './i18n'
export { I18nProvider } from './provider'

import type { I18n } from './i18n'

// Module augmentation — adds t(), locale, i18n to HttpContext
declare module '@tekir/core' {
  interface HttpContext {
    /** Resolved locale string (e.g. 'tr') — set by i18n middleware */
    locale: string
    /** Translate helper pre-bound to the request locale */
    t: (key: string, params?: Record<string, string | number>) => string
    /** Full I18n instance */
    i18n: I18n
  }
}
