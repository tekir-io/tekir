import { test, expect, describe } from 'bun:test'
import { DatabaseCacheStore } from '../src/stores/database'

const mockDb = { exec: async () => {}, queryOne: async () => null, run: async () => {} }

describe('DatabaseCacheStore — table name validation', () => {
  test('accepts valid names', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache')).not.toThrow()
    expect(() => new DatabaseCacheStore(mockDb, 'app_cache')).not.toThrow()
    expect(() => new DatabaseCacheStore(mockDb, '_cache')).not.toThrow()
    expect(() => new DatabaseCacheStore(mockDb, 'Cache2')).not.toThrow()
  })

  test('accepts default', () => {
    expect(() => new DatabaseCacheStore(mockDb)).not.toThrow()
  })

  test('rejects SQL injection', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache; DROP TABLE users')).toThrow('Invalid table name')
    expect(() => new DatabaseCacheStore(mockDb, 'cache" OR 1=1')).toThrow('Invalid table name')
    expect(() => new DatabaseCacheStore(mockDb, "cache' --")).toThrow('Invalid table name')
  })

  test('rejects empty', () => {
    expect(() => new DatabaseCacheStore(mockDb, '')).toThrow('Invalid table name')
  })

  test('rejects spaces', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'my cache')).toThrow('Invalid table name')
  })

  test('rejects hyphens', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'app-cache')).toThrow('Invalid table name')
  })

  test('rejects dots', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'app.cache')).toThrow('Invalid table name')
  })

  test('rejects number prefix', () => {
    expect(() => new DatabaseCacheStore(mockDb, '1cache')).toThrow('Invalid table name')
  })

  test('rejects backticks', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache`')).toThrow('Invalid table name')
  })

  test('rejects parentheses', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache()')).toThrow('Invalid table name')
  })

  test('rejects semicolons', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache;x')).toThrow('Invalid table name')
  })

  test('rejects newlines', () => {
    expect(() => new DatabaseCacheStore(mockDb, 'cache\n')).toThrow('Invalid table name')
  })
})
