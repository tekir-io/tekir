import { test, expect, describe } from 'bun:test'
import { TekirServer } from '../../tekir-core/src/server/server'
import { bodyParser } from '../src/middleware'


function createRequest(body: string, contentType: string, method = 'POST', url = 'http://localhost/test'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': contentType },
    body,
  })
}

function createCtx(request: Request) {
  const ctx: any = {
    request,
    body: undefined,
    rawBody: undefined,
    response: {
      _status: 200,
      status(code: number) { ctx.response._status = code; return ctx.response },
    },
  }
  return ctx
}

async function run(config: any, request: Request) {
  const ctx = createCtx(request)
  const mw = bodyParser(config)
  let nextCalled = false
  await mw(ctx, async () => { nextCalled = true })
  return { ctx, nextCalled }
}


describe('JSON parser', () => {
  test('parses valid JSON body', async () => {
    const req = createRequest('{"name":"Ali","age":25}', 'application/json')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ name: 'Ali', age: 25 })
  })

  test('parses application/vnd.api+json', async () => {
    const req = createRequest('{"data":"test"}', 'application/vnd.api+json')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ data: 'test' })
  })

  test('parses application/json-patch+json', async () => {
    const req = createRequest('[{"op":"add","path":"/name","value":"Ali"}]', 'application/json-patch+json')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual([{ op: 'add', path: '/name', value: 'Ali' }])
  })

  test('returns 400 for invalid JSON', async () => {
    const req = createRequest('{invalid', 'application/json')
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.response._status).toBe(400)
    expect(ctx.body.error).toBe('Invalid JSON')
    expect(nextCalled).toBe(false)
  })

  test('strict mode rejects primitive at root', async () => {
    const req = createRequest('"just a string"', 'application/json')
    const { ctx, nextCalled } = await run({ json: { strict: true } }, req)
    expect(ctx.response._status).toBe(422)
    expect(nextCalled).toBe(false)
  })

  test('strict mode accepts objects and arrays', async () => {
    const req = createRequest('{"ok":true}', 'application/json')
    const { ctx, nextCalled } = await run({ json: { strict: true } }, req)
    expect(ctx.body).toEqual({ ok: true })
    expect(nextCalled).toBe(true)
  })

  test('strict mode disabled accepts primitives', async () => {
    const req = createRequest('42', 'application/json')
    const { ctx, nextCalled } = await run({ json: { strict: false } }, req)
    expect(ctx.body).toBe(42)
    expect(nextCalled).toBe(true)
  })

  test('returns 413 when body exceeds limit', async () => {
    const bigBody = JSON.stringify({ data: 'x'.repeat(2000) })
    const req = createRequest(bigBody, 'application/json')
    const { ctx, nextCalled } = await run({ json: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
    expect(nextCalled).toBe(false)
  })

  test('body within limit passes', async () => {
    const req = createRequest('{"ok":true}', 'application/json')
    const { ctx, nextCalled } = await run({ json: { limit: '1mb' } }, req)
    expect(ctx.body).toEqual({ ok: true })
    expect(nextCalled).toBe(true)
  })

  test('convertEmptyStringsToNull on JSON', async () => {
    const req = createRequest('{"name":"Ali","bio":""}', 'application/json')
    const { ctx } = await run({ json: { convertEmptyStringsToNull: true } }, req)
    expect(ctx.body.name).toBe('Ali')
    expect(ctx.body.bio).toBeNull()
  })

  test('trimWhitespace on JSON', async () => {
    const req = createRequest('{"name":"  Ali  ","email":" a@b.com "}', 'application/json')
    const { ctx } = await run({ json: { trimWhitespace: true } }, req)
    expect(ctx.body.name).toBe('Ali')
    expect(ctx.body.email).toBe('a@b.com')
  })

  test('global convertEmptyStringsToNull applies to JSON', async () => {
    const req = createRequest('{"x":"","y":"val"}', 'application/json')
    const { ctx } = await run({ convertEmptyStringsToNull: true }, req)
    expect(ctx.body.x).toBeNull()
    expect(ctx.body.y).toBe('val')
  })

  test('global trimWhitespace applies to JSON', async () => {
    const req = createRequest('{"x":" hello "}', 'application/json')
    const { ctx } = await run({ trimWhitespace: true }, req)
    expect(ctx.body.x).toBe('hello')
  })

  test('nested object transform', async () => {
    const req = createRequest('{"user":{"name":" Ali ","bio":""}}', 'application/json')
    const { ctx } = await run({ convertEmptyStringsToNull: true, trimWhitespace: true }, req)
    expect(ctx.body.user.name).toBe('Ali')
    expect(ctx.body.user.bio).toBeNull()
  })

  test('array value transform', async () => {
    const req = createRequest('{"tags":["  a  ","","b"]}', 'application/json')
    const { ctx } = await run({ convertEmptyStringsToNull: true, trimWhitespace: true }, req)
    expect(ctx.body.tags).toEqual(['a', null, 'b'])
  })

  test('empty body returns empty object', async () => {
    const req = createRequest('', 'application/json')
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.body).toEqual({})
    expect(nextCalled).toBe(true)
  })

  test('custom content types via json.types', async () => {
    const req = createRequest('{"custom":true}', 'application/custom+json')
    const { ctx } = await run({ json: { types: ['application/custom+json'] } }, req)
    expect(ctx.body).toEqual({ custom: true })
  })
})


describe('Form parser', () => {
  test('parses simple form data', async () => {
    const req = createRequest('name=Ali&age=25', 'application/x-www-form-urlencoded')
    const { ctx } = await run({}, req)
    expect(ctx.body.name).toBe('Ali')
    expect(ctx.body.age).toBe('25')
  })

  test('parses nested bracket notation', async () => {
    const req = createRequest('user[name]=Ali&user[email]=ali@test.com', 'application/x-www-form-urlencoded')
    const { ctx } = await run({}, req)
    expect(ctx.body.user.name).toBe('Ali')
    expect(ctx.body.user.email).toBe('ali@test.com')
  })

  test('parses duplicate keys as array', async () => {
    const req = createRequest('tag=a&tag=b&tag=c', 'application/x-www-form-urlencoded')
    const { ctx } = await run({}, req)
    expect(ctx.body.tag).toEqual(['a', 'b', 'c'])
  })

  test('decodes URL-encoded values', async () => {
    const req = createRequest('name=Ali+Veli&msg=hello%20world', 'application/x-www-form-urlencoded')
    const { ctx } = await run({}, req)
    expect(ctx.body.name).toBe('Ali Veli')
    expect(ctx.body.msg).toBe('hello world')
  })

  test('returns 413 when body exceeds limit', async () => {
    const bigBody = 'data=' + 'x'.repeat(2000)
    const req = createRequest(bigBody, 'application/x-www-form-urlencoded')
    const { ctx, nextCalled } = await run({ form: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
    expect(nextCalled).toBe(false)
  })

  test('convertEmptyStringsToNull on form', async () => {
    const req = createRequest('name=Ali&bio=', 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { convertEmptyStringsToNull: true } }, req)
    expect(ctx.body.name).toBe('Ali')
    expect(ctx.body.bio).toBeNull()
  })

  test('trimWhitespace on form', async () => {
    // URL encode spaces as +
    const req = createRequest('name=+Ali+', 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { trimWhitespace: true } }, req)
    expect(ctx.body.name).toBe('Ali')
  })

  test('respects depth limit', async () => {
    const req = createRequest('a[b][c][d][e][f]=deep', 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { queryString: { depth: 2 } } }, req)
    // Should only go 3 levels deep (depth+1 keys)
    expect(ctx.body.a.b.c).toBeDefined()
  })

  test('respects parameterLimit', async () => {
    const params = Array.from({ length: 10 }, (_, i) => `k${i}=v${i}`).join('&')
    const req = createRequest(params, 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { queryString: { parameterLimit: 5 } } }, req)
    expect(Object.keys(ctx.body).length).toBe(5)
  })

  test('allowDots parses dot notation', async () => {
    const req = createRequest('user.name=Ali&user.age=25', 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { queryString: { allowDots: true } } }, req)
    expect(ctx.body.user.name).toBe('Ali')
    expect(ctx.body.user.age).toBe('25')
  })

  test('empty body returns empty object', async () => {
    const req = createRequest('', 'application/x-www-form-urlencoded')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({})
  })
})


describe('Raw parser', () => {
  test('captures raw body for configured types', async () => {
    const xml = '<root><name>Ali</name></root>'
    const req = createRequest(xml, 'application/xml')
    const { ctx, nextCalled } = await run({ raw: { types: ['application/xml'] } }, req)
    expect(ctx.rawBody).toBe(xml)
    expect(nextCalled).toBe(true)
  })

  test('captures text/xml', async () => {
    const xml = '<data>test</data>'
    const req = createRequest(xml, 'text/xml')
    const { ctx } = await run({ raw: { types: ['text/xml'] } }, req)
    expect(ctx.rawBody).toBe(xml)
  })

  test('returns 413 when raw body exceeds limit', async () => {
    const big = 'x'.repeat(2000)
    const req = createRequest(big, 'application/xml')
    const { ctx, nextCalled } = await run({ raw: { types: ['application/xml'], limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
    expect(nextCalled).toBe(false)
  })

  test('does not parse when no raw types configured', async () => {
    const req = createRequest('<xml/>', 'application/xml')
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.rawBody).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('does not parse non-matching content type', async () => {
    const req = createRequest('data', 'text/plain')
    const { ctx } = await run({ raw: { types: ['application/xml'] } }, req)
    expect(ctx.rawBody).toBeUndefined()
  })
})


describe('allowedMethods', () => {
  test('skips GET requests by default', async () => {
    const req = new Request('http://localhost/test', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    })
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('skips HEAD requests by default', async () => {
    const req = new Request('http://localhost/test', {
      method: 'HEAD',
      headers: { 'content-type': 'application/json' },
    })
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('parses POST by default', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'POST')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ ok: true })
  })

  test('parses PUT by default', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'PUT')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ ok: true })
  })

  test('parses PATCH by default', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'PATCH')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ ok: true })
  })

  test('parses DELETE by default', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'DELETE')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ ok: true })
  })

  test('custom allowedMethods restricts parsing', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'PUT')
    const { ctx, nextCalled } = await run({ allowedMethods: ['POST'] }, req)
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('custom allowedMethods allows specified methods', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'POST')
    const { ctx } = await run({ allowedMethods: ['POST'] }, req)
    expect(ctx.body).toEqual({ ok: true })
  })
})


describe('method spoofing (opt-in via methodSpoofing: true)', () => {
  test('_method=PUT spoofs POST to PUT', async () => {
    const req = createRequest('{"title":"updated"}', 'application/json', 'POST', 'http://localhost/posts/1?_method=PUT')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.body).toEqual({ title: 'updated' })
    expect(ctx.request._method).toBe('PUT')
  })

  test('_method=DELETE spoofs POST to DELETE', async () => {
    const req = createRequest('{}', 'application/json', 'POST', 'http://localhost/posts/1?_method=DELETE')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.request._method).toBe('DELETE')
  })

  test('_method=PATCH spoofs POST to PATCH', async () => {
    const req = createRequest('{"x":1}', 'application/json', 'POST', 'http://localhost/test?_method=PATCH')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.request._method).toBe('PATCH')
  })

  test('_method=GET is ignored (not spoofable)', async () => {
    const req = createRequest('{"x":1}', 'application/json', 'POST', 'http://localhost/test?_method=GET')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.request._method).toBeUndefined()
    expect(ctx.body).toEqual({ x: 1 })
  })

  test('_method is case insensitive', async () => {
    const req = createRequest('{}', 'application/json', 'POST', 'http://localhost/test?_method=put')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.request._method).toBe('PUT')
  })

  test('disabled by default: _method is ignored without opt-in', async () => {
    const req = createRequest('{"x":1}', 'application/json', 'POST', 'http://localhost/test?_method=DELETE')
    const { ctx } = await run({}, req)
    expect(ctx.request._method).toBeUndefined()
    expect(ctx.body).toEqual({ x: 1 })
  })

  test('no _method param works normally', async () => {
    const req = createRequest('{"ok":true}', 'application/json', 'POST', 'http://localhost/test')
    const { ctx } = await run({ methodSpoofing: true }, req)
    expect(ctx.body).toEqual({ ok: true })
    expect(ctx.request._method).toBeUndefined()
  })
})


describe('autoProcess / processManually', () => {
  test('autoProcess=false skips multipart parsing', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    const req = new Request('http://localhost/upload', { method: 'POST', body: form })
    const { ctx } = await run({ multipart: { autoProcess: false } }, req)
    expect(ctx.body).toBeUndefined()
    // File accessors are always installed (no-op when the multipart body
    // wasn't processed) so handlers can call them without an
    // optional-chain or content-type check.
    expect(typeof ctx.files).toBe('function')
    expect(ctx.files('anything')).toEqual([])
    expect(ctx.allFiles()).toEqual([])
    expect(ctx.file('anything')).toBeUndefined()
  })

  test('autoProcess=true processes all multipart', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    const req = new Request('http://localhost/upload', { method: 'POST', body: form })
    const { ctx } = await run({ multipart: { autoProcess: true } }, req)
    expect(ctx.body.name).toBe('Ali')
  })

  test('autoProcess array skips non-matching routes', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    const req = new Request('http://localhost/other', { method: 'POST', body: form })
    const ctx: any = {
      request: req,
      path: '/other',
      body: undefined,
      files: undefined,
      response: { _status: 200, status(c: number) { this._status = c } },
    }
    const mw = bodyParser({ multipart: { autoProcess: ['/uploads'] } })
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('processManually skips matching routes', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    const req = new Request('http://localhost/file-manager', { method: 'POST', body: form })
    const ctx: any = {
      request: req,
      path: '/file-manager',
      body: undefined,
      files: undefined,
      response: { _status: 200, status(c: number) { this._status = c } },
    }
    const mw = bodyParser({ multipart: { autoProcess: true, processManually: ['/file-manager'] } })
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })
})


describe('Multipart transforms', () => {
  test('convertEmptyStringsToNull on multipart fields', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    form.append('bio', '')
    const req = new Request('http://localhost/test', { method: 'POST', body: form })
    const { ctx } = await run({ convertEmptyStringsToNull: true }, req)
    expect(ctx.body.name).toBe('Ali')
    expect(ctx.body.bio).toBeNull()
  })

  test('trimWhitespace on multipart fields', async () => {
    const form = new FormData()
    form.append('name', '  Ali  ')
    const req = new Request('http://localhost/test', { method: 'POST', body: form })
    const { ctx } = await run({ trimWhitespace: true }, req)
    expect(ctx.body.name).toBe('Ali')
  })

  test('multipart file upload still works', async () => {
    const form = new FormData()
    form.append('name', 'Ali')
    form.append('avatar', new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' }))
    const req = new Request('http://localhost/test', { method: 'POST', body: form })
    const { ctx } = await run({}, req)
    expect(ctx.body.name).toBe('Ali')
    expect(typeof ctx.files).toBe('function')
    const file = ctx.file('avatar')
    expect(file).toBeDefined()
    expect(file.clientName).toBe('photo.jpg')
    expect(file.extname).toBe('jpg')
    // `ctx.files(name)` is a method now (returns `UploadedFile[]`),
    // not the underlying `MultipartFiles` collection.
    const all = ctx.files('avatar')
    expect(Array.isArray(all)).toBe(true)
    expect(all.length).toBe(1)
    expect(all[0].clientName).toBe('photo.jpg')
  })

  test('multipart total limit aborts early with 413', async () => {
    // The streaming parser now enforces the total limit mid-stream and aborts
    // with 413 instead of buffering the whole body and surfacing a soft
    // per-file `totalSize` error.
    const form = new FormData()
    const bigFile = new File(['x'.repeat(5000)], 'big.txt', { type: 'text/plain' })
    form.append('file', bigFile)
    const req = new Request('http://localhost/test', { method: 'POST', body: form })
    const { ctx } = await run({ multipart: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
    expect(ctx.body).toEqual({ error: 'Payload Too Large' })
  })
})


describe('Edge cases', () => {
  test('unknown content type passes through', async () => {
    const req = createRequest('random data', 'text/plain')
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('no content-type header passes through', async () => {
    const req = new Request('http://localhost/test', { method: 'POST' })
    const { ctx, nextCalled } = await run({}, req)
    expect(ctx.body).toBeUndefined()
    expect(nextCalled).toBe(true)
  })

  test('per-parser config overrides global', async () => {
    const req = createRequest('{"x":""}', 'application/json')
    // Global off, json-specific on
    const { ctx } = await run({ convertEmptyStringsToNull: false, json: { convertEmptyStringsToNull: true } }, req)
    expect(ctx.body.x).toBeNull()
  })

  test('per-parser config overrides global (inverse)', async () => {
    const req = createRequest('{"x":""}', 'application/json')
    // Global on, json-specific off
    const { ctx } = await run({ convertEmptyStringsToNull: true, json: { convertEmptyStringsToNull: false } }, req)
    expect(ctx.body.x).toBe('')
  })
})

describe('core integration', () => {
  test('core delegates multipart parsing to the configured body parser', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    router.useGlobal(bodyParser({ multipart: { maxParts: 2 } }))
    router.post('/upload', ({ body, request }: any) => ({
      body,
      title: request.input('title'),
    }))

    const form = new FormData()
    form.append('title', 'test')
    form.append('avatar', new File(['file'], 'avatar.txt'))
    const response = await server.handle(new Request('http://localhost/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      body: { title: 'test' },
      title: 'test',
    })
  })

  test('core does not consume multipart data before maxParts rejects it', async () => {
    const server = new TekirServer()
    const router = server.getRouter()
    router.useGlobal(bodyParser({
      multipart: {
        maxParts: 2,
        maxFields: 10,
        maxFiles: 10,
      },
    }))
    router.post('/upload', ({ body }: any) => body)

    const form = new FormData()
    form.append('a', '1')
    form.append('b', '2')
    form.append('c', '3')
    const response = await server.handle(new Request('http://localhost/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(413)
  })
})
