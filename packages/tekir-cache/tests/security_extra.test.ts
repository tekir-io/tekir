import { describe, test, expect, beforeEach } from "bun:test"
import { Cache } from "../src/cache"
import { MemoryCacheStore } from "../src/stores/memory"
import { DatabaseCacheStore } from "../src/stores/database"
import { RedisCacheStore } from "../src/stores/redis"
import { cache } from "../src/http-cache"

const makeCtx = (
  url: string,
  method = "GET",
  headers: Record<string, string> = {},
) => ({
  request: { url, method, headers: new Headers(headers) },
  $result: undefined as Response | undefined,
})

describe("http cache: authenticated requests do not leak across users", () => {
  let store: Cache
  beforeEach(() => {
    store = new Cache({ stores: { memory: new MemoryCacheStore() } })
  })

  test("default bypass: two users with different cookies never share a response", async () => {
    const mw = cache({ store, ttl: 60 })
    const handler = (user: string) => async () =>
      new Response(JSON.stringify({ user }), { headers: { "content-type": "application/json" } })

    const ctxA = makeCtx("http://x/api/me", "GET", { cookie: "sid=alice" })
    await mw(ctxA, async () => { ctxA.$result = await handler("alice")() })

    const ctxB = makeCtx("http://x/api/me", "GET", { cookie: "sid=bob" })
    await mw(ctxB, async () => { ctxB.$result = await handler("bob")() })

    // Bob must see his own response, never Alice's cached one.
    expect(await ctxB.$result!.text()).toBe(JSON.stringify({ user: "bob" }))
    // Credentialed responses are not marked as cache HIT/MISS — they bypass.
    expect(ctxB.$result!.headers.get("x-tekir-cache")).toBeNull()
  })

  test("authorization header request bypasses the cache", async () => {
    const mw = cache({ store, ttl: 60 })
    let calls = 0
    const handler = async () => { calls++; return new Response(String(calls)) }

    const c1 = makeCtx("http://x/api/secret", "GET", { authorization: "Bearer t" })
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx("http://x/api/secret", "GET", { authorization: "Bearer t" })
    await mw(c2, async () => { c2.$result = await handler() })

    // Both requests hit the handler: nothing was cached.
    expect(calls).toBe(2)
  })

  test("anonymous requests are still cached", async () => {
    const mw = cache({ store, ttl: 60 })
    let calls = 0
    const handler = async () => { calls++; return new Response(String(calls)) }

    const c1 = makeCtx("http://x/api/public")
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx("http://x/api/public")
    await mw(c2, async () => { c2.$result = await handler() })
    expect(calls).toBe(1)
    expect(c2.$result!.headers.get("x-tekir-cache")).toBe("HIT")
  })

  test("authenticated:'vary' gives each identity its own entry", async () => {
    const mw = cache({ store, ttl: 60, authenticated: "vary" })
    const handler = (user: string) => async () => new Response(user)

    const a = makeCtx("http://x/api/me", "GET", { cookie: "sid=alice" })
    await mw(a, async () => { a.$result = await handler("alice")() })
    const b = makeCtx("http://x/api/me", "GET", { cookie: "sid=bob" })
    await mw(b, async () => { b.$result = await handler("bob")() })
    // Different cookie → different key → different cached value.
    expect(await b.$result!.text()).toBe("bob")

    // Same cookie repeated → served from cache.
    const a2 = makeCtx("http://x/api/me", "GET", { cookie: "sid=alice" })
    await mw(a2, async () => { a2.$result = await handler("ALICE-MISS")() })
    expect(await a2.$result!.text()).toBe("alice")
    expect(a2.$result!.headers.get("x-tekir-cache")).toBe("HIT")
  })

  test("custom key builder is always honoured for credentialed requests", async () => {
    const mw = cache({ store, ttl: 60, key: (ctx) => `${ctx.request.headers.get("cookie")}|${ctx.request.url}` })
    const handler = (u: string) => async () => new Response(u)
    const a = makeCtx("http://x/api/me", "GET", { cookie: "sid=alice" })
    await mw(a, async () => { a.$result = await handler("alice")() })
    const a2 = makeCtx("http://x/api/me", "GET", { cookie: "sid=alice" })
    await mw(a2, async () => { a2.$result = await handler("miss")() })
    // Custom key includes identity, so it is cached and served.
    expect(await a2.$result!.text()).toBe("alice")
  })
})

describe("Cache.getOrSet stampede protection", () => {
  test("concurrent misses share a single factory call", async () => {
    const c = new Cache({ stores: { memory: new MemoryCacheStore() } })
    let calls = 0
    const factory = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return calls }
    const results = await Promise.all([
      c.getOrSet("k", 60, factory),
      c.getOrSet("k", 60, factory),
      c.getOrSet("k", 60, factory),
    ])
    expect(calls).toBe(1)
    expect(results).toEqual([1, 1, 1])
  })
})

describe("Cache.pull with cached null", () => {
  test("evicts an explicitly stored null value", async () => {
    const c = new Cache({ stores: { memory: new MemoryCacheStore() } })
    await c.set("k", null, 60)
    expect(await c.has("k")).toBe(true)
    const v = await c.pull("k")
    expect(v).toBeNull()
    expect(await c.has("k")).toBe(false)
  })
})

describe("RedisCacheStore atomic set + scoped flush", () => {
  function fakeClient() {
    const store = new Map<string, string>()
    const sent: any[][] = []
    return {
      store, sent,
      async get(k: string) { return store.has(k) ? store.get(k)! : null },
      async set(k: string, v: string) { store.set(k, v) },
      async expire() {},
      async exists(k: string) { return store.has(k) ? 1 : 0 },
      async del(k: string) { store.delete(k) },
      async send(cmd: string, args: any[] = []) {
        sent.push([cmd, ...args])
        const c = cmd.toUpperCase()
        if (c === "SET") { store.set(args[0], args[1]); return "OK" }
        if (c === "DEL") { for (const k of args) store.delete(k); return args.length }
        if (c === "SCAN") {
          const pattern = args[args.indexOf("MATCH") + 1]
          const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
          return ["0", [...store.keys()].filter(k => re.test(k))]
        }
        return null
      },
    }
  }

  test("set with TTL issues a single SET ... EX", async () => {
    const client = fakeClient()
    const s = new RedisCacheStore(client as any, "app:cache:")
    await s.set("user:1", { name: "Alice" }, 300)
    const setCmd = client.sent.find(c => c[0] === "SET")
    expect(setCmd).toEqual(["SET", "app:cache:user:1", JSON.stringify({ name: "Alice" }), "EX", "300"])
  })

  test("flush only deletes prefixed keys", async () => {
    const client = fakeClient()
    client.store.set("app:cache:a", "1")
    client.store.set("app:cache:b", "2")
    client.store.set("session:x", "3")
    const s = new RedisCacheStore(client as any, "app:cache:")
    await s.flush()
    expect(client.store.has("app:cache:a")).toBe(false)
    expect(client.store.has("app:cache:b")).toBe(false)
    expect(client.store.has("session:x")).toBe(true)
  })

  test("flush refuses an empty prefix", async () => {
    const client = fakeClient()
    const s = new RedisCacheStore(client as any, "")
    await expect(s.flush()).rejects.toThrow("empty prefix")
  })
})

describe("DatabaseCacheStore ensureTable surfaces errors", () => {
  test("rethrows create-table failure instead of swallowing", async () => {
    const db = {
      exec: async () => { throw new Error("permission denied") },
      queryOne: async () => null,
      run: async () => {},
    }
    const s = new DatabaseCacheStore(db, "cache")
    await expect(s.get("k")).rejects.toThrow("permission denied")
  })
})

describe("MemoryCacheStore eviction", () => {
  test("enforces maxEntries cap", async () => {
    const s = new MemoryCacheStore({ maxEntries: 3 })
    for (let i = 0; i < 10; i++) await s.set(`k${i}`, i)
    let count = 0
    for (let i = 0; i < 10; i++) if (await s.has(`k${i}`)) count++
    expect(count).toBeLessThanOrEqual(3)
  })

  test("prune removes expired entries", async () => {
    const s = new MemoryCacheStore()
    await s.set("a", 1, 1)
    // Force expiry by manipulating time via a tiny wait beyond ttl.
    await new Promise(r => setTimeout(r, 1100))
    s.prune()
    expect(await s.has("a")).toBe(false)
  })
})
