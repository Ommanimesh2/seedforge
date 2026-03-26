import { describe, it, expect, vi } from 'vitest'
import { queryExistingData } from '../existing-data.js'
import type { TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'

function makeColumn(name: string, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name,
    dataType: NormalizedType.INTEGER,
    nativeType: 'integer',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
    ...overrides,
  }
}

function makeTable(overrides: Partial<TableDef> = {}): TableDef {
  return {
    name: 'users',
    schema: 'public',
    columns: new Map([['id', makeColumn('id')]]),
    primaryKey: { columns: ['id'], name: 'users_pkey' },
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
    ...overrides,
  }
}

function makeMockClient(queryResponses: Map<string, { rows: Record<string, unknown>[] }>) {
  return {
    query: vi.fn(async (sql: string) => {
      for (const [pattern, response] of queryResponses) {
        if (sql.includes(pattern)) {
          return response
        }
      }
      return { rows: [] }
    }),
  }
}

describe('queryExistingData', () => {
  it('returns empty data for an empty table', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 0 }] }],
      ['SELECT "id"', { rows: [] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable()

    const result = await queryExistingData(client as never, table)

    expect(result.rowCount).toBe(0)
    expect(result.existingPKs).toEqual([])
    expect(result.existingUniqueValues.size).toBe(0)
    expect(result.sequenceValues.size).toBe(0)
  })

  it('returns row count and PK values for table with existing rows', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 5 }] }],
      ['SELECT "id"', { rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable()

    const result = await queryExistingData(client as never, table)

    expect(result.rowCount).toBe(5)
    expect(result.existingPKs).toEqual([[1], [2], [3], [4], [5]])
  })

  it('handles composite PK with correct arity', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 2 }] }],
      ['SELECT "order_id"', { rows: [
        { order_id: 1, product_id: 10 },
        { order_id: 2, product_id: 20 },
      ] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable({
      name: 'order_items',
      columns: new Map([
        ['order_id', makeColumn('order_id')],
        ['product_id', makeColumn('product_id')],
      ]),
      primaryKey: { columns: ['order_id', 'product_id'], name: 'order_items_pkey' },
    })

    const result = await queryExistingData(client as never, table)

    expect(result.existingPKs).toEqual([[1, 10], [2, 20]])
  })

  it('populates existingUniqueValues from unique constraints', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 3 }] }],
      ['SELECT "id"', { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
      ['DISTINCT "email"', { rows: [{ email: 'a@b.com' }, { email: 'c@d.com' }] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable({
      columns: new Map([
        ['id', makeColumn('id')],
        ['email', makeColumn('email', { dataType: NormalizedType.VARCHAR })],
      ]),
      uniqueConstraints: [{ columns: ['email'], name: 'users_email_key' }],
    })

    const result = await queryExistingData(client as never, table)

    expect(result.existingUniqueValues.has('email')).toBe(true)
    const emailSet = result.existingUniqueValues.get('email')!
    expect(emailSet.has('a@b.com')).toBe(true)
    expect(emailSet.has('c@d.com')).toBe(true)
  })

  it('fetches sequence name and last_value for auto-increment columns', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 10 }] }],
      ['SELECT "id"', { rows: [{ id: 1 }] }],
      ['pg_get_serial_sequence', { rows: [{ seq_name: 'public.users_id_seq' }] }],
      ['last_value', { rows: [{ last_value: 10 }] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable({
      columns: new Map([
        ['id', makeColumn('id', { isAutoIncrement: true })],
      ]),
    })

    const result = await queryExistingData(client as never, table)

    expect(result.sequenceValues.has('public.users_id_seq')).toBe(true)
    expect(result.sequenceValues.get('public.users_id_seq')).toBe(10)
  })

  it('handles query failure gracefully (returns partial data)', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('COUNT')) {
          return { rows: [{ count: 5 }] }
        }
        throw new Error('Connection lost')
      }),
    }
    const table = makeTable()

    const result = await queryExistingData(client as never, table)

    // Should have row count but empty PKs due to failure
    expect(result.rowCount).toBe(5)
    expect(result.existingPKs).toEqual([])
  })

  it('handles table with no PK (existingPKs is empty)', async () => {
    const responses = new Map([
      ['COUNT', { rows: [{ count: 3 }] }],
    ])
    const client = makeMockClient(responses)
    const table = makeTable({ primaryKey: null })

    const result = await queryExistingData(client as never, table)

    expect(result.existingPKs).toEqual([])
    expect(result.rowCount).toBe(3)
  })
})
