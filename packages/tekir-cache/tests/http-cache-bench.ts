/**
 * HTTP cache middleware bench: simulate a typical "list 20 posts" endpoint
 * with and without the cache middleware. The "DB" path here is a tight
 * sleep + JSON.stringify on a representative object — much faster than a
 * real DB hit. Real-world wins are even bigger.
 */
import { Cache } from "../src/cache"
import { MemoryCacheStore } from "../src/stores/memory"
import { cache } from "../src/http-cache"

const store = new Cache({ stores: { memory: new MemoryCacheStore() } })

const data = {
  posts: Array.from({ length: 20 }, (_, i) => ({
    id: i,
    title: `Post #${i}`,
    body: "Lorem ipsum dolor sit amet, ".repeat(10),
    user_id: 1 + (i % 5),
    status: "published",
    createdAt: "2026-04-29T10:00:00Z",
  })),
}

async function fakeDbHandler() {
  // Synthetic work: simulate query parse, row marshalling, JSON serialize.
  // This is conservative — a real Postgres roundtrip is 0.5-5 ms minimum.
  for (let i = 0; i < 50; i++) JSON.parse(JSON.stringify(data.posts[i % 20]))
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  })
}

const mw = cache({ store, ttl: 60 })

const makeCtx = () => ({
  request: { url: "http://x/api/posts", method: "GET", headers: new Headers() },
  $result: undefined as Response | undefined,
})

// Warm the cache once
const seed = makeCtx()
await mw(seed, async () => { seed.$result = await fakeDbHandler() })

function bench(name: string, fn: () => Promise<void>, iters: number) {
  return (async () => {
    for (let i = 0; i < 200; i++) await fn() // warmup
    const t0 = Bun.nanoseconds()
    for (let i = 0; i < iters; i++) await fn()
    const dt = Bun.nanoseconds() - t0
    const ops = Math.round((iters / dt) * 1e9)
    const ns = (dt / iters).toFixed(0)
    console.log(
      `  ${name.padEnd(30)} ${ops.toLocaleString().padStart(10)} ops/s  ${ns.padStart(8)} ns/op`,
    )
    return ops
  })()
}

const ITERS = 20_000

console.log("Endpoint: GET /api/posts (returns 20 posts, ~5KB)\n")

const noCache = await bench(
  "no cache (handler every time)",
  async () => {
    await fakeDbHandler()
  },
  ITERS,
)

const withCache = await bench(
  "with cache (HIT path)",
  async () => {
    const c = makeCtx()
    await mw(c, async () => { c.$result = await fakeDbHandler() })
  },
  ITERS,
)

console.log(`\nspeedup on cache HIT: ${(withCache / noCache).toFixed(1)}x`)
console.log(
  `time saved per req:  ${(1e9 / noCache - 1e9 / withCache).toFixed(0)} ns`,
)
