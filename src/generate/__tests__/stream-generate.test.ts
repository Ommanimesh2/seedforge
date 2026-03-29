import { describe, it, expect } from 'vitest'
import { generateTableStream } from '../stream-generate.js'
import { ReferencePoolManager } from '../reference-pool.js'
import { UniqueTracker } from '../unique-tracker.js'
import { createGenerationConfig } from '../config.js'
import { mapTable } from '../../mapping/mapper.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import type { TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { ExistingData, Row } from '../types.js'

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

/**
 * Helper to collect all rows from the async generator
 */
async function collectRows(gen: AsyncGenerator<Row, unknown, undefined>): Promise<{ rows: Row[]; meta: unknown }> {
  const rows: Row[] = []
  let result = await gen.next()
  while (!result.done) {
    rows.push(result.value)
    result = await gen.next()
  }
  return { rows, meta: result.value }
}

describe('generateTableStream', () => {
  it('yields N rows one at a time', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows, meta } = await collectRows(gen)

    expect(rows.length).toBe(5)
    for (const row of rows) {
      expect(row).toHaveProperty('id')
      expect(row).toHaveProperty('name')
    }

    // Check return metadata
    const streamMeta = meta as { tableName: string; generatedPKs: unknown[][]; rowCount: number }
    expect(streamMeta.tableName).toBe('public.items')
    expect(streamMeta.rowCount).toBe(5)
    expect(streamMeta.generatedPKs.length).toBe(5)
  })

  it('yields rows lazily (can be consumed one at a time)', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    // Consume one at a time
    const first = await gen.next()
    expect(first.done).toBe(false)
    expect(first.value).toHaveProperty('id')

    const second = await gen.next()
    expect(second.done).toBe(false)

    const third = await gen.next()
    expect(third.done).toBe(false)

    // Fourth call should be done
    const fourth = await gen.next()
    expect(fourth.done).toBe(true)
  })

  it('collects PK values in return metadata', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows, meta } = await collectRows(gen)
    const streamMeta = meta as { generatedPKs: unknown[][] }

    // PK values should match the yielded rows
    expect(streamMeta.generatedPKs.length).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(streamMeta.generatedPKs[i]).toEqual([rows[i].id])
    }
  })

  it('handles auto-increment PK columns', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows } = await collectRows(gen)

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].id).toBe(i + 1)
      expect(rows[i]).toHaveProperty('name')
    }
  })

  it('resolves FK columns from reference pool', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: pool,
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows } = await collectRows(gen)

    for (const row of rows) {
      expect([1, 2, 3]).toContain(row.user_id)
    }
  })

  it('sets deferred FK columns to NULL', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(['parent_id']),
    })

    const { rows } = await collectRows(gen)

    for (const row of rows) {
      expect(row.parent_id).toBeNull()
    }
  })

  it('produces same rows as non-streaming generateTableRows with same seed', async () => {
    // Import the non-streaming version for comparison
    const { generateTableRows } = await import('../generate-table.js')

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

    const config = createGenerationConfig({ globalRowCount: 10, seed: 99 })

    // Non-streaming
    const faker1 = createSeededFaker(99)
    const syncResult = generateTableRows({
      table,
      mappingResult: mapTable(table),
      config,
      faker: faker1,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    // Streaming
    const faker2 = createSeededFaker(99)
    const gen = generateTableStream({
      table,
      mappingResult: mapTable(table),
      config,
      faker: faker2,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows: streamRows } = await collectRows(gen)

    expect(streamRows).toEqual(syncResult.rows)
  })

  it('handles tables with no primary key', async () => {
    const table: TableDef = {
      name: 'logs',
      schema: 'public',
      columns: new Map([
        ['message', makeColumn('message', { dataType: NormalizedType.TEXT })],
        ['level', makeColumn('level', { dataType: NormalizedType.VARCHAR })],
      ]),
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const config = createGenerationConfig({ globalRowCount: 3, seed: 42 })
    const faker = createSeededFaker(42)
    const mapping = mapTable(table)

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows, meta } = await collectRows(gen)
    const streamMeta = meta as { generatedPKs: unknown[][] }

    expect(rows.length).toBe(3)
    expect(streamMeta.generatedPKs.length).toBe(0) // No PK to extract
  })

  it('enforces uniqueness for unique columns', async () => {
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

    const gen = generateTableStream({
      table,
      mappingResult: mapping,
      config,
      faker,
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const { rows } = await collectRows(gen)
    const usernames = rows.map((r) => r.username)
    const uniqueUsernames = new Set(usernames)
    expect(uniqueUsernames.size).toBe(usernames.length)
  })
})
