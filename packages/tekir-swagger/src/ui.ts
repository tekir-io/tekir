import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RouterLike, SwaggerConfig, SwaggerBasicAuth } from './types'
import { buildOpenApiSpec } from './spec_builder'

// Pinned Swagger UI release. Bump deliberately and refresh the SRI
// hashes consumers may have configured. jsDelivr serves these paths
// unchanged once a version tag is published.
const SWAGGER_UI_VERSION = '5.17.14'
const DEFAULT_CSS_URL = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css`
const DEFAULT_JS_URL = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js`

/**
 * Build a middleware that gates the swagger UI + JSON spec behind HTTP
 * Basic auth. Credentials are compared as fixed-length HMAC-SHA256
 * digests so neither the length of the password nor the position of the
 * first mismatched byte leaks through response timing.
 */
function buildBasicAuthMiddleware(auth: SwaggerBasicAuth) {
  // Per-process random key. The HMAC over user-supplied bytes produces a
  // 32-byte fixed-length digest, so we can timing-safely compare regardless
  // of the inbound header's length.
  const compareKey = randomBytes(32)
  const expectedDigest = createHmac('sha256', compareKey)
    .update('Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64'))
    .digest()
  const realm = auth.realm ?? 'docs'
  const challenge = `Basic realm="${realm.replace(/"/g, '\\"')}", charset="UTF-8"`

  return async (ctx: any, next: () => Promise<void>) => {
    const header = ctx.request.headers?.get?.('authorization') ?? ctx.request.header?.('authorization') ?? ''
    const providedDigest = createHmac('sha256', compareKey).update(String(header)).digest()
    if (!header || !timingSafeEqual(providedDigest, expectedDigest)) {
      ctx.$result = new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': challenge, 'Content-Type': 'text/plain; charset=utf-8' },
      })
      return
    }
    await next()
  }
}


/**
 * Generate the HTML page for Swagger UI that loads the OpenAPI spec from the given JSON endpoint.
 * @param {string} jsonPath - The URL path to the OpenAPI JSON spec (e.g. '/docs/json')
 * @param {string} title - The page title
 * @returns {string} Complete HTML string for the Swagger UI page
 *
 * @example
 * ```ts
 * const { html, scriptHashes, styleHashes } = buildSwaggerHtml('/docs/json', 'My API Docs')
 * ```
 */
/**
 * Build the Swagger UI HTML page along with the SHA-256 hashes of every
 * inline `<script>` and `<style>` block it embeds. Callers pair the HTML
 * with a CSP that lists those hashes, so we can ban `unsafe-inline`
 * outright and still execute the bootstrap.
 */
export function buildSwaggerHtml(jsonPath: string, title: string, ui?: SwaggerConfig['ui']): { html: string; scriptHashes: string[]; styleHashes: string[] } {
  const cssUrl = ui?.cssUrl ?? DEFAULT_CSS_URL
  const jsUrl = ui?.jsUrl ?? DEFAULT_JS_URL
  const cssIntegrity = ui?.cssIntegrity
  const jsIntegrity = ui?.jsIntegrity
  // `JSON.stringify` produces a JS string literal that's also safe to embed
  // inside an HTML `<script>` block. We additionally close any embedded
  // `</script>` so a crafted `jsonPath` cannot break out of the script tag.
  const safeJsonPath = JSON.stringify(jsonPath).replace(/<\/script/gi, '<\\/script')
  const cssTag = `<link rel="stylesheet" href="${escapeHtml(cssUrl)}"${cssIntegrity ? ` integrity="${escapeHtml(cssIntegrity)}" crossorigin="anonymous"` : ''} />`
  const jsTag = `<script src="${escapeHtml(jsUrl)}"${jsIntegrity ? ` integrity="${escapeHtml(jsIntegrity)}" crossorigin="anonymous"` : ' crossorigin'}></script>`

  const inlineStyle = `
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { background-color: #1b1b1b; }
  `
  const inlineScript = `
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: ${safeJsonPath},
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true,
        showExtensions: true,
        showCommonExtensions: true,
      });
    };
  `

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  ${cssTag}
  <style>${inlineStyle}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  ${jsTag}
  <script>${inlineScript}</script>
</body>
</html>`

  return {
    html,
    scriptHashes: [sha256Csp(inlineScript)],
    styleHashes: [sha256Csp(inlineStyle)],
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** SHA-256 hash of an inline script/style body, formatted for a CSP `'sha256-...'` source. */
function sha256Csp(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
}

/**
 * Build a strict Content-Security-Policy header for the Swagger UI page.
 * Bans `unsafe-inline`; instead, allowlists the SHA-256 hash of every
 * inline `<script>` / `<style>` block emitted by {@link buildSwaggerHtml}.
 */
function buildCsp(cssUrl: string, jsUrl: string, scriptHashes: string[], styleHashes: string[]): string {
  const origins = new Set<string>(["'self'"])
  for (const url of [cssUrl, jsUrl]) {
    try { origins.add(new URL(url).origin) } catch { /* relative URL: 'self' covers it */ }
  }
  const sources = [...origins].join(' ')
  const scriptInline = scriptHashes.join(' ')
  const styleInline = styleHashes.join(' ')
  return [
    `default-src 'none'`,
    `style-src ${sources} ${styleInline}`,
    `script-src ${sources} ${scriptInline}`,
    `img-src ${sources} data:`,
    `connect-src 'self'`,
    `font-src ${sources}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
  ].join('; ')
}


/**
 * Register Swagger UI and JSON spec endpoints on the given router.
 * Creates routes at `{config.path}` (UI) and `{config.path}/json` (spec).
 *
 * @param {RouterLike} router - The router to register routes on
 * @param {SwaggerConfig} [config={}] - Swagger configuration
 * @returns {void}
 *
 * @example
 * ```ts
 * swagger(router, { path: '/docs', title: 'My API', version: '1.0.0' })
 * ```
 */
export function swagger(router: RouterLike, config: SwaggerConfig = {}): void {
  // Environment gate (secure default): in production, do not register the
  // docs unless they are explicitly enabled or protected by auth. This
  // stops the full route map + schemas from leaking publicly when a
  // developer forgets to gate them. `enabled` overrides the gate in either
  // direction.
  if (config.enabled === false) return
  if (config.enabled !== true) {
    const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
    if (isProd && !config.auth) {
      const warn = (globalThis as any).console?.warn
      if (warn) warn('[swagger] Docs disabled in production: set `auth` or `enabled: true` to expose them.')
      return
    }
  }

  const basePath = (config.path || '/docs').replace(/\/$/, '')
  const jsonPath = `${basePath}/json`
  const uiPath = basePath
  const title = config.title || 'API Documentation'

  const guard = config.auth ? [buildBasicAuthMiddleware(config.auth)] : null
  const protect = (route: any) => (guard ? route.use(guard) : route)

  const cssUrl = config.ui?.cssUrl ?? DEFAULT_CSS_URL
  const jsUrl = config.ui?.jsUrl ?? DEFAULT_JS_URL
  // The HTML body, its inline-script SHA-256 hashes, and the CSP all
  // derive from the same `buildSwaggerHtml` invocation, so the policy
  // matches the script we actually serve. Cache once at registration
  // time — config doesn't change per request.
  const built = buildSwaggerHtml(jsonPath, title, config.ui)
  const csp = buildCsp(cssUrl, jsUrl, built.scriptHashes, built.styleHashes)
  const uiHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }

  // Register the /docs/json endpoint first
  protect(router.get!(jsonPath, () => {
    const spec = buildOpenApiSpec(router, config)
    return new Response(JSON.stringify(spec, null, 2), {
      headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
    })
  }))

  // Register the /docs UI endpoint
  protect(router.get!(uiPath, () => {
    return new Response(built.html, { headers: uiHeaders })
  }))

  // Also register /docs/ (with trailing slash) as alias to avoid 404
  protect(router.get!(`${uiPath}/`, () => {
    return new Response(built.html, { headers: uiHeaders })
  }))
}
