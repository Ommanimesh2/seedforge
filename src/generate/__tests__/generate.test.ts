import { describe, it, expect } from 'vitest'
import { generate } from '../generate.js'
import { buildInsertPlan } from '../../graph/plan.js'
import type { DatabaseSchema, TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'

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

function makeTable(
  name: string,
  columns: Map<string, ColumnDef>,
  foreignKeys: ForeignKeyDef[] = [],
  overrides: Partial<TableDef> = {},
): TableDef {
  return {
    name,
    schema: 'public',
    columns,
    primaryKey: { columns: ['id'], name: `${name}_pkey` },
    foreignKeys,
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
    ...overrides,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const table of tables) {
    tableMap.set(`${table.schema}.${table.name}`, table)
  }
  return {
    name: 'test_db',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('generate (orchestrator)', () => {
  it('generates rows for a single table with no FKs (null client)', async () => {
    const schema = makeSchema([
      makeTable('items', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    expect(result.tables.size).toBe(1)
    expect(result.tables.get('public.items')!.rows.length).toBe(5)
    expect(result.deferredUpdates.length).toBe(0)
  })

  it('handles linear chain (users -> posts): FK references are valid', async () => {
    const schema = makeSchema([
      makeTable('users', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ])),
      makeTable(
        'posts',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
          ['title', makeColumn('title', { dataType: NormalizedType.VARCHAR })],
        ]),
        [makeFK('posts_user_fk', ['user_id'], 'users', {
          referencedColumns: ['id'],
        })],
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    expect(result.tables.size).toBe(2)

    const userPKs = result.tables.get('public.users')!.generatedPKs.map((pk) => pk[0])
    const posts = result.tables.get('public.posts')!.rows

    for (const post of posts) {
      expect(userPKs).toContain(post.user_id)
    }
  })

  it('handles self-referencing table with deferred updates', async () => {
    const schema = makeSchema([
      makeTable(
        'categories',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
          ['parent_id', makeColumn('parent_id', {
            dataType: NormalizedType.UUID,
            isNullable: true,
          })],
        ]),
        [makeFK('cat_parent_fk', ['parent_id'], 'categories', {
          referencedColumns: ['id'],
        })],
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    const catRows = result.tables.get('public.categories')!.rows

    // All parent_id should be NULL in rows (deferred)
    for (const row of catRows) {
      expect(row.parent_id).toBeNull()
    }

    // Deferred updates should exist
    expect(result.deferredUpdates.length).toBeGreaterThan(0)

    // Verify deferred updates reference valid PKs
    const catPKs = new Set(
      result.tables.get('public.categories')!.generatedPKs.map((pk) => String(pk[0])),
    )
    for (const update of result.deferredUpdates) {
      expect(catPKs.has(String(update.pkValues[0]))).toBe(true)
      expect(catPKs.has(String(update.setValues[0]))).toBe(true)
    }
  })

  it('handles cycle-broken edge with deferred updates', async () => {
    const schema = makeSchema([
      makeTable(
        'a',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['b_id', makeColumn('b_id', {
            dataType: NormalizedType.UUID,
            isNullable: true,
          })],
        ]),
        [makeFK('a_b_fk', ['b_id'], 'b', { referencedColumns: ['id'] })],
      ),
      makeTable(
        'b',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['a_id', makeColumn('a_id', { dataType: NormalizedType.UUID })],
        ]),
        [makeFK('b_a_fk', ['a_id'], 'a', { referencedColumns: ['id'] })],
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    expect(result.tables.size).toBe(2)
    // There should be deferred updates for the cycle-broken edge
    expect(result.deferredUpdates.length).toBeGreaterThan(0)
  })

  it('applies configurable row count (global and per-table)', async () => {
    const schema = makeSchema([
      makeTable('users', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ])),
      makeTable('posts', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      tableRowCounts: new Map([['public.users', 3]]),
      seed: 42,
    })

    expect(result.tables.get('public.users')!.rows.length).toBe(3)
    expect(result.tables.get('public.posts')!.rows.length).toBe(10)
  })

  it('generates unique values for unique columns', async () => {
    const schema = makeSchema([
      makeTable(
        'users',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['username', makeColumn('username', { dataType: NormalizedType.VARCHAR })],
        ]),
        [],
        {
          uniqueConstraints: [{ columns: ['username'], name: 'users_username_key' }],
        },
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 30,
      seed: 42,
    })

    const usernames = result.tables.get('public.users')!.rows.map((r) => r.username)
    const uniqueUsernames = new Set(usernames)
    expect(uniqueUsernames.size).toBe(usernames.length)
  })

  it('ensures timestamp ordering: created_at < updated_at', async () => {
    const schema = makeSchema([
      makeTable('posts', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    for (const row of result.tables.get('public.posts')!.rows) {
      const created = row.created_at as Date
      const updated = row.updated_at as Date
      expect(created.getTime()).toBeLessThanOrEqual(updated.getTime())
    }
  })

  it('generates valid UUIDs for UUID PKs', async () => {
    const schema = makeSchema([
      makeTable('items', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const row of result.tables.get('public.items')!.rows) {
      expect(String(row.id)).toMatch(uuidRegex)
    }
  })

  it('generates {} for JSON/JSONB columns', async () => {
    const schema = makeSchema([
      makeTable('configs', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['settings', makeColumn('settings', { dataType: NormalizedType.JSONB })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 3,
      seed: 42,
    })

    for (const row of result.tables.get('public.configs')!.rows) {
      expect(row.settings).toEqual({})
    }
  })

  it('propagates plan warnings', async () => {
    const schema = makeSchema([
      makeTable(
        'categories',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['parent_id', makeColumn('parent_id', {
            dataType: NormalizedType.UUID,
            isNullable: true,
          })],
        ]),
        [makeFK('cat_parent_fk', ['parent_id'], 'categories', {
          referencedColumns: ['id'],
        })],
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    expect(result.warnings.some((w) => w.includes('Self-referencing'))).toBe(true)
  })

  it('produces deterministic output with same seed', async () => {
    const schema = makeSchema([
      makeTable('items', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ])),
    ])

    const plan = buildInsertPlan(schema)

    const result1 = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 77,
    })
    const result2 = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 77,
    })

    expect(result1.tables.get('public.items')!.rows).toEqual(
      result2.tables.get('public.items')!.rows,
    )
  })

  it('handles empty schema without errors', async () => {
    const schema = makeSchema([])
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, { seed: 42 })

    expect(result.tables.size).toBe(0)
    expect(result.deferredUpdates.length).toBe(0)
    expect(result.warnings.length).toBe(0)
  })

  it('handles diamond dependency: all FK references are valid', async () => {
    const schema = makeSchema([
      makeTable('users', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ])),
      makeTable('products', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ])),
      makeTable(
        'orders',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
        ]),
        [makeFK('orders_user_fk', ['user_id'], 'users', {
          referencedColumns: ['id'],
        })],
      ),
      makeTable(
        'order_items',
        new Map([
          ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
          ['order_id', makeColumn('order_id', { dataType: NormalizedType.UUID })],
          ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
        ]),
        [
          makeFK('items_order_fk', ['order_id'], 'orders', {
            referencedColumns: ['id'],
          }),
          makeFK('items_product_fk', ['product_id'], 'products', {
            referencedColumns: ['id'],
          }),
        ],
      ),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    const userPKs = new Set(result.tables.get('public.users')!.generatedPKs.map((pk) => pk[0]))
    const productPKs = new Set(result.tables.get('public.products')!.generatedPKs.map((pk) => pk[0]))
    const orderPKs = new Set(result.tables.get('public.orders')!.generatedPKs.map((pk) => pk[0]))

    for (const row of result.tables.get('public.orders')!.rows) {
      expect(userPKs.has(row.user_id)).toBe(true)
    }
    for (const row of result.tables.get('public.order_items')!.rows) {
      expect(orderPKs.has(row.order_id)).toBe(true)
      expect(productPKs.has(row.product_id)).toBe(true)
    }
  })

  it('handles table with all common column types', async () => {
    const schema = makeSchema([
      makeTable('kitchen_sink', new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['text_col', makeColumn('text_col', { dataType: NormalizedType.TEXT })],
        ['varchar_col', makeColumn('varchar_col', { dataType: NormalizedType.VARCHAR, maxLength: 100 })],
        ['int_col', makeColumn('int_col', { dataType: NormalizedType.INTEGER })],
        ['bigint_col', makeColumn('bigint_col', { dataType: NormalizedType.BIGINT })],
        ['bool_col', makeColumn('bool_col', { dataType: NormalizedType.BOOLEAN })],
        ['date_col', makeColumn('date_col', { dataType: NormalizedType.DATE })],
        ['timestamp_col', makeColumn('timestamp_col', { dataType: NormalizedType.TIMESTAMP })],
        ['json_col', makeColumn('json_col', { dataType: NormalizedType.JSON })],
        ['jsonb_col', makeColumn('jsonb_col', { dataType: NormalizedType.JSONB })],
        ['decimal_col', makeColumn('decimal_col', { dataType: NormalizedType.DECIMAL, numericPrecision: 10, numericScale: 2 })],
        ['real_col', makeColumn('real_col', { dataType: NormalizedType.REAL })],
        ['inet_col', makeColumn('inet_col', { dataType: NormalizedType.INET })],
      ])),
    ])

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 3,
      seed: 42,
    })

    expect(result.tables.get('public.kitchen_sink')!.rows.length).toBe(3)
    for (const row of result.tables.get('public.kitchen_sink')!.rows) {
      expect(row.id).toBeDefined()
      expect(row.text_col).toBeDefined()
      expect(row.json_col).toEqual({})
      expect(row.jsonb_col).toEqual({})
    }
  })
})
