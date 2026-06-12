import { describe, test, expect } from "bun:test"
import { Controller } from "../src/controller"
import { Get } from "../src/route"
import { Cache } from "../src/cache"
import { Cache as CacheManager, MemoryCacheStore } from "@tekir/cache"

// Decorated controller classes stamp method-level middleware lists onto
// their prototype under the `__middlewares` key. The type alias here
// surfaces that convention to TypeScript so tests can read the map
// without an `any` cast.
type WithMiddlewares = { __middlewares?: Record<string, any[]> }

describe("@Cache decorator", () => {
  test("attaches the cache middleware to the method", () => {
    const store = new CacheManager({ stores: { memory: new MemoryCacheStore() } })

    @Controller("/api/posts")
    class PostsController {
      @Cache({ store, ttl: 60 })
      @Get("/")
      list() {}
    }

    new PostsController()
    const map: Record<string, any[]> =
      (PostsController.prototype as WithMiddlewares).__middlewares ?? {}
    expect(Array.isArray(map["list"])).toBe(true)
    expect(map["list"].length).toBe(1)
    expect(typeof map["list"][0]).toBe("function")
  })

  test("composes with other middlewares (still works)", () => {
    const store = new CacheManager({ stores: { memory: new MemoryCacheStore() } })
    const noop = async (_c: any, n: any) => n()

    @Controller("/api/posts")
    class C {
      @Cache({ store, ttl: 30 })
      @Get("/")
      list() {}

      @Get("/uncached")
      detail() {}
    }
    new C()

    const map: Record<string, any[]> = (C.prototype as WithMiddlewares).__middlewares ?? {}
    expect(map["list"]?.length).toBe(1)
    expect(map["detail"]).toBeUndefined()
    void noop
  })

  test("middleware actually caches when invoked", async () => {
    const store = new CacheManager({ stores: { memory: new MemoryCacheStore() } })

    @Controller("/api/items")
    class ItemsController {
      @Cache({ store, ttl: 60 })
      @Get("/")
      list() {}
    }
    new ItemsController()

    const mw = (ItemsController.prototype as any).__middlewares.list[0]

    let calls = 0
    const handler = async () => {
      calls++
      return new Response(`call ${calls}`)
    }

    const ctx1: any = {
      request: { url: "http://x/api/items", method: "GET", headers: new Headers() },
    }
    await mw(ctx1, async () => { ctx1.$result = await handler() })

    const ctx2: any = {
      request: { url: "http://x/api/items", method: "GET", headers: new Headers() },
    }
    await mw(ctx2, async () => { ctx2.$result = await handler() })

    expect(calls).toBe(1) // second call hit cache
    expect(await ctx2.$result.text()).toBe("call 1")
  })
})
