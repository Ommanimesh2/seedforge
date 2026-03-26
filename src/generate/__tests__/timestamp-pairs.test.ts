import { describe, it, expect } from 'vitest'
import { detectTimestampPairs, generateTimestampPair } from '../timestamp-pairs.js'
import type { TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'

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

function makeTable(columns: Map<string, ColumnDef>): TableDef {
  return {
    name: 'test',
    schema: 'public',
    columns,
    primaryKey: null,
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

describe('detectTimestampPairs', () => {
  it('detects standard created_at + updated_at pair', () => {
    const table = makeTable(
      new Map([
        ['id', makeColumn('id')],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs).toEqual([
      { createdColumn: 'created_at', updatedColumn: 'updated_at' },
    ])
  })

  it('detects alternative names: created + modified', () => {
    const table = makeTable(
      new Map([
        ['created', makeColumn('created', { dataType: NormalizedType.TIMESTAMP })],
        ['modified', makeColumn('modified', { dataType: NormalizedType.TIMESTAMP })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs).toEqual([
      { createdColumn: 'created', updatedColumn: 'modified' },
    ])
  })

  it('returns empty when only created_at exists (no updated)', () => {
    const table = makeTable(
      new Map([
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs).toEqual([])
  })

  it('does not detect non-timestamp columns named similarly', () => {
    const table = makeTable(
      new Map([
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TEXT })], // not a timestamp
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs).toEqual([])
  })

  it('detects create_date + update_date pair', () => {
    const table = makeTable(
      new Map([
        ['create_date', makeColumn('create_date', { dataType: NormalizedType.TIMESTAMP })],
        ['update_date', makeColumn('update_date', { dataType: NormalizedType.TIMESTAMP })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs.length).toBe(1)
    expect(pairs[0].createdColumn).toBe('create_date')
    expect(pairs[0].updatedColumn).toBe('update_date')
  })

  it('detects inserted_at + updated_at pair', () => {
    const table = makeTable(
      new Map([
        ['inserted_at', makeColumn('inserted_at', { dataType: NormalizedType.TIMESTAMPTZ })],
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
    )

    const pairs = detectTimestampPairs(table)
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs.some((p) => p.createdColumn === 'inserted_at')).toBe(true)
  })
})

describe('generateTimestampPair', () => {
  it('ensures created < updated', () => {
    const faker = createSeededFaker(42)

    for (let i = 0; i < 100; i++) {
      const { created, updated } = generateTimestampPair(faker)
      expect(created.getTime()).toBeLessThanOrEqual(updated.getTime())
    }
  })

  it('created is in the past', () => {
    const faker = createSeededFaker(42)
    const now = new Date()

    const { created } = generateTimestampPair(faker)
    expect(created.getTime()).toBeLessThan(now.getTime())
  })

  it('updated is between created and now', () => {
    const faker = createSeededFaker(42)
    const now = new Date()

    const { created, updated } = generateTimestampPair(faker)
    expect(updated.getTime()).toBeGreaterThanOrEqual(created.getTime())
    expect(updated.getTime()).toBeLessThanOrEqual(now.getTime() + 1000) // allow 1s tolerance
  })
})
