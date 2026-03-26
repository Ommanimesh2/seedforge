import { describe, it, expect } from 'vitest'
import { buildInsertPlan, buildDependencyGraph, topologicalSort } from '../index.js'
import type { DatabaseSchema, TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import { GenerationError } from '../../errors/index.js'
import type { InsertPlan, DependencyGraph } from '../types.js'

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

describe('Cross-module integration', () => {
  it('constructs DatabaseSchema using existing types and runs buildInsertPlan', () => {
    const schema: DatabaseSchema = makeSchema([
      makeTable('users', new Map([['id', makeColumn('id')]])),
      makeTable(
        'posts',
        new Map([['id', makeColumn('id')], ['user_id', makeColumn('user_id')]]),
        [makeFK('posts_user_fk', ['user_id'], 'users')],
      ),
    ])

    const plan: InsertPlan = buildInsertPlan(schema)
    expect(plan.ordered).toEqual(['public.users', 'public.posts'])
    expect(plan.deferredEdges).toEqual([])
    expect(plan.selfRefTables).toEqual([])
  })

  it('buildDependencyGraph returns correct DependencyGraph interface', () => {
    const schema: DatabaseSchema = makeSchema([
      makeTable('a', new Map([['id', makeColumn('id')]])),
      makeTable(
        'b',
        new Map([['id', makeColumn('id')], ['a_id', makeColumn('a_id')]]),
        [makeFK('b_a_fk', ['a_id'], 'a')],
      ),
    ])

    const graph: DependencyGraph = buildDependencyGraph(schema)
    expect(graph.nodes).toBeInstanceOf(Set)
    expect(graph.edges).toBeInstanceOf(Array)
    expect(graph.adjacency).toBeInstanceOf(Map)
    expect(graph.inDegree).toBeInstanceOf(Map)
  })

  it('topologicalSort works with graph from buildDependencyGraph', () => {
    const schema: DatabaseSchema = makeSchema([
      makeTable('x', new Map([['id', makeColumn('id')]])),
      makeTable(
        'y',
        new Map([['id', makeColumn('id')], ['x_id', makeColumn('x_id')]]),
        [makeFK('y_x_fk', ['x_id'], 'x')],
      ),
    ])

    const graph = buildDependencyGraph(schema)
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual(['public.x', 'public.y'])
    expect(remaining).toEqual([])
  })

  it('throws GenerationError with code SF3001 for unresolvable cycles', () => {
    const schema: DatabaseSchema = makeSchema([
      makeTable(
        'a',
        new Map([['id', makeColumn('id')], ['b_id', makeColumn('b_id')]]),
        [makeFK('a_b_fk', ['b_id'], 'b')],
      ),
      makeTable(
        'b',
        new Map([['id', makeColumn('id')], ['a_id', makeColumn('a_id')]]),
        [makeFK('b_a_fk', ['a_id'], 'a')],
      ),
    ])

    try {
      buildInsertPlan(schema)
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationError)
      const genErr = err as GenerationError
      expect(genErr.code).toBe('SF3001')
      expect(genErr.message).toContain('circular dependency')
    }
  })

  it('full pipeline with all features: linear, diamond, self-ref, cycle', () => {
    const schema: DatabaseSchema = makeSchema([
      // Base tables
      makeTable('users', new Map([['id', makeColumn('id')]])),
      makeTable('products', new Map([['id', makeColumn('id')]])),

      // Diamond: orders depends on users, order_items depends on orders and products
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

      // Self-ref
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

    // All 5 tables present
    expect(plan.ordered.length).toBe(5)

    // Ordering constraints
    const usersIdx = plan.ordered.indexOf('public.users')
    const ordersIdx = plan.ordered.indexOf('public.orders')
    const productsIdx = plan.ordered.indexOf('public.products')
    const itemsIdx = plan.ordered.indexOf('public.order_items')

    expect(usersIdx).toBeLessThan(ordersIdx)
    expect(ordersIdx).toBeLessThan(itemsIdx)
    expect(productsIdx).toBeLessThan(itemsIdx)

    // Self-ref detected
    expect(plan.selfRefTables).toContain('public.categories')

    // No cycles in this schema
    expect(plan.deferredEdges).toEqual([])
  })
})
