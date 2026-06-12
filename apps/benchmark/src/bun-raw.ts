const PORT = Number(process.env.PORT) || 3003

const E = Object.freeze(Object.create(null))
function pq(qs: string): any {
  if (!qs) return E
  const r: any = Object.create(null)
  let si = -1, ei = -1
  const l = qs.length
  for (let i = 0; i <= l; i++) {
    const ch = i === l ? 38 : qs.charCodeAt(i)
    if (ch === 38) {
      if (i > si + 1) {
        const hv = ei !== -1 && ei > si + 1
        r[qs.slice(si + 1, hv ? ei : i)] = hv ? qs.slice(ei + 1, i) : ''
      }
      si = i; ei = -1
    } else if (ch === 61 && ei === -1) ei = i
  }
  return r
}

Bun.serve({
  port: PORT,
  idleTimeout: 30,
  routes: {
    "/json": () => Response.json({ message: "Hello, World!" }),
    "/users/:id": (r) => Response.json({ id: r.params.id, name: `User ${r.params.id}` }),
    "/posts/:postId/comments/:commentId": (r) => Response.json({ postId: r.params.postId, commentId: r.params.commentId }),
    "/users": { POST: async (r) => Response.json({ created: true, user: await r.json() }) },
    "/search": (r) => {
      const u = r.url, qi = u.indexOf("?", 11)
      return Response.json(qi === -1 ? {} : { query: pq(u.substring(qi + 1)).q, page: pq(u.substring(qi + 1)).page || "1" })
    },
  },
  fetch: () => new Response("Not Found", { status: 404 }),
})

console.log(`[bun-raw] on ${PORT}`)
