import { describe, test, expect, beforeEach } from "bun:test"
import { Cache } from "../src/cache"
import { MemoryCacheStore } from "../src/stores/memory"
import { cache } from "../src/http-cache"

const makeCtx = (
  url: string,
  method = "GET",
  headers: Record<string, string> = {},
) => ({
  request: {
    url,
    method,
    headers: new Headers(headers),
  },
  $result: undefined as Response | undefined,
})

describe("cache() middleware", () => {
  let store: Cache
  beforeEach(() => {
    store = new Cache({ stores: { memory: new MemoryCacheStore() } })
  })

  test("misses then hits", async () => {
    const mw = cache({ store, ttl: 60 })

    let calls = 0
    const handler = async () => {
      calls++
      return new Response(JSON.stringify({ n: calls }), {
        headers: { "content-type": "application/json" },
      })
    }

    // First request: miss → handler runs, response stored
    const ctx1 = makeCtx("http://x/api/posts")
    await mw(ctx1, async () => {
      ctx1.$result = await handler()
    })
    expect(calls).toBe(1)
    expect(ctx1.$result?.headers.get("x-tekir-cache")).toBe("MISS")
    expect(await ctx1.$result?.text()).toBe('{"n":1}')

    // Second request: hit → handler skipped
    const ctx2 = makeCtx("http://x/api/posts")
    await mw(ctx2, async () => {
      ctx2.$result = await handler()
    })
    expect(calls).toBe(1) // not called again
    expect(ctx2.$result?.headers.get("x-tekir-cache")).toBe("HIT")
    expect(await ctx2.$result?.text()).toBe('{"n":1}')
  })

  test("304 on If-None-Match match", async () => {
    const mw = cache({ store, ttl: 60 })
    const handler = async () =>
      new Response("hello", { headers: { "content-type": "text/plain" } })

    const ctx1 = makeCtx("http://x/api/x")
    await mw(ctx1, async () => {
      ctx1.$result = await handler()
    })
    const etag = ctx1.$result!.headers.get("etag")!
    expect(etag).toMatch(/^W\/"[0-9a-f]+"$/)

    const ctx2 = makeCtx("http://x/api/x", "GET", { "if-none-match": etag })
    await mw(ctx2, async () => {
      ctx2.$result = await handler()
    })
    expect(ctx2.$result?.status).toBe(304)
    expect(ctx2.$result?.headers.get("x-tekir-cache")).toBe("REVALIDATED")
  })

  test("only caches safe methods", async () => {
    const mw = cache({ store, ttl: 60 })
    let calls = 0
    const handler = async () => {
      calls++
      return new Response("ok")
    }

    const ctx1 = makeCtx("http://x/api/y", "POST")
    await mw(ctx1, async () => { ctx1.$result = await handler() })
    const ctx2 = makeCtx("http://x/api/y", "POST")
    await mw(ctx2, async () => { ctx2.$result = await handler() })

    expect(calls).toBe(2) // POST not cached
    expect(ctx1.$result?.headers.get("x-tekir-cache")).toBeNull()
  })

  test("respects request Cache-Control: no-store", async () => {
    const mw = cache({ store, ttl: 60 })
    let calls = 0
    const handler = async () => {
      calls++
      return new Response("ok")
    }

    const ctx1 = makeCtx("http://x/api/z", "GET", { "cache-control": "no-store" })
    await mw(ctx1, async () => { ctx1.$result = await handler() })
    const ctx2 = makeCtx("http://x/api/z", "GET", { "cache-control": "no-store" })
    await mw(ctx2, async () => { ctx2.$result = await handler() })

    expect(calls).toBe(2)
  })

  test("vary header isolates entries", async () => {
    const mw = cache({ store, ttl: 60, vary: ["accept-language"] })
    let n = 0
    const handler = async () => new Response(`call ${++n}`)

    const enCtx = makeCtx("http://x/api/v", "GET", { "accept-language": "en" })
    await mw(enCtx, async () => { enCtx.$result = await handler() })
    expect(await enCtx.$result?.text()).toBe("call 1")

    const trCtx = makeCtx("http://x/api/v", "GET", { "accept-language": "tr" })
    await mw(trCtx, async () => { trCtx.$result = await handler() })
    expect(await trCtx.$result?.text()).toBe("call 2")

    // Repeat en → cached
    const enCtx2 = makeCtx("http://x/api/v", "GET", { "accept-language": "en" })
    await mw(enCtx2, async () => { enCtx2.$result = await handler() })
    expect(await enCtx2.$result?.text()).toBe("call 1")
  })

  test("custom key function", async () => {
    const mw = cache({
      store,
      ttl: 60,
      key: (ctx) => `posts:${(ctx as any).params?.id ?? "?"}`,
    })
    let n = 0
    const handler = async () => new Response(`hit ${++n}`)

    const c1: any = makeCtx("http://x/api/posts/1")
    c1.params = { id: "1" }
    await mw(c1, async () => { c1.$result = await handler() })

    const c2: any = makeCtx("http://x/api/posts/1") // different URL doesn't matter, key is custom
    c2.params = { id: "1" }
    await mw(c2, async () => { c2.$result = await handler() })

    expect(await c1.$result.text()).toBe("hit 1")
    expect(await c2.$result.text()).toBe("hit 1") // cached
  })

  test("skip predicate bypasses cache", async () => {
    const mw = cache({ store, ttl: 60, skip: (ctx: any) => ctx.skipMe === true })
    let n = 0
    const handler = async () => new Response(`v${++n}`)

    const c1: any = makeCtx("http://x/api/s")
    c1.skipMe = true
    await mw(c1, async () => { c1.$result = await handler() })
    const c2: any = makeCtx("http://x/api/s")
    c2.skipMe = true
    await mw(c2, async () => { c2.$result = await handler() })

    expect(await c1.$result.text()).toBe("v1")
    expect(await c2.$result.text()).toBe("v2") // skip → no cache
  })

  test("does not cache 5xx or 204 responses", async () => {
    const mw = cache({ store, ttl: 60 })
    let n = 0
    const handler = async () => {
      n++
      return n === 1 ? new Response("err", { status: 500 }) : new Response("ok")
    }
    const c1 = makeCtx("http://x/api/e")
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx("http://x/api/e")
    await mw(c2, async () => { c2.$result = await handler() })
    expect(await c2.$result?.text()).toBe("ok") // 500 wasn't cached
    expect(c2.$result?.headers.get("x-tekir-cache")).toBe("MISS")
  })
})
