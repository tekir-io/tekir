import { test, expect, describe } from 'bun:test'
import { request } from './setup'

let authToken = ''
let authedRequest = request
let projectId = 0
let taskId = 0
let commentId = 0

describe('Health', () => {
  test('GET /api/health', async () => {
    const res = await request.get('/api/health')
    res.assertOk()
    expect(res.body).toHaveProperty('status', 'ok')
    expect(res.body.timestamp).toBeUndefined()
    expect(res.body.uptime).toBeUndefined()
  })

  test('GET /api/stats', async () => {
    const res = await request.get('/api/stats')
    res.assertOk()
  })
})

describe('Auth', () => {
  test('register', async () => {
    const res = await request.post('/api/auth/register', {
      body: { name: 'Test User', email: 'test@tekir.dev', password: 'password123' },
    })
    res.assertCreated()
    expect(res.body).toHaveProperty('token')
    expect(res.body.user.name).toBe('Test User')
    expect(res.body.user.password).toBeUndefined()
    authToken = (res.body as any).token
    authedRequest = request.withToken(authToken)
  })

  test('register duplicate email', async () => {
    const res = await request.post('/api/auth/register', {
      body: { name: 'Dupe', email: 'test@tekir.dev', password: 'password123' },
    })
    expect(res.status).toBe(409)
  })

  test('register with invalid data', async () => {
    const res = await request.post('/api/auth/register', {
      body: { name: 'X', email: 'bad', password: '1' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('login', async () => {
    const res = await request.post('/api/auth/login', {
      body: { email: 'test@tekir.dev', password: 'password123' },
    })
    res.assertOk()
    expect(res.body).toHaveProperty('token')
  })

  test('login wrong password', async () => {
    const res = await request.post('/api/auth/login', {
      body: { email: 'test@tekir.dev', password: 'wrong' },
    })
    res.assertUnauthorized()
  })

  test('me without token', async () => {
    const res = await request.get('/api/auth/me')
    res.assertUnauthorized()
  })

  test('me with token', async () => {
    const res = await authedRequest.get('/api/auth/me')
    res.assertOk()
    expect(res.body).toHaveProperty('user')
  })
})

describe('Projects', () => {
  test('list without auth', async () => {
    const res = await request.get('/api/projects')
    res.assertUnauthorized()
  })

  test('create', async () => {
    const res = await authedRequest.post('/api/projects', {
      body: { name: 'Test Project', description: 'A test project' },
    })
    res.assertCreated()
    expect(res.body.data.name).toBe('Test Project')
    projectId = (res.body as any).data.id
  })

  test('list', async () => {
    const res = await authedRequest.get('/api/projects')
    res.assertOk()
    expect(Array.isArray((res.body as any).data)).toBe(true)
  })

  test('get by id', async () => {
    const res = await authedRequest.get(`/api/projects/${projectId}`)
    res.assertOk()
    expect(res.body.data.name).toBe('Test Project')
  })

  test('update', async () => {
    const res = await authedRequest.put(`/api/projects/${projectId}`, {
      body: { name: 'Updated' },
    })
    res.assertOk()
    expect(res.body.data.name).toBe('Updated')
  })

  test('get 404', async () => {
    const res = await authedRequest.get('/api/projects/999')
    res.assertNotFound()
  })
})

describe('Tasks', () => {
  test('create', async () => {
    const res = await authedRequest.post('/api/tasks', {
      body: { title: 'Test Task', description: 'A test', projectId, priority: 'high' },
    })
    res.assertCreated()
    expect(res.body.data.title).toBe('Test Task')
    taskId = (res.body as any).data.id
  })

  test('list', async () => {
    const res = await authedRequest.get('/api/tasks')
    res.assertOk()
    expect(Array.isArray((res.body as any).data)).toBe(true)
  })

  test('get by id', async () => {
    const res = await authedRequest.get(`/api/tasks/${taskId}`)
    res.assertOk()
    expect(res.body.data.title).toBe('Test Task')
  })

  test('update', async () => {
    const res = await authedRequest.put(`/api/tasks/${taskId}`, {
      body: { status: 'in_progress' },
    })
    res.assertOk()
  })

  test('complete', async () => {
    const res = await authedRequest.post(`/api/tasks/${taskId}/complete`)
    res.assertOk()
    expect(res.body.data.status).toBe('done')
  })
})

describe('Comments', () => {
  test('create', async () => {
    const res = await authedRequest.post(`/api/tasks/${taskId}/comments`, {
      body: { body: 'Test comment' },
    })
    res.assertCreated()
    expect(res.body.data.body).toBe('Test comment')
    commentId = (res.body as any).data.id
  })

  test('list', async () => {
    const res = await authedRequest.get(`/api/tasks/${taskId}/comments`)
    res.assertOk()
    expect((res.body as any).data.length).toBeGreaterThanOrEqual(1)
  })

  test('delete', async () => {
    const res = await authedRequest.delete(`/api/comments/${commentId}`)
    expect([200, 204]).toContain(res.status)
  })
})

describe('Swagger', () => {
  test('GET /docs/json', async () => {
    const res = await request.get('/docs/json')
    res.assertOk()
    expect(res.body.openapi).toBe('3.0.3')
  })
})

describe('Validation', () => {
  test('register with empty body', async () => {
    const res = await request.post('/api/auth/register', { body: {} })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('task without title', async () => {
    const res = await authedRequest.post('/api/tasks', { body: { projectId: 1 } })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
