import { describe, it, expect } from 'vitest'
import { buildInsertPlan } from '../plan.js'
import type { DatabaseSchema, TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
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

function makeTable(
  name: string,
  columns: Map<string, ColumnDef>,
  foreignKeys: ForeignKeyDef[] = [],
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

describe('buildInsertPlan', () => {
  it('orders simple blog schema (users -> posts -> comments)', () => {
    const schema = makeSchema([
      makeTable('users', new Map([['id', makeColumn('id')]])),
      makeTable(
        'posts',
        new Map([['id', makeColumn('id')], ['user_id', makeColumn('user_id')]]),
        [makeFK('posts_user_fk', ['user_id'], 'users')],
      ),
      makeTable(
        'comments',
        new Map([['id', makeColumn('id')], ['post_id', makeColumn('post_id')]]),
        [makeFK('comments_post_fk', ['post_id'], 'posts')],
      ),
    ])

    const plan = buildInsertPlan(schema)
    expect(plan.ordered).toEqual(['public.users', 'public.posts', 'public.comments'])
    expect(plan.deferredEdges).toEqual([])
    expect(plan.selfRefTables).toEqual([])
  })

  it('handles e-commerce diamond (users, products, orders -> order_items)', () => {
    const schema = makeSchema([
      makeTable('users', new Map([['id', makeColumn('id')]])),
      makeTable('products', new Map([['id', makeColumn('id')]])),
      makeTable(
        'orders',
        new Map([['id', makeColumn('id')], ['user_id', makeColumn('user_id')]]),
        [makeFK('orders_user_fk', ['user_id'], 'users')],
      ),
      makeTable(
        'order_items',
        new Map([
          ['id', makeColumn('id')],
          ['order_id', makeColumn('order_id')],
          ['product_id', makeColumn('product_id')],
        ]),
        [
          makeFK('items_order_fk', ['order_id'], 'orders'),
          makeFK('items_product_fk', ['product_id'], 'products'),
        ],
      ),
    ])

    const plan = buildInsertPlan(schema)
    // order_items must come after both orders and products
    const orderItemsIdx = plan.ordered.indexOf('public.order_items')
    const ordersIdx = plan.ordered.indexOf('public.orders')
    const productsIdx = plan.ordered.indexOf('public.products')
    const usersIdx = plan.ordered.indexOf('public.users')

    expect(usersIdx).toBeLessThan(ordersIdx)
    expect(ordersIdx).toBeLessThan(orderItemsIdx)
    expect(productsIdx).toBeLessThan(orderItemsIdx)
  })

  it('handles self-referencing categories', () => {
    const schema = makeSchema([
      makeTable(
        'categories',
        new Map([
          ['id', makeColumn('id')],
          ['parent_id', makeColumn('parent_id', { isNullable: true })],
        ]),
        [makeFK('cat_parent_fk', ['parent_id'], 'categories')],
      ),
    ])

    const plan = buildInsertPlan(schema)
    expect(plan.ordered).toContain('public.categories')
    expect(plan.selfRefTables).toEqual(['public.categories'])
    expect(plan.warnings.some((w) => w.includes('Self-referencing'))).toBe(true)
  })

  it('resolves cycle with nullable FK edge', () => {
    const schema = makeSchema([
      makeTable(
        'a',
        new Map([
          ['id', makeColumn('id')],
          ['b_id', makeColumn('b_id', { isNullable: true })],
        ]),
        [makeFK('a_b_fk', ['b_id'], 'b')],
      ),
      makeTable(
        'b',
        new Map([
          ['id', makeColumn('id')],
          ['a_id', makeColumn('a_id')],
        ]),
        [makeFK('b_a_fk', ['a_id'], 'a')],
      ),
    ])

    const plan = buildInsertPlan(schema)
    expect(plan.ordered.length).toBe(2)
    expect(plan.ordered).toContain('public.a')
    expect(plan.ordered).toContain('public.b')
    expect(plan.deferredEdges.length).toBe(1)
    expect(plan.warnings.some((w) => w.includes('Cycle broken'))).toBe(true)
  })

  it('throws GenerationError SF3001 for unresolvable cycle', () => {
    const schema = makeSchema([
      makeTable(
        'a',
        new Map([
          ['id', makeColumn('id')],
          ['b_id', makeColumn('b_id')], // NOT nullable
        ]),
        [makeFK('a_b_fk', ['b_id'], 'b')],
      ),
      makeTable(
        'b',
        new Map([
          ['id', makeColumn('id')],
          ['a_id', makeColumn('a_id')], // NOT nullable
        ]),
        [makeFK('b_a_fk', ['a_id'], 'a')],
      ),
    ])

    expect(() => buildInsertPlan(schema)).toThrow(GenerationError)
    try {
      buildInsertPlan(schema)
    } catch (err) {
      const genErr = err as GenerationError
      expect(genErr.code).toBe('SF3001')
      expect(genErr.message).toContain('circular dependency')
    }
  })

  it('handles mixed graph: linear deps, diamond, self-ref, and resolvable cycle', () => {
    const schema = makeSchema([
      // Linear: users -> posts
      makeTable('users', new Map([['id', makeColumn('id')]])),
      makeTable(
        'posts',
        new Map([['id', makeColumn('id')], ['user_id', makeColumn('user_id')]]),
        [makeFK('posts_user_fk', ['user_id'], 'users')],
      ),
      // Self-ref: categories
      makeTable(
        'categories',
        new Map([
          ['id', makeColumn('id')],
          ['parent_id', makeColumn('parent_id', { isNullable: true })],
        ]),
        [makeFK('cat_parent_fk', ['parent_id'], 'categories')],
      ),
      // Resolvable cycle: x <-> y (x.y_id is nullable)
      makeTable(
        'x',
        new Map([
          ['id', makeColumn('id')],
          ['y_id', makeColumn('y_id', { isNullable: true })],
        ]),
        [makeFK('x_y_fk', ['y_id'], 'y')],
      ),
      makeTable(
        'y',
        new Map([
          ['id', makeColumn('id')],
          ['x_id', makeColumn('x_id')],
        ]),
        [makeFK('y_x_fk', ['x_id'], 'x')],
      ),
    ])

    const plan = buildInsertPlan(schema)
    expect(plan.ordered.length).toBe(5)
    expect(plan.selfRefTables).toContain('public.categories')
    expect(plan.deferredEdges.length).toBe(1)

    // Verify ordering constraints
    const usersIdx = plan.ordered.indexOf('public.users')
    const postsIdx = plan.ordered.indexOf('public.posts')
    expect(usersIdx).toBeLessThan(postsIdx)
  })

  it('orders independent tables alphabetically', () => {
    const schema = makeSchema([
      makeTable('zebra', new Map([['id', makeColumn('id')]])),
      makeTable('alpha', new Map([['id', makeColumn('id')]])),
      makeTable('middle', new Map([['id', makeColumn('id')]])),
    ])

    const plan = buildInsertPlan(schema)
    expect(plan.ordered).toEqual([
      'public.alpha',
      'public.middle',
      'public.zebra',
    ])
  })

  it('handles schema with 20+ tables', () => {
    const tables: TableDef[] = []
    // Create 25 tables in a chain
    for (let i = 0; i < 25; i++) {
      const name = `table_${String(i).padStart(2, '0')}`
      const cols = new Map([['id', makeColumn('id')]])
      const fks: ForeignKeyDef[] = []
      if (i > 0) {
        const prevName = `table_${String(i - 1).padStart(2, '0')}`
        cols.set('prev_id', makeColumn('prev_id'))
        fks.push(makeFK(`${name}_fk`, ['prev_id'], prevName))
      }
      tables.push(makeTable(name, cols, fks))
    }
    const schema = makeSchema(tables)

    const plan = buildInsertPlan(schema)
    expect(plan.ordered.length).toBe(25)
    expect(plan.ordered[0]).toBe('public.table_00')
    expect(plan.ordered[24]).toBe('public.table_24')
  })

  it('handles empty schema', () => {
    const schema = makeSchema([])
    const plan = buildInsertPlan(schema)
    expect(plan.ordered).toEqual([])
    expect(plan.deferredEdges).toEqual([])
    expect(plan.selfRefTables).toEqual([])
    expect(plan.warnings).toEqual([])
  })
})
