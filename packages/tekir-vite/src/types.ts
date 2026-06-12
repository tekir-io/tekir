import type { InlineConfig } from 'vite'

export interface ViteConfig extends Pick<InlineConfig,
  | 'plugins'
  | 'css'
  | 'resolve'
  | 'define'
  | 'build'
  | 'ssr'
  | 'optimizeDeps'
  | 'json'
  | 'assetsInclude'
> {
  root?: string
  buildDir?: string
  dev?: boolean
  /**
   * In dev mode, the URL prefix patterns Vite should proxy to the
   * Tekir backend. Defaults to `['/api']`. Anything else is served
   * by Vite (frontend assets plus SPA fallback). Set to `[]` if your
   * app routes everything through Vite and uses a different protocol
   * (e.g. SSE on a non-`/api` path) for the backend.
   */
  proxyPaths?: string[]
}
