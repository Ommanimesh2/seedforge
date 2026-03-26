import { describe, it, expect } from 'vitest'
import { buildDependencyGraph } from '../build-graph.js'
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

describe('buildDependencyGraph', () => {
  it('handles empty schema', () => {
    const schema = makeSchema([])
    const graph = buildDependencyGraph(schema)
    expect(graph.nodes.size).toBe(0)
    expect(graph.edges.length).toBe(0)
  })

  it('handles single table with no FKs', () => {
    const schema = makeSchema([
      makeTable('users', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.nodes.size).toBe(1)
    expect(graph.nodes.has('public.users')).toBe(true)
    expect(graph.edges.length).toBe(0)
    expect(graph.inDegree.get('public.users')).toBe(0)
  })

  it('handles linear chain (A -> B -> C)', () => {
    const schema = makeSchema([
      makeTable(
        'a',
        new Map([['id', makeColumn('id')], ['b_id', makeColumn('b_id')]]),
        [makeFK('a_b_fk', ['b_id'], 'b')],
      ),
      makeTable(
        'b',
        new Map([['id', makeColumn('id')], ['c_id', makeColumn('c_id')]]),
        [makeFK('b_c_fk', ['c_id'], 'c')],
      ),
      makeTable('c', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.nodes.size).toBe(3)
    expect(graph.edges.length).toBe(2)
    // A depends on B (in-degree 1), B depends on C (in-degree 1), C has no deps (in-degree 0)
    expect(graph.inDegree.get('public.a')).toBe(1)
    expect(graph.inDegree.get('public.b')).toBe(1)
    expect(graph.inDegree.get('public.c')).toBe(0)
  })

  it('handles diamond dependency (A -> B, A -> C, B -> D, C -> D)', () => {
    const schema = makeSchema([
      makeTable(
        'a',
        new Map([['id', makeColumn('id')], ['b_id', makeColumn('b_id')], ['c_id', makeColumn('c_id')]]),
        [makeFK('a_b_fk', ['b_id'], 'b'), makeFK('a_c_fk', ['c_id'], 'c')],
      ),
      makeTable(
        'b',
        new Map([['id', makeColumn('id')], ['d_id', makeColumn('d_id')]]),
        [makeFK('b_d_fk', ['d_id'], 'd')],
      ),
      makeTable(
        'c',
        new Map([['id', makeColumn('id')], ['d_id', makeColumn('d_id')]]),
        [makeFK('c_d_fk', ['d_id'], 'd')],
      ),
      makeTable('d', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.nodes.size).toBe(4)
    expect(graph.edges.length).toBe(4)
    expect(graph.inDegree.get('public.a')).toBe(2)
    expect(graph.inDegree.get('public.b')).toBe(1)
    expect(graph.inDegree.get('public.c')).toBe(1)
    expect(graph.inDegree.get('public.d')).toBe(0)
    expect(graph.adjacency.get('public.a')!.has('public.b')).toBe(true)
    expect(graph.adjacency.get('public.a')!.has('public.c')).toBe(true)
  })

  it('handles self-referencing FK', () => {
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
    const graph = buildDependencyGraph(schema)
    expect(graph.nodes.size).toBe(1)
    expect(graph.edges.length).toBe(1)
    expect(graph.edges[0].isSelfRef).toBe(true)
    // Self-ref edges should NOT affect adjacency/inDegree
    expect(graph.adjacency.get('public.categories')!.size).toBe(0)
    expect(graph.inDegree.get('public.categories')).toBe(0)
  })

  it('detects nullable FK columns', () => {
    const schema = makeSchema([
      makeTable(
        'orders',
        new Map([
          ['id', makeColumn('id')],
          ['user_id', makeColumn('user_id', { isNullable: true })],
        ]),
        [makeFK('orders_user_fk', ['user_id'], 'users')],
      ),
      makeTable('users', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.edges[0].isNullable).toBe(true)
  })

  it('detects non-nullable FK columns', () => {
    const schema = makeSchema([
      makeTable(
        'orders',
        new Map([
          ['id', makeColumn('id')],
          ['user_id', makeColumn('user_id', { isNullable: false })],
        ]),
        [makeFK('orders_user_fk', ['user_id'], 'users')],
      ),
      makeTable('users', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.edges[0].isNullable).toBe(false)
  })

  it('skips FKs to tables not in schema (missing referenced table)', () => {
    const schema = makeSchema([
      makeTable(
        'orders',
        new Map([
          ['id', makeColumn('id')],
          ['ext_id', makeColumn('ext_id')],
        ]),
        [makeFK('orders_ext_fk', ['ext_id'], 'external_table', { referencedSchema: 'other' })],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.edges.length).toBe(0)
  })

  it('handles multiple FKs between same pair of tables', () => {
    const schema = makeSchema([
      makeTable(
        'orders',
        new Map([
          ['id', makeColumn('id')],
          ['created_by', makeColumn('created_by')],
          ['approved_by', makeColumn('approved_by')],
        ]),
        [
          makeFK('orders_created_fk', ['created_by'], 'users'),
          makeFK('orders_approved_fk', ['approved_by'], 'users'),
        ],
      ),
      makeTable('users', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.edges.length).toBe(2)
    // Adjacency deduplicates: only one entry from orders -> users
    expect(graph.adjacency.get('public.orders')!.size).toBe(1)
    // inDegree should be 1 (not 2), since adjacency deduplicates
    expect(graph.inDegree.get('public.orders')).toBe(1)
  })

  it('handles composite FK — isNullable only if ALL columns are nullable', () => {
    const schema = makeSchema([
      makeTable(
        'order_items',
        new Map([
          ['id', makeColumn('id')],
          ['order_id', makeColumn('order_id', { isNullable: false })],
          ['product_id', makeColumn('product_id', { isNullable: true })],
        ]),
        [makeFK('composite_fk', ['order_id', 'product_id'], 'orders', { referencedColumns: ['id', 'product_id'] })],
      ),
      makeTable('orders', new Map([['id', makeColumn('id')], ['product_id', makeColumn('product_id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    // Not all columns are nullable, so isNullable should be false
    expect(graph.edges[0].isNullable).toBe(false)
  })

  it('composite FK is nullable when ALL columns are nullable', () => {
    const schema = makeSchema([
      makeTable(
        'order_items',
        new Map([
          ['id', makeColumn('id')],
          ['order_id', makeColumn('order_id', { isNullable: true })],
          ['product_id', makeColumn('product_id', { isNullable: true })],
        ]),
        [makeFK('composite_fk', ['order_id', 'product_id'], 'orders', { referencedColumns: ['id', 'product_id'] })],
      ),
      makeTable('orders', new Map([['id', makeColumn('id')], ['product_id', makeColumn('product_id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    expect(graph.edges[0].isNullable).toBe(true)
  })
})
