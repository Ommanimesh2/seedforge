import { describe, it, expect, vi } from 'vitest'
import { findSequences, resetSequences } from '../sequences.js'
import { InsertionError } from '../../errors/index.js'
import type { SequenceResetInfo } from '../types.js'

function createMockClient(queryResults: Record<string, unknown[]> = {}) {
  let callIndex = 0
  const resultKeys = Object.keys(queryResults)
  return {
    query: vi.fn().mockImplementation(() => {
      const key = resultKeys[callIndex] ?? 'default'
      callIndex++
      return Promise.resolve({ rows: queryResults[key] ?? [] })
    }),
  }
}

describe('findSequences', () => {
  it('returns empty array for empty table list', async () => {
    const client = createMockClient()
    const result = await findSequences(client as never, 'public', [])
    expect(result).toEqual([])
    expect(client.query).not.toHaveBeenCalled()
  })

  it('queries pg_catalog and returns SequenceResetInfo', async () => {
    const client = createMockClient({
      serial: [
        {
          table_name: 'users',
          column_name: 'id',
          sequence_name: 'users_id_seq',
          schema_name: 'public',
        },
      ],
      identity: [],
    })

    const result = await findSequences(client as never, 'public', ['users'])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      tableName: 'users',
      schemaName: 'public',
      columnName: 'id',
      sequenceName: 'users_id_seq',
    })
  })

  it('deduplicates by table + column', async () => {
    const client = createMockClient({
      serial: [
        {
          table_name: 'users',
          column_name: 'id',
          sequence_name: 'users_id_seq',
          schema_name: 'public',
        },
      ],
      identity: [
        {
          table_name: 'users',
          column_name: 'id',
          sequence_name: 'users_id_seq',
          schema_name: 'public',
        },
      ],
    })

    const result = await findSequences(client as never, 'public', ['users'])
    expect(result).toHaveLength(1)
  })

  it('filters out null sequence names', async () => {
    const client = createMockClient({
      serial: [
        {
          table_name: 'users',
          column_name: 'id',
          sequence_name: null,
          schema_name: 'public',
        },
      ],
      identity: [],
    })

    const result = await findSequences(client as never, 'public', ['users'])
    expect(result).toHaveLength(0)
  })

  it('throws InsertionError on query failure', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('connection lost')),
    }

    await expect(
      findSequences(client as never, 'public', ['users']),
    ).rejects.toThrow(InsertionError)
  })
})

describe('resetSequences', () => {
  it('calls query for each sequence and returns count', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const sequences: SequenceResetInfo[] = [
      {
        tableName: 'users',
        schemaName: 'public',
        columnName: 'id',
        sequenceName: 'users_id_seq',
      },
      {
        tableName: 'posts',
        schemaName: 'public',
        columnName: 'id',
        sequenceName: 'posts_id_seq',
      },
    ]

    const count = await resetSequences(client as never, sequences)
    expect(count).toBe(2)
    expect(client.query).toHaveBeenCalledTimes(2)
  })

  it('continues on individual failure and does not throw', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('sequence not found'))
        .mockResolvedValueOnce({ rows: [] }),
    }

    const sequences: SequenceResetInfo[] = [
      {
        tableName: 'users',
        schemaName: 'public',
        columnName: 'id',
        sequenceName: 'users_id_seq',
      },
      {
        tableName: 'broken',
        schemaName: 'public',
        columnName: 'id',
        sequenceName: 'broken_id_seq',
      },
      {
        tableName: 'posts',
        schemaName: 'public',
        columnName: 'id',
        sequenceName: 'posts_id_seq',
      },
    ]

    const count = await resetSequences(client as never, sequences)
    expect(count).toBe(2) // 2 succeeded, 1 failed
  })

  it('returns 0 for empty sequences', async () => {
    const client = { query: vi.fn() }
    const count = await resetSequences(client as never, [])
    expect(count).toBe(0)
    expect(client.query).not.toHaveBeenCalled()
  })
})
