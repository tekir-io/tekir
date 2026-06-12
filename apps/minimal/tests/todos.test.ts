import { test, expect, describe } from 'bun:test'
import { request } from './setup'

describe('Health', () => {
  test('GET /health', async () => {
    const res = await request.get('/health')
    res.assertOk()
    expect(res.body.status).toBe('ok')
    expect(res.body.time).toBeDefined()
  })
})

describe('Todos CRUD', () => {
  let todoId: number

  test('list empty', async () => {
    const res = await request.get('/todos')
    res.assertOk()
    expect(res.body).toEqual([])
  })

  test('create', async () => {
    const res = await request.post('/todos', { body: { title: 'Buy milk' } })
    res.assertOk()
    expect(res.body.title).toBe('Buy milk')
    expect(res.body.done).toBe(0)
    expect(res.body.id).toBeDefined()
    todoId = res.body.id
  })

  test('create second', async () => {
    const res = await request.post('/todos', { body: { title: 'Walk dog' } })
    res.assertOk()
    expect(res.body.title).toBe('Walk dog')
  })

  test('list all', async () => {
    const res = await request.get('/todos')
    res.assertOk()
    expect(res.body.length).toBe(2)
  })

  test('get by id', async () => {
    const res = await request.get(`/todos/${todoId}`)
    res.assertOk()
    expect(res.body.title).toBe('Buy milk')
  })

  test('get 404', async () => {
    const res = await request.get('/todos/999')
    res.assertOk()
    expect(res.body.error).toBe('Not found')
  })

  test('update', async () => {
    const res = await request.put(`/todos/${todoId}`, { body: { done: true } })
    res.assertOk()
    expect(res.body.done).toBe(1)
  })

  test('delete', async () => {
    const res = await request.delete(`/todos/${todoId}`)
    res.assertOk()
    expect(res.body.deleted).toBe(true)
  })

  test('list after delete', async () => {
    const res = await request.get('/todos')
    res.assertOk()
    expect(res.body.length).toBe(1)
  })
})

describe('Edge cases', () => {
  test('create without title inserts null/empty (no server-side validation)', async () => {
    const res = await request.post('/todos', { body: {} })
    // SQLite NOT NULL constraint on title will cause 500
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('Health', () => {
  test('GET /health', async () => {
    const res = await request.get('/health')
    res.assertOk()
    expect(res.body.status).toBe('ok')
  })
})
