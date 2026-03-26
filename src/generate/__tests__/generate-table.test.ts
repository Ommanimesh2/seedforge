import { describe, it, expect } from 'vitest'
import { generateTableRows } from '../generate-table.js'
import { ReferencePoolManager } from '../reference-pool.js'
import { UniqueTracker } from '../unique-tracker.js'
import { createGenerationConfig } from '../config.js'
import { mapTable } from '../../mapping/mapper.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import type { TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { ExistingData } from '../types.js'
import { GenerationError } from '../../errors/index.js'

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

function makeFK(
  name: string,
  columns: string[],
  referencedTable: string,
  overrides: Partial<ForeignKeyDef> = {},
): ForeignKeyDef {
  return {
    name,
    columns,
    referencedTable,
    referencedSchema: 'public',
    referencedColumns: ['id'],
    onDelete: FKAction.NO_ACTION,
    onUpdate: FKAction.NO_ACTION,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
    ...overrides,
  }
}

function emptyExistingData(): ExistingData {
  return {
    rowCount: 0,
    existingPKs: [],
    existingUniqueValues: new Map(),
    sequenceValues: new Map(),
  }
}

describe('generateTableRows', () => {
  it('generates N rows with correct column names', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 5, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    expect(result.rows.length).toBe(5)
    expect(result.tableName).toBe('public.items')
    for (const row of result.rows) {
      expect(row).toHaveProperty('id')
      expect(row).toHaveProperty('name')
    }
  })

  it('skips auto-increment columns', () => {
    const table: TableDef = {
      name: 'users',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { isAutoIncrement: true })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: { columns: ['id'], name: 'users_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      expect(row).not.toHaveProperty('id')
      expect(row).toHaveProperty('name')
    }
  })

  it('generates UUID PK values', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const row of result.rows) {
      expect(String(row.id)).toMatch(uuidRegex)
    }
  })

  it('resolves FK column from reference pool', () => {
    const table: TableDef = {
      name: 'posts',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id')],
      ]),
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [makeFK('posts_user_fk', ['user_id'], 'users')],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2], [3]])

    const config = createGenerationConfig({ globalRowCount: 5, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: pool,
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      expect([1, 2, 3]).toContain(row.user_id)
    }
  })

  it('handles composite FK: all columns assigned from same tuple', () => {
    const table: TableDef = {
      name: 'line_items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['order_id', makeColumn('order_id')],
        ['product_id', makeColumn('product_id')],
      ]),
      primaryKey: { columns: ['id'], name: 'line_items_pkey' },
      foreignKeys: [
        makeFK('line_items_fk', ['order_id', 'product_id'], 'order_items', {
          referencedColumns: ['order_id', 'product_id'],
        }),
      ],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const pool = new ReferencePoolManager()
    pool.initFromExisting(
      'public.order_items',
      ['order_id', 'product_id'],
      [[1, 10], [2, 20], [3, 30]],
    )

    const config = createGenerationConfig({ globalRowCount: 5, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: pool,
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      // The pair must be from the same tuple
      expect(
        [[1, 10], [2, 20], [3, 30]],
      ).toContainEqual([row.order_id, row.product_id])
    }
  })

  it('sets nullable FK to NULL when pool is empty', () => {
    const table: TableDef = {
      name: 'posts',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [makeFK('posts_user_fk', ['user_id'], 'users')],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(), // empty pool
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      expect(row.user_id).toBeNull()
    }
  })

  it('throws GenerationError SF3004 when non-nullable FK pool is empty', () => {
    const table: TableDef = {
      name: 'posts',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id', { isNullable: false })],
      ]),
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [makeFK('posts_user_fk', ['user_id'], 'users')],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 1, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    expect(() =>
      generateTableRows({
        table,
        mappingResult: mapping,
        config,
        faker,
        referencePool: new ReferencePoolManager(),
        uniqueTracker: new UniqueTracker(),
        existingData: emptyExistingData(),
        deferredFKColumns: new Set(),
      }),
    ).toThrow(GenerationError)
  })

  it('applies nullable rate to nullable non-FK non-PK columns', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['description', makeColumn('description', {
          dataType: NormalizedType.TEXT,
          isNullable: true,
        })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    // High nullable rate to make the statistical test reliable
    const config = createGenerationConfig({
      globalRowCount: 200,
      seed: 42,
      nullableRate: 0.5,
    })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const nullCount = result.rows.filter((r) => r.description === null).length
    // With 50% rate and 200 rows, expect roughly 100 nulls (allow 30-170 range)
    expect(nullCount).toBeGreaterThan(30)
    expect(nullCount).toBeLessThan(170)
  })

  it('enforces uniqueness for unique columns', () => {
    const table: TableDef = {
      name: 'users',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['username', makeColumn('username', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: { columns: ['id'], name: 'users_pkey' },
      foreignKeys: [],
      uniqueConstraints: [{ columns: ['username'], name: 'users_username_key' }],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 20, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const usernames = result.rows.map((r) => r.username)
    const uniqueUsernames = new Set(usernames)
    expect(uniqueUsernames.size).toBe(usernames.length)
  })

  it('handles timestamp pair: created_at < updated_at', () => {
    const table: TableDef = {
      name: 'posts',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 20, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      const created = row.created_at as Date
      const updated = row.updated_at as Date
      expect(created.getTime()).toBeLessThanOrEqual(updated.getTime())
    }
  })

  it('sets deferred FK columns to NULL', () => {
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [makeFK('cat_parent_fk', ['parent_id'], 'categories')],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 5, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(['parent_id']),
    })

    for (const row of result.rows) {
      expect(row.parent_id).toBeNull()
    }
  })

  it('extracts generated PKs correctly', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    expect(result.generatedPKs.length).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(result.generatedPKs[i]).toEqual([result.rows[i].id])
    }
  })

  it('handles enum column with enumValues', () => {
    const table: TableDef = {
      name: 'posts',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['status', makeColumn('status', {
          dataType: NormalizedType.ENUM,
          enumValues: ['draft', 'published', 'archived'],
        })],
      ]),
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 20, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      expect(['draft', 'published', 'archived']).toContain(row.status)
    }
  })

  it('generates {} for JSON/JSONB columns', () => {
    const table: TableDef = {
      name: 'configs',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['data', makeColumn('data', { dataType: NormalizedType.JSONB })],
      ]),
      primaryKey: { columns: ['id'], name: 'configs_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    for (const row of result.rows) {
      expect(row.data).toEqual({})
    }
  })

  it('generates exact row count', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 17, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const result = generateTableRows({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    expect(result.rows.length).toBe(17)
  })

  it('is deterministic with same seed', () => {
    const table: TableDef = {
      name: 'items',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: { columns: ['id'], name: 'items_pkey' },
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 5, seed: 99 })

    const faker1 = createSeededFaker(99)
    const result1 = generateTableRows({
      table,
      mappingResult: mapTable(table),
      config,
      faker: faker1,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const faker2 = createSeededFaker(99)
    const result2 = generateTableRows({
      table,
      mappingResult: mapTable(table),
      config,
      faker: faker2,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    expect(result1.rows).toEqual(result2.rows)
  })
})
