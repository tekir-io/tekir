import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Cache } from "../src/cache"
import { MemoryCacheStore } from "../src/stores/memory"
import {
  cache,
  setDefaultCacheStore,
  getDefaultCacheStore,
} from "../src/http-cache"

const makeCtx = (url = "http://x/api/y", method = "GET") => ({
  request: { url, method, headers: new Headers() },
  $result: undefined as Response | undefined,
})

describe("default store wiring", () => {
  // Earlier test files in the suite (e.g. provider.test) call
  // `CacheProvider.register()` which sets the module-level default store
  // and never cleans up. Reset before AND after each test here so this
  // file's no-store assertions don't see leaked state from elsewhere.
  beforeEach(() => setDefaultCacheStore(null))
  afterEach(() => setDefaultCacheStore(null))

  test("middleware no-ops when no store is configured", async () => {
    const mw = cache({ ttl: 60 })
    let calls = 0
    const handler = async () => {
      calls++
      return new Response("ok")
    }

    const c1 = makeCtx()
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx()
    await mw(c2, async () => { c2.$result = await handler() })

    expect(calls).toBe(2) // no caching happened
    expect(c1.$result?.headers.get("x-tekir-cache")).toBeNull()
  })

  test("setDefaultCacheStore wires the global default", async () => {
    const store = new Cache({ stores: { memory: new MemoryCacheStore() } })
    setDefaultCacheStore(store)
    expect(getDefaultCacheStore()).toBe(store)

    const mw = cache({ ttl: 60 }) // no store option → uses default
    let calls = 0
    const handler = async () => {
      calls++
      return new Response("ok")
    }

    const c1 = makeCtx()
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx()
    await mw(c2, async () => { c2.$result = await handler() })

    expect(calls).toBe(1)
    expect(c1.$result?.headers.get("x-tekir-cache")).toBe("MISS")
    expect(c2.$result?.headers.get("x-tekir-cache")).toBe("HIT")
  })

  test("explicit store option overrides the default", async () => {
    const defaultStore = new Cache({ stores: { memory: new MemoryCacheStore() } })
    const explicitStore = new Cache({ stores: { memory: new MemoryCacheStore() } })
    setDefaultCacheStore(defaultStore)

    const mw = cache({ store: explicitStore, ttl: 60 })
    let calls = 0
    const handler = async () => {
      calls++
      return new Response(`v${calls}`)
    }

    const c1 = makeCtx()
    await mw(c1, async () => { c1.$result = await handler() })
    const c2 = makeCtx()
    await mw(c2, async () => { c2.$result = await handler() })
    expect(calls).toBe(1)

    // Default store should NOT have anything cached for this URL — confirming
    // the explicit store was the one consulted.
    const fromDefault = await defaultStore.get("http:GET|http://x/api/y")
    expect(fromDefault).toBeNull()
  })
})
