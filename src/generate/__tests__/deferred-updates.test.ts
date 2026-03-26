import { describe, it, expect } from 'vitest'
import { generateDeferredUpdates } from '../deferred-updates.js'
import { ReferencePoolManager } from '../reference-pool.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import type { TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { DependencyEdge } from '../../graph/types.js'

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

describe('generateDeferredUpdates', () => {
  it('generates tree structure for self-ref table (~15% roots)', () => {
    const fk = makeFK('cat_parent_fk', ['parent_id'], 'categories')
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    // 20 rows, so ~3 (15%) should be roots
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      parent_id: null,
    }))
    const generatedPKs = rows.map((r) => [r.id])

    const pool = new ReferencePoolManager()
    pool.addGenerated('public.categories', generatedPKs)

    const selfRefEdge: DependencyEdge = {
      from: 'public.categories',
      to: 'public.categories',
      fk,
      isNullable: true,
      isSelfRef: true,
    }

    const faker = createSeededFaker(42)
    const updates = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: rows,
      generatedPKs,
      deferredFKEdges: [selfRefEdge],
      referencePool: pool,
      faker,
    })

    // Root threshold = floor(20 * 0.15) = 3, so rows 0-2 are roots
    // Remaining 17 rows should get updates (unless they self-reference)
    const rootThreshold = Math.floor(20 * 0.15) // 3

    // Updates should be for rows at index rootThreshold and above
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.length).toBeLessThanOrEqual(20 - rootThreshold)

    // Verify no update sets parent_id to the row's own id
    for (const update of updates) {
      expect(update.setValues[0]).not.toBe(update.pkValues[0])
    }
  })

  it('ensures no forward references in self-ref tree', () => {
    const fk = makeFK('cat_parent_fk', ['parent_id'], 'categories')
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      parent_id: null,
    }))
    const generatedPKs = rows.map((r) => [r.id])

    const pool = new ReferencePoolManager()
    pool.addGenerated('public.categories', generatedPKs)

    const selfRefEdge: DependencyEdge = {
      from: 'public.categories',
      to: 'public.categories',
      fk,
      isNullable: true,
      isSelfRef: true,
    }

    const faker = createSeededFaker(42)
    const updates = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: rows,
      generatedPKs,
      deferredFKEdges: [selfRefEdge],
      referencePool: pool,
      faker,
    })

    // For each update, the referenced parent_id should be < the row's own id
    // (parent was generated before child in the array)
    for (const update of updates) {
      const rowId = update.pkValues[0] as number
      const parentId = update.setValues[0] as number
      expect(parentId).toBeLessThan(rowId)
    }
  })

  it('generates cycle-broken FK updates from reference pool', () => {
    const fk = makeFK('orders_invoice_fk', ['invoice_id'], 'invoices')
    const table: TableDef = {
      name: 'orders',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['invoice_id', makeColumn('invoice_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'orders_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const rows = [
      { id: 1, invoice_id: null },
      { id: 2, invoice_id: null },
      { id: 3, invoice_id: null },
    ]
    const generatedPKs = [[1], [2], [3]]

    const pool = new ReferencePoolManager()
    pool.addGenerated('public.invoices', [[100], [200], [300]])

    const cycleEdge: DependencyEdge = {
      from: 'public.orders',
      to: 'public.invoices',
      fk,
      isNullable: true,
      isSelfRef: false,
    }

    const faker = createSeededFaker(42)
    const updates = generateDeferredUpdates({
      tableName: 'public.orders',
      table,
      generatedRows: rows,
      generatedPKs,
      deferredFKEdges: [cycleEdge],
      referencePool: pool,
      faker,
    })

    expect(updates.length).toBe(3) // All rows get updated
    for (const update of updates) {
      expect(update.setColumns).toEqual(['invoice_id'])
      expect([100, 200, 300]).toContain(update.setValues[0])
      expect(update.pkColumns).toEqual(['id'])
    }
  })

  it('handles PK values correctly in deferred updates', () => {
    const fk = makeFK('cat_parent_fk', ['parent_id'], 'categories')
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const rows = [
      { id: 10, parent_id: null },
      { id: 20, parent_id: null },
    ]
    const generatedPKs = [[10], [20]]

    const pool = new ReferencePoolManager()
    pool.addGenerated('public.categories', generatedPKs)

    const selfRefEdge: DependencyEdge = {
      from: 'public.categories',
      to: 'public.categories',
      fk,
      isNullable: true,
      isSelfRef: true,
    }

    const faker = createSeededFaker(42)
    const updates = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: rows,
      generatedPKs,
      deferredFKEdges: [selfRefEdge],
      referencePool: pool,
      faker,
    })

    for (const update of updates) {
      expect(update.tableName).toBe('public.categories')
      expect(update.pkColumns).toEqual(['id'])
      expect([10, 20]).toContain(update.pkValues[0])
    }
  })

  it('handles single row self-ref (remains NULL)', () => {
    const fk = makeFK('cat_parent_fk', ['parent_id'], 'categories')
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const rows = [{ id: 1, parent_id: null }]
    const generatedPKs = [[1]]

    const pool = new ReferencePoolManager()
    pool.addGenerated('public.categories', generatedPKs)

    const selfRefEdge: DependencyEdge = {
      from: 'public.categories',
      to: 'public.categories',
      fk,
      isNullable: true,
      isSelfRef: true,
    }

    const faker = createSeededFaker(42)
    const updates = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: rows,
      generatedPKs,
      deferredFKEdges: [selfRefEdge],
      referencePool: pool,
      faker,
    })

    // Single row = root node, no updates possible
    expect(updates.length).toBe(0)
  })

  it('is deterministic with same seed', () => {
    const fk = makeFK('cat_parent_fk', ['parent_id'], 'categories')
    const table: TableDef = {
      name: 'categories',
      schema: 'public',
      columns: new Map([
        ['id', makeColumn('id')],
        ['parent_id', makeColumn('parent_id', { isNullable: true })],
      ]),
      primaryKey: { columns: ['id'], name: 'categories_pkey' },
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      parent_id: null,
    }))
    const generatedPKs = rows.map((r) => [r.id])

    const selfRefEdge: DependencyEdge = {
      from: 'public.categories',
      to: 'public.categories',
      fk,
      isNullable: true,
      isSelfRef: true,
    }

    const pool1 = new ReferencePoolManager()
    pool1.addGenerated('public.categories', [...generatedPKs])
    const faker1 = createSeededFaker(55)
    const updates1 = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: [...rows],
      generatedPKs: [...generatedPKs],
      deferredFKEdges: [selfRefEdge],
      referencePool: pool1,
      faker: faker1,
    })

    const pool2 = new ReferencePoolManager()
    pool2.addGenerated('public.categories', [...generatedPKs])
    const faker2 = createSeededFaker(55)
    const updates2 = generateDeferredUpdates({
      tableName: 'public.categories',
      table,
      generatedRows: [...rows],
      generatedPKs: [...generatedPKs],
      deferredFKEdges: [selfRefEdge],
      referencePool: pool2,
      faker: faker2,
    })

    expect(updates1).toEqual(updates2)
  })
})
