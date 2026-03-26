import { describe, it, expect } from 'vitest'
import { splitIntoBatches, buildBatchedInserts } from '../batcher.js'

describe('splitIntoBatches', () => {
  it('splits 10 rows with batchSize 3 into 4 batches', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `user${i + 1}`,
    }))
    const batches = splitIntoBatches(rows, ['id', 'name'], 3)
    expect(batches.length).toBe(4)
    expect(batches[0].length).toBe(3)
    expect(batches[1].length).toBe(3)
    expect(batches[2].length).toBe(3)
    expect(batches[3].length).toBe(1)
  })

  it('returns single batch when batchSize is larger than row count', () => {
    const rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
      { id: 4, name: 'd' },
      { id: 5, name: 'e' },
    ]
    const batches = splitIntoBatches(rows, ['id', 'name'], 10)
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(5)
  })

  it('returns empty array for empty rows', () => {
    const batches = splitIntoBatches([], ['id', 'name'], 3)
    expect(batches.length).toBe(0)
  })

  it('converts row objects to arrays in column order', () => {
    const rows = [{ name: 'Alice', id: 1, email: 'alice@test.com' }]
    const batches = splitIntoBatches(rows, ['id', 'name', 'email'], 10)
    expect(batches[0][0]).toEqual([1, 'Alice', 'alice@test.com'])
  })

  it('uses null for missing columns', () => {
    const rows = [{ id: 1 }]
    const batches = splitIntoBatches(rows, ['id', 'name'], 10)
    expect(batches[0][0]).toEqual([1, null])
  })
})

describe('buildBatchedInserts', () => {
  it('produces correct number of InsertBatch objects', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      name: `user${i + 1}`,
    }))
    const batches = buildBatchedInserts('users', 'public', ['id', 'name'], rows, 3)
    expect(batches.length).toBe(3)
  })

  it('each batch contains valid SQL', () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]
    const batches = buildBatchedInserts('users', 'public', ['id', 'name'], rows, 10)
    expect(batches.length).toBe(1)
    expect(batches[0].sql).toContain('INSERT INTO public.users')
    expect(batches[0].sql).toContain("'Alice'")
    expect(batches[0].sql).toContain("'Bob'")
  })

  it('maintains consistent metadata across batches', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }))
    const batches = buildBatchedInserts('t', 'public', ['id'], rows, 2)
    for (const batch of batches) {
      expect(batch.tableName).toBe('t')
      expect(batch.schemaName).toBe('public')
      expect(batch.columns).toEqual(['id'])
    }
  })

  it('returns empty array for empty rows', () => {
    const batches = buildBatchedInserts('t', 'public', ['id'], [], 10)
    expect(batches.length).toBe(0)
  })
})
