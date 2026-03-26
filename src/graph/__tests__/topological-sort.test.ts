import { describe, it, expect } from 'vitest'
import { topologicalSort } from '../topological-sort.js'
import { buildDependencyGraph } from '../build-graph.js'
import type { DatabaseSchema, TableDef, ColumnDef, ForeignKeyDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { DependencyGraph } from '../types.js'

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

describe('topologicalSort', () => {
  it('handles empty graph', () => {
    const graph: DependencyGraph = {
      nodes: new Set(),
      edges: [],
      adjacency: new Map(),
      inDegree: new Map(),
    }
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual([])
    expect(remaining).toEqual([])
  })

  it('handles single node', () => {
    const graph: DependencyGraph = {
      nodes: new Set(['public.users']),
      edges: [],
      adjacency: new Map([['public.users', new Set()]]),
      inDegree: new Map([['public.users', 0]]),
    }
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual(['public.users'])
    expect(remaining).toEqual([])
  })

  it('handles linear chain (A -> B -> C): dependencies first', () => {
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
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual(['public.c', 'public.b', 'public.a'])
    expect(remaining).toEqual([])
  })

  it('handles diamond dependency with alphabetical tie-breaking', () => {
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
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted[0]).toBe('public.d')
    expect(sorted[sorted.length - 1]).toBe('public.a')
    // B and C in the middle, alphabetical order
    expect(sorted[1]).toBe('public.b')
    expect(sorted[2]).toBe('public.c')
    expect(remaining).toEqual([])
  })

  it('handles independent tables in alphabetical order', () => {
    const schema = makeSchema([
      makeTable('charlie', new Map([['id', makeColumn('id')]])),
      makeTable('alpha', new Map([['id', makeColumn('id')]])),
      makeTable('bravo', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual(['public.alpha', 'public.bravo', 'public.charlie'])
    expect(remaining).toEqual([])
  })

  it('detects simple cycle (A -> B -> A)', () => {
    // Build graph manually to create a cycle
    const graph: DependencyGraph = {
      nodes: new Set(['public.a', 'public.b']),
      edges: [],
      adjacency: new Map([
        ['public.a', new Set(['public.b'])],
        ['public.b', new Set(['public.a'])],
      ]),
      inDegree: new Map([
        ['public.a', 1],
        ['public.b', 1],
      ]),
    }
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual([])
    expect(remaining).toEqual(['public.a', 'public.b'])
  })

  it('handles cycle with tail (C -> A, A -> B -> A)', () => {
    // C depends on nothing, A and B form a cycle
    // C should be sorted, A and B should remain
    const graph: DependencyGraph = {
      nodes: new Set(['public.a', 'public.b', 'public.c']),
      edges: [],
      adjacency: new Map([
        ['public.a', new Set(['public.b'])],
        ['public.b', new Set(['public.a'])],
        ['public.c', new Set()],
      ]),
      inDegree: new Map([
        ['public.a', 1],
        ['public.b', 1],
        ['public.c', 0],
      ]),
    }
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted).toEqual(['public.c'])
    expect(remaining).toEqual(['public.a', 'public.b'])
  })

  it('handles large linear chain (10 tables)', () => {
    const tables: TableDef[] = []
    for (let i = 0; i < 10; i++) {
      const name = `t${String(i).padStart(2, '0')}`
      const cols = new Map([['id', makeColumn('id')]])
      const fks: ForeignKeyDef[] = []
      if (i > 0) {
        const prevName = `t${String(i - 1).padStart(2, '0')}`
        cols.set('prev_id', makeColumn('prev_id'))
        fks.push(makeFK(`${name}_fk`, ['prev_id'], prevName))
      }
      tables.push(makeTable(name, cols, fks))
    }
    const schema = makeSchema(tables)
    const graph = buildDependencyGraph(schema)
    const { sorted, remaining } = topologicalSort(graph)
    expect(sorted.length).toBe(10)
    expect(remaining.length).toBe(0)
    // t00 should be first (no deps), t09 should be last
    expect(sorted[0]).toBe('public.t00')
    expect(sorted[9]).toBe('public.t09')
  })

  it('produces deterministic output over 100 runs', () => {
    const schema = makeSchema([
      makeTable(
        'x',
        new Map([['id', makeColumn('id')], ['y_id', makeColumn('y_id')]]),
        [makeFK('x_y_fk', ['y_id'], 'y')],
      ),
      makeTable(
        'y',
        new Map([['id', makeColumn('id')], ['z_id', makeColumn('z_id')]]),
        [makeFK('y_z_fk', ['z_id'], 'z')],
      ),
      makeTable('z', new Map([['id', makeColumn('id')]])),
      makeTable('w', new Map([['id', makeColumn('id')]])),
    ])
    const graph = buildDependencyGraph(schema)
    const firstResult = topologicalSort(graph)

    for (let i = 0; i < 100; i++) {
      const result = topologicalSort(graph)
      expect(result.sorted).toEqual(firstResult.sorted)
      expect(result.remaining).toEqual(firstResult.remaining)
    }
  })
})
