import { test, expect, describe } from 'bun:test'
import { DatabaseStore } from '../src/store'

const mockDb = { exec: async () => {}, queryOne: async () => null, run: async () => {} }

describe('DatabaseStore — table name validation', () => {
  test('accepts valid names', () => {
    expect(() => new DatabaseStore(mockDb, 'rate_limits')).not.toThrow()
    expect(() => new DatabaseStore(mockDb, 'limits')).not.toThrow()
    expect(() => new DatabaseStore(mockDb, '_limits')).not.toThrow()
    expect(() => new DatabaseStore(mockDb, 'Limits2')).not.toThrow()
  })

  test('accepts default', () => {
    expect(() => new DatabaseStore(mockDb)).not.toThrow()
  })

  test('rejects SQL injection', () => {
    expect(() => new DatabaseStore(mockDb, 'limits; DROP TABLE users')).toThrow('Invalid table name')
    expect(() => new DatabaseStore(mockDb, 'limits" OR 1=1')).toThrow('Invalid table name')
    expect(() => new DatabaseStore(mockDb, "limits' --")).toThrow('Invalid table name')
  })

  test('rejects special characters', () => {
    expect(() => new DatabaseStore(mockDb, 'rate-limits')).toThrow('Invalid table name')
    expect(() => new DatabaseStore(mockDb, 'rate limits')).toThrow('Invalid table name')
    expect(() => new DatabaseStore(mockDb, 'rate.limits')).toThrow('Invalid table name')
  })

  test('rejects empty', () => {
    expect(() => new DatabaseStore(mockDb, '')).toThrow('Invalid table name')
  })

  test('rejects number prefix', () => {
    expect(() => new DatabaseStore(mockDb, '1limits')).toThrow('Invalid table name')
  })

  test('rejects backticks', () => {
    expect(() => new DatabaseStore(mockDb, 'limits`')).toThrow('Invalid table name')
  })

  test('rejects semicolons', () => {
    expect(() => new DatabaseStore(mockDb, 'limits;x')).toThrow('Invalid table name')
  })

  test('rejects newlines', () => {
    expect(() => new DatabaseStore(mockDb, 'limits\n')).toThrow('Invalid table name')
  })

  test('rejects parentheses', () => {
    expect(() => new DatabaseStore(mockDb, 'limits()')).toThrow('Invalid table name')
  })
})
