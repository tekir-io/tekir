/**
 * HTTP response cache middleware.
 *
 * Caches the full Response (status + headers + body) under a key derived
 * from the request. On hit: short-circuits the handler chain and returns
 * the cached payload, also producing `304 Not Modified` when the client
 * sends a matching `If-None-Match`.
 *
 * Storage is delegated to any `CacheStore` (memory, redis, database).
 * Only safe methods (GET, HEAD) are cached by default.
 *
 * @example
 * ```ts
 * import { Cache, cache, MemoryCacheStore } from '@tekir/cache'
 *
 * const store = new Cache({ stores: { memory: new MemoryCacheStore() } })
 *
 * router.get(
 *   '/api/posts',
 *   cache({ store, ttl: 60 }),
 *   async () => Post.all(),
 * )
 * ```
 */
import { Cache } from "./cache"
import type { CacheStore } from "./types"

export type HttpCacheOptions = {
  /**
   * Cache backend. Either a `Cache` manager (uses default store) or a raw
   * `CacheStore`. If omitted you must register `@tekir/cache` in the app
   * and the middleware will resolve `service('cache')` at request time.
   */
  store?: Cache | CacheStore
  /** Time-to-live in seconds. Default: 60. */
  ttl?: number
  /**
   * HTTP methods that are cacheable. Default: ['GET', 'HEAD'].
   * Mutating methods (POST/PUT/PATCH/DELETE) skip the cache.
   */
  methods?: string[]
  /**
   * Custom key builder. Defaults to `${method} ${url}`. Pass a function
   * to include user identity, query params, etc.
   */
  key?: (ctx: HttpCacheCtx) => string
  /**
   * Optional list of request headers to include in the cache key,
   * mirroring the HTTP `Vary` header. Default: [].
   */
  vary?: string[]
  /**
   * Skip predicate. Return `true` to bypass caching for this request.
   */
  skip?: (ctx: HttpCacheCtx) => boolean | Promise<boolean>
  /** Override the namespace prefix used in cache keys. Default: 'http:'. */
  prefix?: string
  /**
   * If true, sets `Cache-Control: public, max-age=<ttl>` on cached
   * responses. Default: true.
   */
  setCacheControl?: boolean
  /**
   * How to handle requests that carry credentials (`Authorization` or `Cookie`).
   *
   * Caching a per-user response under a shared key leaks one user's response to
   * another. To prevent that, the default behaviour is `'bypass'`: authenticated
   * requests skip the cache entirely unless you opt in.
   *
   * - `'bypass'` (default): never read or write the cache for credentialed
   *   requests.
   * - `'vary'`: include the credential headers in the cache key so each
   *   identity gets its own entry. Use this only when you understand the cache
   *   size implications.
   * - `'allow'`: cache credentialed requests under the same key as anonymous
   *   ones. DANGEROUS: only safe when the response is identical for every user.
   *
   * Note: providing a custom `key` builder that already incorporates identity
   * overrides this and is always honoured.
   */
  authenticated?: "bypass" | "vary" | "allow"
}

/** Request headers that indicate a credentialed/per-user request. */
const CREDENTIAL_HEADERS = ["authorization", "cookie"]

export type HttpCacheCtx = {
  request: { url: string; method: string; headers: Headers; raw?: Request }
  params?: Record<string, string>
  query?: Record<string, string | string[]>
}

type CachedEntry = {
  status: number
  headers: Record<string, string>
  body: string
  etag: string
  storedAt: number
}

const SAFE_METHODS = ["GET", "HEAD"]

const isStore = (s: unknown): s is CacheStore =>
  !!s &&
  typeof (s as CacheStore).get === "function" &&
  typeof (s as CacheStore).set === "function"

/**
 * Module-level default store. CacheProvider sets this at register time so
 * `cache({ ttl: 60 })` works without an explicit `store` option once the
 * provider is wired into the app. Stays null if the provider isn't used,
 * in which case the middleware no-ops (passes through).
 */
let _defaultStore: Cache | CacheStore | null = null

/**
 * Register the default backing store for the `cache()` middleware. Called
 * by `CacheProvider` after it builds the Cache manager from config.
 *
 * Users can also call this directly if they don't use providers:
 *
 * ```ts
 * import { setDefaultCacheStore, Cache, MemoryCacheStore } from '@tekir/cache'
 * setDefaultCacheStore(new Cache({ stores: { memory: new MemoryCacheStore() } }))
 * ```
 */
export function setDefaultCacheStore(s: Cache | CacheStore | null): void {
  _defaultStore = s
}

/**
 * Returns the currently registered default store, or null if none.
 */
export function getDefaultCacheStore(): Cache | CacheStore | null {
  return _defaultStore
}

const hash = (s: string): string => {
  // FNV-1a 32-bit. Good enough for ETags; not crypto.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

const defaultKey = (ctx: HttpCacheCtx, vary: string[]): string => {
  const parts = [ctx.request.method, ctx.request.url]
  for (const h of vary) {
    const v = ctx.request.headers.get(h)
    if (v) parts.push(`${h}=${v}`)
  }
  return parts.join("|")
}

const resolveStore = (
  s: HttpCacheOptions["store"] | null | undefined,
): CacheStore | null => {
  if (!s) return null
  if (s instanceof Cache) return s.store()
  if (isStore(s)) return s
  return null
}

const responseToEntry = async (resp: Response): Promise<CachedEntry> => {
  const body = await resp.clone().text()
  const headers: Record<string, string> = {}
  resp.headers.forEach((v, k) => {
    // Skip hop-by-hop and connection-specific headers
    if (k === "connection" || k === "keep-alive" || k === "transfer-encoding") return
    headers[k] = v
  })
  const etag = `W/"${hash(body)}"`
  return { status: resp.status, headers, body, etag, storedAt: Date.now() }
}

const entryToResponse = (e: CachedEntry, opts: HttpCacheOptions): Response => {
  const headers: Record<string, string> = { ...e.headers, etag: e.etag }
  if (opts.setCacheControl !== false && !headers["cache-control"]) {
    headers["cache-control"] = `public, max-age=${opts.ttl ?? 60}`
  }
  headers["x-tekir-cache"] = "HIT"
  return new Response(e.body, { status: e.status, headers })
}

/** True if the request carries an Authorization or Cookie header. */
const hasCredentials = (req: HttpCacheCtx["request"]): boolean => {
  for (const h of CREDENTIAL_HEADERS) {
    if (req.headers?.get?.(h)) return true
  }
  return false
}

export function cache(opts: HttpCacheOptions = {}) {
  const ttl = opts.ttl ?? 60
  const methods = new Set((opts.methods ?? SAFE_METHODS).map((m) => m.toUpperCase()))
  const vary = opts.vary ?? []
  const prefix = opts.prefix ?? "http:"
  const hasCustomKey = typeof opts.key === "function"
  const authMode = opts.authenticated ?? "bypass"
  // When varying by credentials, fold the credential headers into the key so
  // each identity gets a private entry.
  const effectiveVary =
    authMode === "vary" ? [...vary, ...CREDENTIAL_HEADERS] : vary
  const buildKey = opts.key ?? ((ctx: HttpCacheCtx) => defaultKey(ctx, effectiveVary))
  const directStore = resolveStore(opts.store)

  return async function cacheMiddleware(ctx: any, next: () => Promise<void>) {
    const req = ctx.request
    if (!req || !methods.has(String(req.method ?? "GET").toUpperCase())) {
      await next()
      return
    }

    if (opts.skip && (await opts.skip(ctx))) {
      await next()
      return
    }

    const cacheControl = req.headers?.get?.("cache-control") ?? ""
    if (cacheControl.includes("no-store")) {
      await next()
      return
    }

    // Secure-by-default: a credentialed (Authorization/Cookie) request usually
    // produces a per-user response. Caching it under a shared key would leak it
    // to other users. Unless the caller opted into 'vary'/'allow' or supplied a
    // custom identity-aware key, bypass the cache for such requests.
    if (authMode === "bypass" && !hasCustomKey && hasCredentials(req)) {
      await next()
      return
    }

    // Resolve store: option > module-level default (set by CacheProvider).
    // No store anywhere → middleware acts as a transparent no-op so the
    // route still works without a registered cache backend.
    let store: CacheStore | null = directStore
    if (!store) store = resolveStore(_defaultStore)
    if (!store) {
      await next()
      return
    }

    const key = prefix + buildKey(ctx)
    const cached = await store.get<CachedEntry>(key)

    // Conditional request: client sent If-None-Match
    const ifNoneMatch = req.headers?.get?.("if-none-match") ?? ""
    if (cached) {
      if (ifNoneMatch && ifNoneMatch === cached.etag) {
        ctx.$result = new Response(null, {
          status: 304,
          headers: { etag: cached.etag, "x-tekir-cache": "REVALIDATED" },
        })
        return
      }
      ctx.$result = entryToResponse(cached, opts)
      return
    }

    // Miss: run the handler chain, capture, store.
    await next()
    const result = ctx.$result
    if (!(result instanceof Response)) return
    if (result.status >= 500 || result.status === 204) return // don't cache errors / empty
    if (cacheControl.includes("no-cache")) return
    const respCacheControl = result.headers.get("cache-control") ?? ""
    if (respCacheControl.includes("private") || respCacheControl.includes("no-store")) return

    const entry = await responseToEntry(result)
    await store.set(key, entry, ttl)

    // Re-emit with x-tekir-cache: MISS so the client can see it
    const out: Record<string, string> = {}
    result.headers.forEach((v, k) => (out[k] = v))
    out["etag"] = entry.etag
    if (opts.setCacheControl !== false && !out["cache-control"]) {
      out["cache-control"] = `public, max-age=${ttl}`
    }
    out["x-tekir-cache"] = "MISS"
    ctx.$result = new Response(entry.body, { status: result.status, headers: out })
  }
}
