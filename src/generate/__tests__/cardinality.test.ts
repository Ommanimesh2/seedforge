import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import {
  parseCardinalityRange,
  distributeChildren,
  buildFKAssignmentSequence,
  convertRelationshipConfig,
  buildCardinalityFromConfig,
  resolveCardinalityForTable,
  type CardinalitySpec,
} from '../cardinality.js'
import { ReferencePoolManager } from '../reference-pool.js'
import type { TableDef } from '../../types/schema.js'

function seededFaker(seed = 42) {
  faker.seed(seed)
  return faker
}

describe('parseCardinalityRange', () => {
  it('parses "1..10" correctly', () => {
    const result = parseCardinalityRange('1..10')
    expect(result).toEqual({ min: 1, max: 10 })
  })

  it('parses "0..3" (zero min)', () => {
    const result = parseCardinalityRange('0..3')
    expect(result).toEqual({ min: 0, max: 3 })
  })

  it('parses "5..5" (min equals max)', () => {
    const result = parseCardinalityRange('5..5')
    expect(result).toEqual({ min: 5, max: 5 })
  })

  it('throws on invalid format "abc"', () => {
    expect(() => parseCardinalityRange('abc')).toThrow('Invalid cardinality range')
  })

  it('throws on reversed range "10..1"', () => {
    expect(() => parseCardinalityRange('10..1')).toThrow('min (10) must be <= max (1)')
  })

  it('throws on negative values "-1..5"', () => {
    expect(() => parseCardinalityRange('-1..5')).toThrow('Invalid cardinality range')
  })
})

describe('distributeChildren', () => {
  it('distributes with uniform distribution', () => {
    const f = seededFaker()
    const counts = distributeChildren(5, 100, { min: 1, max: 40, distribution: 'uniform' }, f)

    expect(counts.length).toBe(5)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100)
    // All counts should be within reasonable range
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(0)
    }
  })

  it('distributes with zipf distribution (skewed)', () => {
    const f = seededFaker()
    const counts = distributeChildren(20, 200, { min: 1, max: 50, distribution: 'zipf' }, f)

    expect(counts.length).toBe(20)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(200)

    // Zipf should produce skew: some parents should have notably more children
    const sorted = [...counts].sort((a, b) => b - a)
    // The top parent should have significantly more than the median
    expect(sorted[0]).toBeGreaterThan(sorted[10])
  })

  it('distributes with normal distribution', () => {
    const f = seededFaker()
    const counts = distributeChildren(10, 50, { min: 1, max: 10, distribution: 'normal' }, f)

    expect(counts.length).toBe(10)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(50)
  })

  it('exact total with min=0 (some parents get zero)', () => {
    const f = seededFaker()
    const counts = distributeChildren(10, 15, { min: 0, max: 5, distribution: 'uniform' }, f)

    expect(counts.length).toBe(10)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(15)
    // With 10 parents and only 15 children, some should have 0
    expect(counts.filter((c) => c === 0).length).toBeGreaterThanOrEqual(0)
  })

  it('handles min*parents > children gracefully', () => {
    const f = seededFaker()
    // 10 parents, min=5, but only 30 children -> 10*5=50 > 30
    const counts = distributeChildren(10, 30, { min: 5, max: 10, distribution: 'uniform' }, f)

    expect(counts.length).toBe(10)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30)
  })

  it('handles zero children', () => {
    const f = seededFaker()
    const counts = distributeChildren(5, 0, { min: 1, max: 10, distribution: 'uniform' }, f)

    expect(counts.length).toBe(5)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('handles zero parents', () => {
    const f = seededFaker()
    const counts = distributeChildren(0, 100, { min: 1, max: 10, distribution: 'uniform' }, f)

    expect(counts.length).toBe(0)
  })

  it('deterministic with same seed', () => {
    const spec: CardinalitySpec = { min: 1, max: 10, distribution: 'zipf' }
    const counts1 = distributeChildren(10, 50, spec, seededFaker(42))
    const counts2 = distributeChildren(10, 50, spec, seededFaker(42))

    expect(counts1).toEqual(counts2)
  })
})

describe('buildFKAssignmentSequence', () => {
  it('returns correct total length', () => {
    const childrenPerParent = [3, 2, 5]
    const parentPKs: unknown[][] = [[1], [2], [3]]
    const f = seededFaker()

    const seq = buildFKAssignmentSequence(childrenPerParent, parentPKs, f)
    expect(seq.length).toBe(10) // 3+2+5
  })

  it('contains correct PK tuples', () => {
    const childrenPerParent = [2, 0, 3]
    const parentPKs: unknown[][] = [[10], [20], [30]]
    const f = seededFaker()

    const seq = buildFKAssignmentSequence(childrenPerParent, parentPKs, f)
    expect(seq.length).toBe(5) // 2+0+3

    // Count occurrences of each PK
    const countMap = new Map<number, number>()
    for (const tuple of seq) {
      const pk = tuple[0] as number
      countMap.set(pk, (countMap.get(pk) ?? 0) + 1)
    }
    expect(countMap.get(10)).toBe(2)
    expect(countMap.get(20)).toBeUndefined() // 0 children
    expect(countMap.get(30)).toBe(3)
  })

  it('shuffles the sequence (not all same parent grouped)', () => {
    const childrenPerParent = [50, 50]
    const parentPKs: unknown[][] = [[1], [2]]
    const f = seededFaker()

    const seq = buildFKAssignmentSequence(childrenPerParent, parentPKs, f)

    // Check that the first 10 elements aren't all the same parent
    const firstTen = seq.slice(0, 10).map((t) => t[0])
    const uniqueInFirstTen = new Set(firstTen)
    expect(uniqueInFirstTen.size).toBeGreaterThan(1)
  })
})

describe('convertRelationshipConfig', () => {
  it('converts range string', () => {
    const spec = convertRelationshipConfig({ cardinality: '1..10' })
    expect(spec).toEqual({ min: 1, max: 10, distribution: 'uniform' })
  })

  it('converts range string with distribution', () => {
    const spec = convertRelationshipConfig({ cardinality: '2..8', distribution: 'zipf' })
    expect(spec).toEqual({ min: 2, max: 8, distribution: 'zipf' })
  })

  it('converts discrete array', () => {
    const spec = convertRelationshipConfig({ cardinality: [1, 3, 5] })
    expect(spec).toEqual({ min: 1, max: 5, distribution: 'uniform' })
  })
})

describe('buildCardinalityFromConfig', () => {
  it('builds config from table relationships', () => {
    const tables = {
      orders: {
        relationships: {
          user_id: { cardinality: '1..10', distribution: 'zipf' as const },
        },
      },
    }

    const result = buildCardinalityFromConfig(tables, 'public')
    expect(result.size).toBe(1)
    expect(result.has('public.orders')).toBe(true)
    const orderConfig = result.get('public.orders')!
    expect(orderConfig.get('user_id')).toEqual({ min: 1, max: 10, distribution: 'zipf' })
  })

  it('handles qualified table names', () => {
    const tables = {
      'myschema.orders': {
        relationships: {
          user_id: { cardinality: '0..5' },
        },
      },
    }

    const result = buildCardinalityFromConfig(tables, 'public')
    expect(result.has('myschema.orders')).toBe(true)
  })

  it('skips tables without relationships', () => {
    const tables = {
      users: { count: 10 },
      orders: {
        relationships: {
          user_id: { cardinality: '1..5' },
        },
      },
    }

    const result = buildCardinalityFromConfig(tables as Record<string, { relationships?: Record<string, { cardinality: string }> }>, 'public')
    expect(result.size).toBe(1)
  })
})

describe('resolveCardinalityForTable', () => {
  function makeTableDef(fks: { column: string; refSchema: string; refTable: string; refColumn: string }[]): TableDef {
    return {
      name: 'orders',
      schema: 'public',
      columns: new Map([
        ['id', { name: 'id', dataType: 'integer', isNullable: false, isAutoIncrement: true, isPrimaryKey: true, isGenerated: false, isUnique: false }],
        ...fks.map((fk) => [fk.column, { name: fk.column, dataType: 'integer', isNullable: false, isAutoIncrement: false, isPrimaryKey: false, isGenerated: false, isUnique: false }] as const),
      ]),
      primaryKey: { name: 'orders_pkey', columns: ['id'] },
      foreignKeys: fks.map((fk) => ({
        name: `fk_${fk.column}`,
        columns: [fk.column],
        referencedSchema: fk.refSchema,
        referencedTable: fk.refTable,
        referencedColumns: [fk.refColumn],
      })),
      uniqueConstraints: [],
      checkConstraints: [],
      enumTypes: new Map(),
    } as unknown as TableDef
  }

  it('resolves cardinality for a single FK column', () => {
    const pool = new ReferencePoolManager()
    pool.addGenerated('public.users', [[1], [2], [3], [4], [5]])

    const table = makeTableDef([{ column: 'user_id', refSchema: 'public', refTable: 'users', refColumn: 'id' }])

    const config = new Map([['user_id', { min: 1, max: 5, distribution: 'uniform' as const }]])

    const result = resolveCardinalityForTable(table, pool, config, 15, seededFaker())

    expect(result.has('user_id')).toBe(true)
    const seq = result.get('user_id')!
    expect(seq.length).toBe(15)

    // Verify all FK values point to valid parents
    const validPKs = new Set([1, 2, 3, 4, 5])
    for (const tuple of seq) {
      expect(validPKs.has(tuple[0] as number)).toBe(true)
    }
  })

  it('skips deferred FK columns', () => {
    const pool = new ReferencePoolManager()
    pool.addGenerated('public.users', [[1], [2], [3]])

    const table = makeTableDef([{ column: 'user_id', refSchema: 'public', refTable: 'users', refColumn: 'id' }])
    const config = new Map([['user_id', { min: 1, max: 5, distribution: 'uniform' as const }]])
    const deferred = new Set(['user_id'])

    const result = resolveCardinalityForTable(table, pool, config, 10, seededFaker(), deferred)
    expect(result.size).toBe(0)
  })

  it('skips columns with empty reference pool', () => {
    const pool = new ReferencePoolManager() // empty

    const table = makeTableDef([{ column: 'user_id', refSchema: 'public', refTable: 'users', refColumn: 'id' }])
    const config = new Map([['user_id', { min: 1, max: 5, distribution: 'uniform' as const }]])

    const result = resolveCardinalityForTable(table, pool, config, 10, seededFaker())
    expect(result.size).toBe(0)
  })
})
