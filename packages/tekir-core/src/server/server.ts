/**
 * Portions of this file are adapted from Elysia (MIT, Copyright 2022 saltyAom):
 *   - the AOT compiled-handler body parser that switches on
 *     `contentType.charCodeAt(12)` (Elysia: src/compose.ts)
 *   - the arrow-function source separator using `charCodeAt(0) === 40`
 *     and bracket walking (Elysia: src/sucrose.ts)
 *   - the query-string parser's bit-flag layout and `charCodeAt` switches
 *     for `&` (38), `=` (61), `+` (43), `%` (37) (Elysia: src/parse-query.ts)
 *
 * See `packages/tekir-core/NOTICE.md` for the full Elysia license text.
 */

import { Router } from '../router/router'
import { ExceptionHandler } from '../exceptions/exception_handler'
import { WsManager } from '../ws/index'
import { createResponse, finalizeResponse } from '../http/response'
import { createRequest, getRequestCookies } from '../http/request'
import type { MiddlewareFunction, ServerOptions, RouteHandler, LifecycleHook } from '../http/types'

const EMPTY = Object.freeze(Object.create(null))
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' })
const JSON_RESPONSE_INIT = Object.freeze({ headers: JSON_HEADERS })

/** Match a domain pattern (e.g. ':tenant.example.com') against a hostname */
function matchDomain(pattern: string, hostname: string): Record<string, string> | null {
  const patternParts = pattern.split('.')
  const hostParts = hostname.split('.')
  if (patternParts.length !== hostParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = hostParts[i]
    } else if (patternParts[i] !== hostParts[i]) {
      return null
    }
  }
  return params
}

// Decode a single path segment without throwing on malformed `%` escapes.
// Mirrors the trie's decode so the two matching paths agree, and a bad
// sequence like `%E0%A4%A` yields the raw segment instead of a 500.
function safeDecode(segment: string): string {
  try { return decodeURIComponent(segment) } catch { return segment }
}

// Domain-route matcher. Static segments win over `:param`, and a trailing
// `*` captures the remainder. `decodeURIComponent` is applied to params so
// this agrees with the trie's decode behavior. The trie itself is used for
// all non-domain routing (see `handle`); this only covers domain patterns,
// which are not stored in the trie.
function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === pathname) return Object.create(null)
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  const hasWildcard = pattern.includes('*')
  if (patternParts.length !== pathParts.length && !hasWildcard) return null
  const params: Record<string, string> = Object.create(null)
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]
    if (pp === '*') {
      params['*'] = pathParts.slice(i).map(safeDecode).join('/')
      return params
    }
    if (i >= pathParts.length) return null
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = safeDecode(pathParts[i])
    } else if (pp !== pathParts[i]) {
      return null
    }
  }
  // Non-wildcard pattern must consume the whole path.
  if (pathParts.length !== patternParts.length) return null
  return params
}

const _j = (d: any, s: number, fallback: string) =>
  new Response(JSON.stringify(d ?? { message: fallback }), { status: s, headers: JSON_HEADERS })
const _r = (u: string, s: number) => new Response(null, { status: s, headers: { Location: u } })

const responseHelpers = Object.freeze({
  // Core
  status: () => responseHelpers,
  json: (d?: any) => new Response(JSON.stringify(d ?? null), JSON_RESPONSE_INIT),
  send: (d?: any) => { if (d == null) return new Response(null, { status: 204 }); if (d instanceof Response) return d; if (typeof d === 'object') return new Response(JSON.stringify(d), JSON_RESPONSE_INIT); return new Response(String(d)) },
  html: (d: string) => new Response(d, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  text: (d: string) => new Response(d, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
  redirect: (u: string, s = 302) => _r(u, s),
  stream: (r: ReadableStream) => new Response(r),
  download: async (fp: string) => (globalThis as any).Bun ? new Response(Bun.file(fp)) : new Response(await (await import('node:fs/promises')).readFile(fp)),
  getStatusCode: () => 200,

  // Headers (no-op in compiled path - use createResponse for full header support)
  header: () => responseHelpers, safeHeader: () => responseHelpers,
  append: () => responseHelpers, removeHeader: () => responseHelpers,
  cookie: () => responseHelpers, clearCookie: () => responseHelpers,

  // 2xx
  ok: (d?: any) => d !== undefined ? (typeof d === 'object' ? new Response(JSON.stringify(d), JSON_RESPONSE_INIT) : new Response(String(d))) : new Response(null),
  created: (d?: any) => _j(d, 201, 'Created'),
  accepted: (d?: any) => _j(d, 202, 'Accepted'),
  noContent: () => new Response(null, { status: 204 }),

  // 3xx
  movedPermanently: (u: string) => _r(u, 301),
  found: (u: string) => _r(u, 302),
  seeOther: (u: string) => _r(u, 303),
  notModified: () => new Response(null, { status: 304 }),
  temporaryRedirect: (u: string) => _r(u, 307),
  permanentRedirect: (u: string) => _r(u, 308),

  // 4xx
  badRequest: (d?: any) => _j(d, 400, 'Bad Request'),
  unauthorized: (d?: any) => _j(d, 401, 'Unauthorized'),
  paymentRequired: (d?: any) => _j(d, 402, 'Payment Required'),
  forbidden: (d?: any) => _j(d, 403, 'Forbidden'),
  notFound: (d?: any) => _j(d, 404, 'Not Found'),
  methodNotAllowed: (d?: any) => _j(d, 405, 'Method Not Allowed'),
  notAcceptable: (d?: any) => _j(d, 406, 'Not Acceptable'),
  requestTimeout: (d?: any) => _j(d, 408, 'Request Timeout'),
  conflict: (d?: any) => _j(d, 409, 'Conflict'),
  gone: (d?: any) => _j(d, 410, 'Gone'),
  preconditionFailed: (d?: any) => _j(d, 412, 'Precondition Failed'),
  payloadTooLarge: (d?: any) => _j(d, 413, 'Payload Too Large'),
  unsupportedMediaType: (d?: any) => _j(d, 415, 'Unsupported Media Type'),
  unprocessableEntity: (d?: any) => _j(d, 422, 'Unprocessable Entity'),
  tooManyRequests: (d?: any) => _j(d, 429, 'Too Many Requests'),

  // 5xx
  internalServerError: (d?: any) => _j(d, 500, 'Internal Server Error'),
  notImplemented: (d?: any) => _j(d, 501, 'Not Implemented'),
  badGateway: (d?: any) => _j(d, 502, 'Bad Gateway'),
  serviceUnavailable: (d?: any) => _j(d, 503, 'Service Unavailable'),
  gatewayTimeout: (d?: any) => _j(d, 504, 'Gateway Timeout'),
}) as any

// Adapted from Elysia's parse-query (`elysia/src/parse-query.ts`, MIT,
// Copyright 2022 saltyAom). The bit-flag layout and `charCodeAt` switches
// for `&` (38), `=` (61), `+` (43) and `%` (37) come from there.
function fastParseQuery(qs: string): Record<string, string | string[]> {
  if (!qs) return EMPTY
  const r: Record<string, string | string[]> = Object.create(null)
  let f = 0, si = -1, ei = -1
  const l = qs.length
  for (let i = 0; i <= l; i++) {
    const ch = i === l ? 38 : qs.charCodeAt(i)
    if (ch === 38) {
      if (i > si + 1) {
        const hv = ei !== -1 && ei > si + 1
        let k = qs.slice(si + 1, hv ? ei : i)
        if (f & 1) k = k.replace(/\+/g, ' ')
        if (f & 2) try { k = decodeURIComponent(k) } catch {}
        let v = ''
        if (hv) { v = qs.slice(ei + 1, i); if (f & 4) v = v.replace(/\+/g, ' '); if (f & 8) try { v = decodeURIComponent(v) } catch {} }
        const ex = r[k]
        if (ex !== undefined) { if (Array.isArray(ex)) ex.push(v); else r[k] = [ex, v] } else r[k] = v
      }
      si = i; ei = -1; f = 0
    } else if (ch === 61) { if (ei === -1) ei = i; else f |= 8 }
    else if (ch === 43) f |= ei !== -1 ? 4 : 1
    else if (ch === 37) f |= ei !== -1 ? 8 : 2
  }
  return r
}

// Generator → SSE/stream Response. Pattern adapted from Elysia
// (`elysia/src/handler.ts`). Handles both `function*` (sync) and
// `async function*` (async) handlers — `gen.next()` works for either.
function generatorToStream(gen: Generator | AsyncGenerator): Promise<Response> {
  const encoder = new TextEncoder()

  const format = (value: any): Uint8Array => {
    if (typeof value === 'string') return encoder.encode(value)
    if (typeof value === 'object' && value !== null) {
      // SSE object format: { event?, data, id?, retry? }
      if (value.data !== undefined) {
        let chunk = ''
        if (value.event) chunk += `event: ${value.event}\n`
        if (value.id) chunk += `id: ${value.id}\n`
        if (value.retry) chunk += `retry: ${value.retry}\n`
        const data = typeof value.data === 'object' ? JSON.stringify(value.data) : String(value.data)
        chunk += `data: ${data}\n\n`
        return encoder.encode(chunk)
      }
      return encoder.encode(JSON.stringify(value) + '\n')
    }
    return encoder.encode(String(value))
  }

  const isSSEChunk = (value: any): boolean => {
    if (typeof value === 'string') return value.startsWith('data:') || value.startsWith('event:')
    return typeof value === 'object' && value !== null && value.data !== undefined
  }

  // Pull the first chunk up front so the Content-Type can be decided before
  // the Response headers are sealed. `new Response(stream, init)` snapshots
  // its headers at construction time, so flipping a flag inside `pull()`
  // never reaches the wire — the header would always be the initial value.
  // `Promise.resolve` normalises both shapes: a sync generator's `next()`
  // returns `{value, done}` directly, an async generator's returns a promise.
  return Promise.resolve(gen.next()).then((first) => {
    const isSSE = !first.done && isSSEChunk(first.value)

    const stream = new ReadableStream({
      start(controller) {
        if (!first.done) controller.enqueue(format(first.value))
      },
      async pull(controller) {
        try {
          const { value, done } = await gen.next()
          if (done) { controller.close(); return }
          controller.enqueue(format(value))
        } catch {
          controller.close()
        }
      },
      cancel() {
        if (typeof gen.return === 'function') gen.return(undefined)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': isSSE ? 'text/event-stream' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Tell nginx / proxies not to buffer an event stream, which would
        // otherwise stall long-running SSE behind a fill-the-buffer wait.
        ...(isSSE ? { 'X-Accel-Buffering': 'no' } : {}),
      },
    })
  })
}

/**
 * Apply `ctx.$responseHeaders` onto an outgoing response. Skips the work
 * (and avoids the Headers + Response allocation) when nothing was written
 * to `$responseHeaders`, so routes that do not use middleware like CORS
 * stay zero-cost on the hot path.
 *
 * `Vary` is appended (not overwritten) so a handler-set value like
 * `Accept-Encoding` keeps living next to the `Origin` token CORS adds.
 */
function mergeResponseHeaders(response: Response, ctx: any): Response {
  const extra: Headers | undefined = ctx?.$responseHeaders
  if (!extra) return response
  const merged = new Headers(response.headers)
  const apply = (key: string, value: string) => {
    // Drop any header name/value carrying CR or LF. The Headers API rejects
    // these on most runtimes, but validating here keeps response-splitting off
    // the table even if a middleware staged a reflected, attacker-influenced
    // value (e.g. an Origin echoed into a custom header).
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) return
    if (key.toLowerCase() === 'vary') {
      const existing = merged.get('Vary')
      if (!existing) {
        merged.set('Vary', value)
        return
      }
      const have = existing.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      const incoming = value.split(',').map(s => s.trim()).filter(Boolean)
      const additions = incoming.filter(token => !have.includes(token.toLowerCase()))
      if (additions.length) merged.set('Vary', `${existing}, ${additions.join(', ')}`)
      return
    }
    merged.set(key, value)
  }
  if (typeof (extra as any).forEach === 'function') {
    ;(extra as Headers).forEach((value, key) => { apply(key, value) })
  } else {
    for (const [key, value] of Object.entries(extra as any)) apply(key, String(value))
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

function compileHandler(
  handler: RouteHandler,
  middlewares: MiddlewareFunction[],
  pattern: string,
  globalMw: MiddlewareFunction[],
  routeMethod: string,
  routeName: string | undefined,
  responseFactory: (request: Request) => ReturnType<typeof createResponse>,
  handleError: (error: Error, ctx: any) => Promise<Response>
): (req: Request) => Response | Promise<Response> {
  const allMw = [...globalMw, ...middlewares]
  const hasMw = allMw.length > 0
  const delegatesBodyParsing = allMw.some(middleware => Boolean((middleware as any)[Symbol.for('tekir.bodyParser')]))
  const isDynamic = /[:*]/.test(pattern)

  // Use __source if available (bound methods from decorator controllers)
  const hasOrigSource = !!(handler as any).__source
  const fnStr = hasOrigSource ? (handler as any).__source : handler.toString()
  const allStr = hasMw ? fnStr + '\n' + allMw.map(m => m.toString()).join('\n') : fnStr

  const isBound = !hasOrigSource && fnStr.includes('[native code]')
  const arrowParam = /^\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s*=>/.exec(fnStr)
  const functionParam = /^\s*(?:async\s+)?function(?:\s+[\w$]+)?\s*\(\s*([A-Za-z_$][\w$]*)/.exec(fnStr)
  const methodParam = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(\s*([A-Za-z_$][\w$]*)/.exec(fnStr)
  const usesWholeContext = !!(arrowParam?.[1] || arrowParam?.[2] || functionParam?.[1] || methodParam?.[1])
  const isPassThrough = isBound || usesWholeContext || /\binstance\b/.test(fnStr)

  // Any use of the response context needs a real per-request builder. Header,
  // cookie, attachment, signed/encrypted cookie and status state cannot live
  // on the frozen static helper. Detect the response object itself rather than
  // a list of method names: response calls may be delegated to helper
  // functions and new stateful methods must remain correct automatically.
  const usesRedirectBack = /\bredirect\s*\.\s*back\b/.test(allStr)
  const usesResponseObject = isPassThrough || hasMw || /\bresponse\b/.test(allStr)
  const needsStatefulResponse = usesRedirectBack || usesResponseObject

  const inference = isPassThrough || hasMw ? {
    query: true, body: true, headers: true, params: true, request: true, response: true,
  } : {
    query: /\bquery\b/.test(allStr) || /\binput\b/.test(allStr),
    body: /\bbody\b/.test(allStr)
      || /\binput\b/.test(allStr)
      || /\bbodyError\b/.test(allStr)
      || /\brequest\s*\.\s*(all|only|except|hasBody)\b/.test(allStr)
      || /[,(]\s*request\s*[,)]/.test(allStr),
    headers: /\bheaders\b/.test(allStr),
    params: /\bparams\b/.test(allStr) || isDynamic,
    request: /\brequest\b/.test(allStr),
    response: /\bresponse\b/.test(allStr) || needsStatefulResponse,
  }

  const parsesBody = inference.body && !delegatesBodyParsing && !['GET', 'HEAD', 'OPTIONS'].includes(routeMethod)
  const lazyContextFields = isPassThrough || hasMw
  const eagerQuery = inference.query && !lazyContextFields
  const isAsync = /\basync\b/.test(fnStr) || /\bawait\b/.test(fnStr) || parsesBody || hasMw

  // NOTE: A former "inline" path re-parsed the handler's `.toString()` source
  // with regexes and re-emitted its body into a `new Function(...)`, and
  // `tryStaticJsonBody` even *executed* arbitrary handler expressions at build
  // time via `Function("return (" + src + ")")()`. Both have been removed:
  // a mis-parse silently served the wrong body, and the build-time eval was a
  // code-execution surface whose blocklist (`new|function|class|...`) was
  // trivially bypassable (`constructor`, template literals, etc.). The
  // compiled path below calls the real handler closure directly, so behavior
  // always matches the authored source.

  // COMPILED PATH: build function string with context object
  let fn = 'const rh=d.rh,E=d.E,pq=d.pq,JI=d.JI,handler=d.handler,cr=d.cr,creq=d.creq,eh=d.eh'
  if (hasMw) fn += ',mw=d.mw,mh=d.mh'
  fn += '\n'
  fn += isAsync ? 'return async function(request){\n' : 'return function(request){\n'

  if (eagerQuery) {
    fn += 'const u=request.url,s=u.indexOf("/",11),qi=u.indexOf("?",s+1)\n'
    fn += 'const query=qi===-1?E:pq(u.substring(qi+1))\n'
  }
  if (inference.body && !parsesBody) {
    fn += 'let body,bodyError,_files=[]\n'
  }
  if (parsesBody) {
    // Parse the normalized media type. Structured JSON suffixes such as
    // application/problem+json are JSON by RFC convention, and media types
    // are case-insensitive.
    // Parse failures (empty body w/ JSON content-type, malformed payloads,
    // etc.) are caught and exposed via `ctx.bodyError` so middleware and
    // handlers can respond with a real 400 instead of letting the route
    // crash with a generic 500.
    fn += 'let body,bodyError,_files=[]\nif(request.method!=="GET"&&request.method!=="HEAD"){\n'
    fn += 'const _cth=request.headers.get("content-type"),ct=_cth?_cth.split(";",1)[0].trim().toLowerCase():""\n'
    fn += 'if(ct){try{\n'
    fn += 'if(ct==="application/json"||ct.endsWith("+json"))body=await request.json()\n'
    fn += 'else if(ct==="application/x-www-form-urlencoded"){const t=await request.text();body=Object.create(null);for(const[k,v]of new URLSearchParams(t))body[k]=v}\n'
    fn += 'else if(ct==="multipart/form-data"){const fd=await request.formData();body=Object.create(null);for(const[k,v]of fd){if(typeof File!=="undefined"&&v instanceof File){_files.push({field:k,file:v})}else{if(body[k]!==undefined){if(Array.isArray(body[k]))body[k].push(v);else body[k]=[body[k],v]}else body[k]=v}}}\n'
    fn += '}catch(_be){bodyError=_be}}}\n'
    // Method spoofing: _method in body or query overrides HTTP method
    fn += 'if(body&&body._method){request._spoofedMethod=body._method.toUpperCase();delete body._method}\n'
  }

  // Per-request response state for every route that consumes `ctx.response`.
  if (needsStatefulResponse) {
    // Lazy allocation keeps middleware-heavy routes that never touch the
    // response builder off the allocation path while preserving correctness
    // for delegated/dynamic context access.
    fn += 'let _resp\nconst _getResp=()=>_resp||(_resp=cr(request))\n'
  }
  if (inference.request) {
    fn += 'let _req\nconst _getReq=()=>_req||(_req=creq(request,request.params||E,' + (inference.body ? 'body' : 'undefined') + ',' + JSON.stringify(routeName) + ',' + (eagerQuery ? 'query' : 'undefined') + '))\n'
  }
  fn += 'const c={'
  if (inference.request) {
    fn += 'get request(){return _getReq()},'
  }
  if (inference.response) fn += (needsStatefulResponse ? 'get response(){return _getResp()},' : 'response:rh,')
  fn += 'params:' + (inference.params ? 'request.params||E' : 'E')
  if (inference.query) fn += lazyContextFields ? ',get query(){return _getReq().qs()}' : ',query'
  if (inference.body) fn += ',body,bodyError'
  if (inference.headers) fn += lazyContextFields ? ',get headers(){return _getReq().headers()}' : ',headers:Object.fromEntries(request.headers.entries())'
  if (hasMw || /\bcookies?\b/.test(allStr)) fn += lazyContextFields ? ',get cookies(){return d.gcs(request)}' : ',cookies:d.gcs(request)'
  if (isPassThrough || hasMw || /\bsubdomains\b/.test(allStr)) fn += ',subdomains:request.subdomains||E'
  if (hasMw || /\broute\b/.test(allStr)) fn += ',route:{pattern:' + JSON.stringify(pattern) + ',name:' + JSON.stringify(routeName) + '}'
  if (hasMw || /\bstore\b/.test(allStr)) fn += ',store:{}'
  if (inference.body) fn += ',_rawFiles:_files'
  fn += '}\n'

  // Add redirect and status utilities only when used
  if (hasMw || /\bredirect\b/.test(allStr)) fn += 'c.redirect=(u,s)=>new Response(null,{status:s||302,headers:{Location:u}})\n'
  if (hasMw || /\bstatus\b/.test(allStr)) fn += 'c.status=(code,body)=>body!=null?new Response(typeof body==="object"?JSON.stringify(body):String(body),{status:code,headers:typeof body==="object"?{"Content-Type":"application/json"}:{}}):new Response(null,{status:code})\n'

  const finish = (expression: string) => needsStatefulResponse
    ? `(_resp?d.fr(_resp,${expression}):${expression})`
    : expression
  const prepareErrorContext =
    (inference.request ? '' : 'c.request=creq(request,request.params||E,undefined,' + JSON.stringify(routeName) + ')\n') +
    (inference.response ? '' : 'c.response=cr(request)\n')

  if (!hasMw) {
    fn += 'try{\n'
    fn += (isAsync ? 'let r=await handler(c)\n' : 'let r=handler(c)\n')
    if (!isAsync) {
      fn += 'if(r&&typeof r.then==="function")return r.then(async r2=>{if(r2 instanceof Response)return ' + finish('r2') + ';if(r2&&typeof r2.next==="function"&&(typeof r2[Symbol.asyncIterator]==="function"||typeof r2[Symbol.iterator]==="function"))return ' + finish('await d.toStream(r2)') + ';const _o=typeof r2==="object"&&r2!==null?new Response(JSON.stringify(r2),JI):r2==null?new Response(null,{status:204}):new Response(String(r2));return ' + finish('_o') + '}).catch(async e=>{' + prepareErrorContext + 'return eh(e,c)})\n'
    }
    fn += 'if(r instanceof Response)return ' + finish('r') + '\n'
    // Generator detection must precede the plain-object branch: a generator
    // is `typeof === "object"`, so without this it would be JSON-stringified
    // to `{}`. Covers both `function*` (Symbol.iterator) and `async
    // function*` (Symbol.asyncIterator); `typeof r.next` short-circuits for
    // every non-iterator object so the hot path pays one property read.
    fn += 'if(r&&typeof r.next==="function"&&(typeof r[Symbol.asyncIterator]==="function"||typeof r[Symbol.iterator]==="function"))return d.toStream(r).then(_o=>' + finish('_o') + ')\n'
    fn += 'if(r==null){const _o=new Response(null,{status:204});return ' + finish('_o') + '}\n'
    fn += 'if(typeof r==="object"){const _o=new Response(JSON.stringify(r),JI);return ' + finish('_o') + '}\n'
    fn += '{const _o=new Response(String(r));return ' + finish('_o') + '}\n'
    fn += '}catch(e){' + prepareErrorContext + 'return eh(e,c)}\n'
  } else {
    // Capture middleware return value: if a middleware returns a Response
    // (or anything truthy) and didn't already set `c.$result`, treat the
    // return as the response. Lets users write `return response.unauthorized()`
    // from middleware Express/Koa-style without remembering `ctx.$result =`.
    //
    // Every return path runs through `mh()` so anything middleware wrote
    // to `ctx.$responseHeaders` (CORS, request id, server timing, etc.)
    // lands on the outgoing response, including framework-handled errors.
    fn += 'let mi=0\nconst nx=async()=>{if(mi<mw.length){const _mr=await mw[mi++](c,nx);if(_mr!==undefined&&c.$result===undefined)c.$result=_mr}else{c.$result=await handler(c)}}\n'
    fn += 'try{await nx()}catch(e){return mh(' + finish('await eh(e,c)') + ',c)}\n'
    fn += 'const result=c.$result\n'
    fn += 'if(result&&typeof result.next==="function"&&(typeof result[Symbol.asyncIterator]==="function"||typeof result[Symbol.iterator]==="function"))return mh(' + finish('await d.toStream(result)') + ',c)\n'
    fn += 'if(result instanceof Response)return mh(' + finish('result') + ',c)\n'
    fn += 'if(result!=null){const _o=typeof result==="object"?new Response(JSON.stringify(result),JI):new Response(String(result));return mh(' + finish('_o') + ',c)}\n'
    fn += '{const _o=new Response(null,{status:204});return mh(' + finish('_o') + ',c)}\n'
  }

  fn += '}\n'
  return Function('d', fn)({
    handler, rh: responseHelpers, cr: responseFactory, creq: createRequest,
    E: EMPTY, pq: fastParseQuery, JI: JSON_RESPONSE_INIT,
    mw: hasMw ? allMw : undefined, eh: handleError,
    mh: hasMw ? mergeResponseHeaders : undefined,
    toStream: generatorToStream,
    gcs: getRequestCookies, fr: finalizeResponse,
  })
}

interface RouterHooks {
  onRequest: LifecycleHook[]
  onBeforeHandle: LifecycleHook[]
  onAfterHandle: LifecycleHook[]
  onAfterResponse: LifecycleHook[]
  onError: ((error: Error, ctx: any) => any)[]
}

function collectRoutes(
  trie: any,
  globalMw: MiddlewareFunction[],
  hooks: RouterHooks,
  exceptionHandler: ExceptionHandler,
  responseFactory: (request: Request) => ReturnType<typeof createResponse>,
): Record<string, any> {
  const routes: Record<string, any> = {}

  const handleRouteError = async (error: Error, ctx: any): Promise<Response> => {
    for (const hook of hooks.onError) {
      try {
        const result = await hook(error, ctx)
        if (result !== undefined && result !== null) {
          const outgoing = result instanceof Response
            ? result
            : new Response(typeof result === 'object' ? JSON.stringify(result) : String(result), {
              status: (error as any)?.statusCode || 500,
              headers: typeof result === 'object' ? JSON_HEADERS : undefined,
            })
          return ctx?.response ? finalizeResponse(ctx.response, outgoing) : outgoing
        }
      } catch {}
    }
    const outgoing = await exceptionHandler.handle(error, ctx)
    return ctx?.response ? finalizeResponse(ctx.response, outgoing) : outgoing
  }

  // Build hook middleware wrappers
  const hookMiddlewares: MiddlewareFunction[] = []

  // onRequest + onBeforeHandle run before the handler
  if (hooks.onRequest.length || hooks.onBeforeHandle.length) {
    hookMiddlewares.push(async (ctx: any, next: () => Promise<void>) => {
      for (const hook of hooks.onRequest) {
        const result = await hook(ctx)
        if (result instanceof Response) { ctx.$result = result; return }
      }
      for (const hook of hooks.onBeforeHandle) {
        const result = await hook(ctx)
        if (result instanceof Response) { ctx.$result = result; return }
      }
      await next()
    })
  }

  const walk = (node: any) => {
    for (const [method, route] of node.handlers) {
      const pattern = route.pattern || '/'
      const allMw = [...hookMiddlewares, ...route.middlewares]

      // Wrap handler to support onAfterHandle + onAfterResponse
      let handler = route.handler
      if (hooks.onAfterHandle.length || hooks.onAfterResponse.length) {
        const originalHandler = handler
        handler = async (ctx: any) => {
          const result = await originalHandler(ctx)
          ctx.$result = result
          for (const hook of hooks.onAfterHandle) {
            const modified = await hook(ctx)
            if (modified instanceof Response) { ctx.$result = modified; break }
          }
          // Fire onAfterResponse asynchronously (fire-and-forget). The outer
          // `.catch` guards against a synchronous throw in the `.then` body
          // itself becoming an unhandled rejection that crashes the process.
          if (hooks.onAfterResponse.length) {
            Promise.resolve().then(async () => {
              for (const hook of hooks.onAfterResponse) {
                try { await hook(ctx) } catch {}
              }
            }).catch(() => {})
          }
          return ctx.$result
        }
      }

      const wrapped = compileHandler(
        handler,
        allMw,
        pattern,
        globalMw,
        method,
        route.name,
        responseFactory,
        handleRouteError,
      )
      const domain = route.domain
      if (domain) {
        // Domain-specific routes go into a separate map
        const key = `__domain:${domain}:${pattern}`
        if (!routes[key]) routes[key] = { __domain: domain, __pattern: pattern, handlers: {} }
        if (method === 'ANY') routes[key].handlers = { ANY: wrapped }
        else routes[key].handlers[method] = wrapped
      } else {
        if (!routes[pattern]) routes[pattern] = {}
        if (method === 'ANY') routes[pattern] = wrapped
        else if (typeof routes[pattern] !== 'function') routes[pattern][method] = wrapped
      }
    }
    for (const [, child] of node.children) walk(child)
    if (node.paramChild) walk(node.paramChild.node)
    if (node.wildcardChild) walk(node.wildcardChild.node)
  }
  walk(trie.root)

  // Synthesize OPTIONS handlers on every method-scoped path that did not
  // register one explicitly. Browsers send a CORS preflight to the actual
  // route URL; without a matching method handler Bun.serve responds 405 and
  // the request never reaches global middleware (so a `cors()` middleware
  // never sees the preflight). The synthetic handler runs the same global
  // middleware chain as a normal route, so CORS or any other middleware can
  // short-circuit and return the preflight response. When nothing
  // intercepts, it falls through to a bare 204.
  // Plain `function` (not an arrow) so compileHandler's inline-path parser
  // skips it; the inline path wraps the return value in `Response.json(...)`,
  // which would double-wrap our `new Response(...)` and produce a 200 with a
  // serialized Response body instead of the 204 we want.
  const noOpOptions: RouteHandler = function noOpOptions() { return new Response(null, { status: 204 }) }
  for (const [pattern, value] of Object.entries(routes)) {
    if (typeof value === 'function') continue // ANY-route: handles every method already
    if (value?.__domain) {
      if (value.handlers && !value.handlers.OPTIONS && !value.handlers.ANY) {
        value.handlers.OPTIONS = compileHandler(noOpOptions, [...hookMiddlewares], value.__pattern || pattern, globalMw, 'OPTIONS', undefined, responseFactory, handleRouteError)
      }
      continue
    }
    if (!value.OPTIONS) {
      value.OPTIONS = compileHandler(noOpOptions, [...hookMiddlewares], pattern, globalMw, 'OPTIONS', undefined, responseFactory, handleRouteError)
    }
  }

  // Synthesize a fallback handler for unmatched paths so the framework's
  // default 404 still runs through the global middleware chain. Without
  // this, a stray request to `/non-existent` skipped CORS, request
  // logging, and any other middleware, and the browser saw a generic
  // "CORS error" on what was actually a 404. Stored under a sentinel key
  // so handle() and the Bun.serve fetch fallback can pick it up; both
  // strip it from the routes table before Bun.serve sees the map.
  const noOpNotFound: RouteHandler = function noOpNotFound() {
    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
  ;(routes as any).__fallback = compileHandler(noOpNotFound, [...hookMiddlewares], '*', globalMw, 'ANY', undefined, responseFactory, handleRouteError)

  return routes
}

/**
 * Core HTTP server that compiles routes, manages middleware, WebSocket handlers,
 * and serves requests via Bun or the Tekir runtime adapter.
 *
 * @example
 * const server = new TekirServer()
 * server.use([cors(), session()])
 * server.configure({ port: 3000, development: true })
 * server.start()
 */
export class TekirServer {
  private router: Router
  private exceptionHandler: ExceptionHandler
  private wsManager: WsManager
  private server: any = null
  private options: ServerOptions = {}
  private _routeCount = 0
  private _fallback: ((req: Request) => Response | Promise<Response>) | null = null
  private _buildHooks: (() => Promise<void>)[] = []
  private _stopHooks: (() => void | Promise<void>)[] = []
  private _staticRoutes: Record<string, any> = {}

  constructor() {
    this.router = new Router()
    this.exceptionHandler = new ExceptionHandler()
    this.wsManager = new WsManager()
  }

  /** @returns The server's Router instance */
  getRouter(): Router { return this.router }

  /** @returns The server's ExceptionHandler instance */
  getExceptionHandler(): ExceptionHandler { return this.exceptionHandler }

  /**
   * Get the WebSocket manager to register WS routes.
   * @example
   * server.ws().route('/ws/chat', {
   *   open(ws) { ws.subscribe('chat') },
   *   message(ws, msg) { ws.publish('chat', msg) },
   *   close(ws) { ws.unsubscribe('chat') },
   * })
   */
  ws(): WsManager { return this.wsManager }

  /**
   * Register server-level middleware that runs on ALL requests (even unmatched routes).
   * @example
   * server.use([
   *   cors(config('cors')),
   *   session(config('session')),
   * ])
   */
  use(middleware: MiddlewareFunction | MiddlewareFunction[]): this {
    this.router.useGlobal(middleware)
    return this
  }

  /**
   * Set a fallback handler for requests that do not match any registered route.
   * @param handler - Function that receives the unmatched request and returns a Response
   * @returns The server instance for chaining
   */
  fallback(handler: (req: Request) => Response | Promise<Response>): this {
    this._fallback = handler
    return this
  }

  /**
   * Register a static route (e.g. HTML page imports) that bypasses the router trie.
   * @param path - The URL path to serve
   * @param handler - The route handler (typically a pre-compiled Response or function)
   * @returns The server instance for chaining
   */
  addStaticRoute(path: string, handler: any): this {
    this._staticRoutes[path] = handler
    return this
  }

  /**
   * Register a hook that runs during the build phase, before the server starts.
   * @param fn - Async function to execute during build
   * @returns The server instance for chaining
   */
  onBuild(fn: () => Promise<void>): this {
    this._buildHooks.push(fn)
    return this
  }

  /** Register cleanup owned by server integrations (Vite, Next, etc.). */
  onStop(fn: () => void | Promise<void>): this {
    this._stopHooks.push(fn)
    return this
  }

  async build(): Promise<void> {
    for (const fn of this._buildHooks) await fn()
  }

  /**
   * Set a custom error handler for uncaught exceptions.
   * @example
   * server.errorHandler((error, ctx) => {
   *   return ctx.response.internalServerError({ message: error.message })
   * })
   */
  errorHandler(handler: (error: Error, ctx: any) => any): this {
    this.router.onError(handler)
    return this
  }

  buildRoutes(): Record<string, any> {
    this.router.compile()
    const responseFactory = (request: Request) => createResponse(request, {
      trustedHosts: this.options.trustedHosts,
    })
    return collectRoutes(
      this.router.getTrie(),
      this.router.globalMiddlewares,
      this.router.hooks,
      this.exceptionHandler,
      responseFactory,
    )
  }

  configure(options: ServerOptions): this {
    this.options = { ...this.options, ...options }
    if (options.development !== undefined) {
      this.exceptionHandler.debug = options.development
    }
    return this
  }

  private _compiledRoutes: Record<string, any> | null = null

  private ensureRoutes(): Record<string, any> {
    if (!this._compiledRoutes) this._compiledRoutes = this.buildRoutes()
    return this._compiledRoutes
  }

  async handle(request: Request): Promise<Response> {
    const routes = this.ensureRoutes()
    const url = new URL(request.url)
    const method = request.method

    // Route through the same trie the Bun path uses so static-vs-dynamic
    // precedence (`/users/me` before `/users/:id`), wildcard handling, and
    // `decodeURIComponent` on params are identical across runtimes. The trie
    // owns precedence; the compiled-handler map is keyed by `route.pattern`,
    // so we look the handler up by the matched pattern.
    const matched = this.router.match(method, url.pathname)
    if (matched) {
      const entry = routes[matched.route.pattern]
      if (entry) {
        const handler = typeof entry === 'function' ? entry : (entry[method] || entry.ANY)
        if (typeof handler === 'function') {
          ;(request as any).params = matched.params
          return handler(request)
        }
      }
    }

    // The method did not match a real handler. Find which pattern the path
    // belongs to (probe the trie with every method) so we can dispatch the
    // synthesized OPTIONS handler (which runs the global middleware chain so
    // `cors()` can answer a preflight) or return a 405 with an `Allow` header.
    const patternMatch = this._matchAnyMethod(url.pathname)
    if (patternMatch) {
      const entry = routes[patternMatch.route.pattern]
      // OPTIONS: run the synthetic OPTIONS handler so middleware (CORS) sees it.
      if (method === 'OPTIONS' && entry && typeof entry !== 'function' && typeof entry.OPTIONS === 'function') {
        ;(request as any).params = patternMatch.params
        return entry.OPTIONS(request)
      }
      const allowed = this._allowedMethods(url.pathname)
      if (allowed.length > 0) {
        if (method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: { Allow: allowed.join(', ') } })
        }
        return new Response('{"error":"Method Not Allowed"}', {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: allowed.join(', ') },
        })
      }
    }

    // Run the synthetic fallback so global middleware (CORS, request
    // logger, etc.) still wraps the 404 response.
    const fallback = (routes as any).__fallback
    if (typeof fallback === 'function') return fallback(request)
    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  /**
   * Probe the trie with every known method to find any route that matches
   * `pathname`, regardless of HTTP method. Lets `handle()` recover the
   * matched pattern (and its params) for a 405 / OPTIONS branch.
   */
  private _matchAnyMethod(pathname: string) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const r = this.router.match(m, pathname)
      if (r) return r
    }
    return null
  }

  /**
   * List the HTTP methods registered for `pathname` by probing the trie with
   * each known method. Used to build the `Allow` header on a 405 and to
   * answer OPTIONS. Returns an empty array when the path matches no route.
   */
  private _allowedMethods(pathname: string): string[] {
    const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    const allowed = new Set<string>()
    for (const m of methods) {
      if (this.router.match(m, pathname)) allowed.add(m)
    }
    // A trie ANY route answers any method; GET implies HEAD. The framework
    // synthesizes an OPTIONS handler on every matched path, so advertise it.
    if (allowed.has('GET')) allowed.add('HEAD')
    if (allowed.size > 0) allowed.add('OPTIONS')
    return [...allowed]
  }

  async start(): Promise<void> {
    const routes = this.buildRoutes()
    this._compiledRoutes = routes
    const port = this.options.port ?? 3000
    const hostname = this.options.hostname || '0.0.0.0'

    this._routeCount = Object.keys(routes).length

    // Separate domain-specific routes from regular routes. The synthetic
    // `__fallback` is also held back from the routes map so Bun.serve
    // does not register a literal `/__fallback` path; the fetch handler
    // below invokes it manually for unmatched requests.
    const domainRoutes: { domain: string; pattern: string; handlers: Record<string, any> }[] = []
    const regularRoutes: Record<string, any> = {}
    const fallbackHandler: ((req: Request) => Response | Promise<Response>) | undefined = (routes as any).__fallback
    for (const [key, value] of Object.entries(routes)) {
      if (key === '__fallback') continue
      if (key.startsWith('__domain:') && value?.__domain) {
        domainRoutes.push({ domain: value.__domain, pattern: value.__pattern, handlers: value.handlers })
      } else {
        regularRoutes[key] = value
      }
    }

    // Merge static routes (HTML imports) with regular API routes
    const allRoutes = { ...this._staticRoutes, ...regularRoutes }

    const serveConfig: any = {
      port,
      // Bind interface. `0.0.0.0` (all interfaces) unless the app set
      // `app.hostname` / `server.configure({ hostname })` — e.g. `127.0.0.1`
      // to refuse non-local connections. Without this Bun.serve ignored the
      // configured hostname and always bound every interface.
      hostname,
      // 120 s is comfortably above typical SSE keepalive intervals (15-30 s)
      // and long-poll cycles, while still reaping stuck or slowloris-style
      // connections. Apps that hold genuinely long-lived idle connections
      // can override via `server.configure({ idleTimeout: 0 })`. The `??`
      // preserves an explicit `0` (no timeout) instead of falling through
      // to the default.
      idleTimeout: this.options.idleTimeout ?? 120,
      // Cap request bodies so an unbounded upload cannot exhaust memory.
      // Honors `bodyParser.maxSize` when set, otherwise defaults to 10 MB.
      // Bun.serve answers oversized requests with 413 before the handler runs.
      maxRequestBodySize: this.options.bodyParser?.maxSize ?? (10 * 1024 * 1024),
      development: this.options.development ?? false,
      // Only inline PUBLIC_* env vars into frontend bundles. Anything else
      // (DATABASE_URL, APP_KEY, etc.) stays server-side.
      env: "PUBLIC_*",
      // Catch-all for errors that escape a route handler (including rejected
      // Promises from the compiled path). Without this a single throwing
      // handler can surface as an unhandled rejection and, on some runtimes,
      // take the process down. Renders through the framework's exception
      // handler so debug-mode stack exposure stays consistent.
      error: async (err: any) => {
        try {
          return await this.exceptionHandler.handle(err, {} as any)
        } catch {
          return new Response('{"error":"Internal Server Error"}', { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      },
      routes: allRoutes,
      fetch: (req: Request, server: any) => {
        // WebSocket upgrade
        if (this.wsManager.hasRoutes() && req.headers.get('upgrade') === 'websocket') {
          const { upgradeHandler } = this.wsManager.build()
          return upgradeHandler(req, server) as any ?? new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
        }

        // Domain-specific route matching
        if (domainRoutes.length > 0) {
          const host = req.headers.get('host')?.split(':')[0] || ''
          for (const dr of domainRoutes) {
            const subdomains = matchDomain(dr.domain, host)
            if (subdomains === null) continue
            const url = new URL(req.url)
            const params = matchPattern(dr.pattern, url.pathname)
            if (params === null) continue
            const handler = dr.handlers.ANY || dr.handlers[req.method]
            if (handler) {
              ;(req as any).params = params
              ;(req as any).subdomains = subdomains
              return handler(req)
            }
          }
        }

        if (this._fallback) return this._fallback(req)
        if (fallbackHandler) return fallbackHandler(req)
        return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      },
    }

    const needsFetchFallback = this.wsManager.hasRoutes() || domainRoutes.length > 0 || !!this._fallback
    if (!needsFetchFallback && fallbackHandler) {
      allRoutes['/*'] = fallbackHandler
      delete serveConfig.fetch
    }

    if (this.wsManager.hasRoutes()) {
      serveConfig.websocket = this.wsManager.build().websocket
    }

    this._installGlobalHandlers()

    if ((globalThis as any).process?.versions?.bun) {
      this.server = Bun.serve(serveConfig)
      if ((globalThis as any).Bun?.gc) (globalThis as any).Bun.gc(true)
    } else {
      const { serve } = await import('@tekir/runtime')
      this.server = serve({
        port,
        hostname,
        maxRequestBodySize: serveConfig.maxRequestBodySize,
        idleTimeout: (this.options.idleTimeout ?? 120) * 1000,
        error: serveConfig.error,
        fetch: async (req: Request) => {
          return this.handle(req)
        },
      })
      await this.server.ready
    }
  }

  private _globalHandlersInstalled = false

  /**
   * Install process-level guards so a single rejected Promise or thrown error
   * in a fire-and-forget hook / WebSocket handler cannot silently crash the
   * server. Logs the error and keeps the process alive. Installed in every
   * mode (not just development), and only once per process.
   */
  private _installGlobalHandlers(): void {
    if (this._globalHandlersInstalled) return
    const proc = (globalThis as any).process
    if (!proc?.on) return
    this._globalHandlersInstalled = true
    proc.on('unhandledRejection', (reason: any) => {

      console.error('[tekir] Unhandled promise rejection:', reason)
    })
    proc.on('uncaughtException', (err: any) => {

      console.error('[tekir] Uncaught exception:', err)
    })
  }

  /**
   * Stop the server. When `graceful` is true (the default) in-flight requests
   * are allowed to drain before the socket closes, matching Bun's
   * `server.stop(true)` semantics. Pass `false` for an immediate close.
   */
  async stop(graceful = true): Promise<void> {
    if (this.server) { this.server.stop?.(graceful) }
    const hooks = this._stopHooks.splice(0)
    for (const hook of hooks.reverse()) await hook()
  }

  getServer() { return this.server }
}
