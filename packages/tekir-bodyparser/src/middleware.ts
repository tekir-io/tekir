import type { BodyParserConfig, FileValidationOptions } from './types'
import { parseMultipart, PayloadTooLargeError } from './parser'
import { parseSize } from './uploaded_file'


const JSON_TYPES = [
  'application/json',
  'application/json-patch+json',
  'application/vnd.api+json',
  'application/csp-report',
]

const FORM_TYPES = [
  'application/x-www-form-urlencoded',
]

const MULTIPART_TYPES = [
  'multipart/form-data',
]


function matchesContentType(contentType: string, types: string[]): boolean {
  for (const t of types) {
    if (contentType.includes(t)) return true
  }
  return false
}

// Keys that can poison Object.prototype if merged/assigned downstream. The
// urlencoded parser already blocks these; the JSON parser must do the same.
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Recursively strip prototype-pollution keys from a parsed JSON value.
 * `JSON.parse` places `__proto__` as an own (enumerable) property rather than
 * on the prototype, but downstream recursive merge/assign helpers can still
 * walk it into `Object.prototype`. Deleting the keys here neutralizes that.
 */
function stripProtoKeys(value: any, depth = 0): any {
  if (depth > 200 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = stripProtoKeys(value[i], depth + 1)
    return value
  }
  for (const key of Object.keys(value)) {
    if (PROTO_KEYS.has(key)) {
      delete value[key]
      continue
    }
    value[key] = stripProtoKeys(value[key], depth + 1)
  }
  return value
}

/**
 * Read a request body as text while enforcing a byte limit during streaming.
 * Aborts as soon as the accumulated size exceeds `limit` so an oversized
 * payload is never fully buffered. Falls back to `request.text()` when no
 * readable stream is available. Returns `{ tooLarge: true }` on overflow.
 */
async function readTextWithLimit(request: any, limit: number): Promise<{ text: string; tooLarge: boolean }> {
  // Cheap pre-check: if Content-Length is present and already over the limit,
  // reject before reading a single byte.
  const cl = request.headers?.get?.('content-length') ?? request.headers?.['content-length']
  if (cl && Number(cl) > limit) return { text: '', tooLarge: true }

  const body = request.body
  // Stream when possible so we can abort mid-flight on overflow.
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          total += value.byteLength
          if (total > limit) {
            try { await reader.cancel() } catch {}
            return { text: '', tooLarge: true }
          }
          chunks.push(value)
        }
      }
    } finally {
      try { reader.releaseLock?.() } catch {}
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength }
    return { text: new TextDecoder().decode(merged), tooLarge: false }
  }

  // No stream: fall back to text(), then enforce the limit post-hoc.
  let text = ''
  if (typeof request.text === 'function' && !request.bodyUsed) {
    text = await request.text()
  } else if (typeof request.body === 'string') {
    text = request.body
  }
  if (Buffer.byteLength(text) > limit) return { text: '', tooLarge: true }
  return { text, tooLarge: false }
}

function transformValues(body: Record<string, any>, convertNull: boolean, trim: boolean, depth = 0) {
  // Bound recursion so a deeply nested body cannot blow the stack.
  if (depth > 200) return
  for (const key of Object.keys(body)) {
    const v = body[key]
    if (typeof v === 'string') {
      let val = v
      if (trim) val = val.trim()
      if (convertNull && val === '') val = null as any
      body[key] = val
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Buffer)) {
      transformValues(v, convertNull, trim, depth + 1)
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === 'string') {
          let val = v[i]
          if (trim) val = val.trim()
          if (convertNull && val === '') val = null
          v[i] = val
        } else if (v[i] && typeof v[i] === 'object') {
          transformValues(v[i], convertNull, trim, depth + 1)
        }
      }
    }
  }
}

function parseQueryString(str: string, opts?: NonNullable<BodyParserConfig['form']>['queryString']): Record<string, any> {
  const depth = opts?.depth ?? 5
  const parameterLimit = opts?.parameterLimit ?? 1000
  const allowDots = opts?.allowDots ?? false
  const arrayLimit = opts?.arrayLimit ?? 100

  const result: Record<string, any> = {}
  const pairs = str.split('&').slice(0, parameterLimit)

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const rawKey = decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, ' '))
    const rawVal = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, ' '))

    // Handle bracket notation: a[b][c] or dot notation: a.b.c
    let keys: string[]
    if (allowDots && rawKey.includes('.')) {
      keys = rawKey.split('.').slice(0, depth + 1)
    } else if (rawKey.includes('[')) {
      keys = rawKey
        .replace(/\]/g, '')
        .split('[')
        .slice(0, depth + 1)
    } else {
      keys = [rawKey]
    }

    // Filter out prototype pollution keys
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

    let obj = result
    let poisoned = false
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      if (BLOCKED_KEYS.has(k)) { poisoned = true; break }
      if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {}
      obj = obj[k]
    }
    if (poisoned) continue

    const lastKey = keys[keys.length - 1]
    if (BLOCKED_KEYS.has(lastKey)) continue
    if (obj[lastKey] !== undefined) {
      if (Array.isArray(obj[lastKey])) {
        // Cap array growth so `a[]=...` repeated thousands of times can't
        // build an unbounded array (algorithmic-complexity DoS).
        if (obj[lastKey].length < arrayLimit) obj[lastKey].push(rawVal)
      } else {
        obj[lastKey] = [obj[lastKey], rawVal]
      }
    } else {
      obj[lastKey] = rawVal
    }
  }

  return result
}


/**
 * Full body parser middleware that handles JSON, form-urlencoded, multipart, and raw content types.
 * Attaches `ctx.body`, `ctx.files`, `ctx.file()`, `ctx.allFiles()`, and `ctx.rawBody` to the
 * request context. Supports method spoofing via the `_method` query parameter.
 *
 * @param config - Optional {@link BodyParserConfig} to control limits, allowed methods, parsers, etc.
 * @returns A middleware function `(ctx, next) => Promise<void>`.
 *
 * @example
 * ```ts
 * import { bodyParser } from '@tekir/bodyparser'
 *
 * // Use with defaults
 * router.useGlobal(bodyParser())
 *
 * // Custom configuration
 * router.useGlobal(bodyParser({
 *   json: { limit: '2mb', strict: true },
 *   multipart: { maxFileSize: '10mb', maxFiles: 5 },
 * }))
 * ```
 */
export function bodyParser(config?: BodyParserConfig) {
  const allowedMethods = (config?.allowedMethods || ['POST', 'PUT', 'PATCH', 'DELETE']).map(m => m.toUpperCase())

  const middleware = async (ctx: any, next: () => Promise<void>) => {
    const request = ctx.request?.raw || ctx.request
    if (!request) return next()

    // Default file accessors. Set on every request so handlers can call
    // `ctx.file(...)` / `ctx.files(...)` / `ctx.allFiles()` without an
    // optional-chain or content-type check; non-multipart requests get
    // a no-op fallback. The multipart branch below replaces these with
    // real implementations.
    ctx.file = () => undefined
    ctx.files = () => []
    ctx.allFiles = () => []

    let method = request.method?.toUpperCase() || 'GET'

    // ── Method spoofing (opt-in) ──────────────────────
    // Off by default: a spoofed mutating method can sidestep method-based
    // protections (e.g. CSRF) when those run after the parser. Only upgrade a
    // genuine POST so a GET can never be turned into a mutation.
    const url = typeof request.url === 'string' ? request.url : request.url?.toString?.() || ''
    if (config?.methodSpoofing && method === 'POST') {
      const qIdx = url.indexOf('?')
      if (qIdx !== -1) {
        const search = url.slice(qIdx + 1)
        const params = new URLSearchParams(search)
        const spoofed = params.get('_method')
        if (spoofed) {
          const upper = spoofed.toUpperCase()
          if (['PUT', 'PATCH', 'DELETE'].includes(upper)) {
            method = upper
            if (ctx.request && typeof ctx.request === 'object') {
              ctx.request._method = upper
            }
          }
        }
      }
    }

    if (!allowedMethods.includes(method)) return next()

    const contentType = request.headers?.get?.('content-type') || request.headers?.['content-type'] || ''
    const jsonTypes = config?.json?.types || JSON_TYPES
    const formTypes = config?.form?.types || FORM_TYPES
    const multipartTypes = config?.multipart?.types || MULTIPART_TYPES
    const rawTypes = config?.raw?.types || []

    // ── JSON parser ──────────────────────────────────
    if (matchesContentType(contentType, jsonTypes)) {
      // If core already parsed the body, use ctx.body
      if (request.bodyUsed && ctx.body !== undefined) {
        return next()
      }

      const limit = config?.json?.limit ? parseSize(config.json.limit) : parseSize('1mb')
      const strict = config?.json?.strict !== false

      const { text, tooLarge } = await readTextWithLimit(request, limit || Infinity)
      if (tooLarge) {
        ctx.response?.status?.(413)
        ctx.body = { error: 'Payload Too Large' }
        return
      }

      if (text) {
        try {
          const parsed = JSON.parse(text)
          if (strict && typeof parsed !== 'object') {
            ctx.response?.status?.(422)
            ctx.body = { error: 'JSON must be an object or array' }
            return
          }
          // Neutralize prototype-pollution keys before the body is exposed,
          // matching the urlencoded parser's BLOCKED_KEYS behavior.
          ctx.body = stripProtoKeys(parsed)
        } catch {
          ctx.response?.status?.(400)
          ctx.body = { error: 'Invalid JSON' }
          return
        }
      } else {
        ctx.body = {}
      }

      const convertNull = config?.json?.convertEmptyStringsToNull ?? config?.convertEmptyStringsToNull ?? false
      const trim = config?.json?.trimWhitespace ?? config?.trimWhitespace ?? false
      if ((convertNull || trim) && ctx.body && typeof ctx.body === 'object') {
        transformValues(ctx.body, convertNull, trim)
      }

      // Mark body as parsed so core doesn't re-read it
      if (request && typeof request === 'object') (request as any)._parsedBody = ctx.body

      return next()
    }

    // ── Form/urlencoded parser ────────────────────────
    if (matchesContentType(contentType, formTypes)) {
      if (request.bodyUsed && ctx.body !== undefined) {
        return next()
      }

      const limit = config?.form?.limit ? parseSize(config.form.limit) : parseSize('1mb')

      const { text, tooLarge } = await readTextWithLimit(request, limit || Infinity)
      if (tooLarge) {
        ctx.response?.status?.(413)
        ctx.body = { error: 'Payload Too Large' }
        return
      }

      ctx.body = text ? parseQueryString(text, config?.form?.queryString) : {}

      const convertNull = config?.form?.convertEmptyStringsToNull ?? config?.convertEmptyStringsToNull ?? false
      const trim = config?.form?.trimWhitespace ?? config?.trimWhitespace ?? false
      if (convertNull || trim) {
        transformValues(ctx.body, convertNull, trim)
      }

      if (request && typeof request === 'object') (request as any)._parsedBody = ctx.body
      return next()
    }

    // ── Multipart parser ─────────────────────────────
    if (matchesContentType(contentType, multipartTypes)) {
      // Check autoProcess / processManually for route-based control
      const routePath = ctx.route?.pattern || ctx.path || ''
      const autoProcess = config?.multipart?.autoProcess
      const processManually = config?.multipart?.processManually || []

      let shouldProcess = true
      if (autoProcess === false) {
        shouldProcess = false
      } else if (Array.isArray(autoProcess)) {
        shouldProcess = autoProcess.some(p => routePath === p || routePath.startsWith(p.replace(/:\w+/g, '')))
      }
      if (processManually.some(p => routePath === p || routePath.startsWith(p.replace(/:\w+/g, '')))) {
        shouldProcess = false
      }

      if (shouldProcess) {
        let parsed: Awaited<ReturnType<typeof parseMultipart>>
        try {
          parsed = await parseMultipart(request, config?.multipart)
        } catch (err: any) {
          // The streaming parser aborts mid-stream on limit overflow
          // (size / maxFiles / maxFields). Surface it as 413 rather than
          // letting it bubble to the framework error handler.
          if (err instanceof PayloadTooLargeError || err?.statusCode === 413) {
            ctx.response?.status?.(413)
            ctx.body = { error: 'Payload Too Large' }
            return
          }
          throw err
        }
        const { body, files } = parsed

        const convertNull = config?.multipart?.convertEmptyStringsToNull ?? config?.convertEmptyStringsToNull ?? false
        const trim = config?.multipart?.trimWhitespace ?? config?.trimWhitespace ?? false
        if (convertNull || trim) {
          transformValues(body, convertNull, trim)
        }

        ctx.body = body
        // `files` is now a method on ctx (returns `UploadedFile[]` for a
        // field) instead of the underlying `MultipartFiles` collection
        // object. AdonisJS-style: `ctx.file(name)` for single,
        // `ctx.files(name)` for multi, `ctx.allFiles()` for everything.
        // The collection class stays internal — needed by the parser
        // and exported as `MultipartFiles` for advanced consumers.
        ctx.file = (fieldName: string, validation?: FileValidationOptions) => files.file(fieldName, validation) ?? undefined
        ctx.files = (fieldName: string, validation?: FileValidationOptions) => files.files(fieldName, validation)
        ctx.allFiles = () => files.all()
        if (request && typeof request === 'object') (request as any)._parsedBody = body
      }

      return next()
    }

    // ── Raw parser ───────────────────────────────────
    if (rawTypes.length > 0 && matchesContentType(contentType, rawTypes)) {
      const limit = config?.raw?.limit ? parseSize(config.raw.limit) : parseSize('1mb')

      const { text, tooLarge } = await readTextWithLimit(request, limit || Infinity)
      if (tooLarge) {
        ctx.response?.status?.(413)
        ctx.body = { error: 'Payload Too Large' }
        return
      }

      ctx.rawBody = text
      return next()
    }

    return next()
  }

  Object.defineProperty(middleware, Symbol.for('tekir.bodyParser'), { value: true })
  return middleware
}
