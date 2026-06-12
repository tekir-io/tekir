import { Elysia } from 'elysia'

const app = new Elysia()

// Simple JSON response
app.get('/json', () => {
  return { message: 'Hello, World!' }
})

// URL params
app.get('/users/:id', ({ params }) => {
  return { id: params.id, name: `User ${params.id}` }
})

// Nested params
app.get('/posts/:postId/comments/:commentId', ({ params }) => {
  return { postId: params.postId, commentId: params.commentId }
})

// POST with body
app.post('/users', ({ body }) => {
  return { created: true, user: body }
})

// Query string
app.get('/search', ({ query }) => {
  return { query: query.q, page: query.page || '1' }
})

const PORT = Number(process.env.PORT) || 3002

app.listen(PORT, () => {
  console.log(`[elysia] Server running at http://0.0.0.0:${PORT}`)
})
