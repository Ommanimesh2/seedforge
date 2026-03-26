import { describe, it, expect } from 'vitest'
import { findSelfReferencingTables } from '../self-ref.js'
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

describe('findSelfReferencingTables', () => {
  it('returns empty map when no self-refs exist', () => {
    const schema = makeSchema([
      makeTable(
        'users',
        new Map([['id', makeColumn('id')]]),
      ),
      makeTable(
        'posts',
        new Map([['id', makeColumn('id')], ['user_id', makeColumn('user_id')]]),
        [makeFK('posts_user_fk', ['user_id'], 'users')],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    expect(result.size).toBe(0)
  })

  it('detects single self-referencing FK (employees.manager_id)', () => {
    const schema = makeSchema([
      makeTable(
        'employees',
        new Map([
          ['id', makeColumn('id')],
          ['manager_id', makeColumn('manager_id', { isNullable: true })],
        ]),
        [makeFK('emp_manager_fk', ['manager_id'], 'employees')],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    expect(result.size).toBe(1)
    expect(result.has('public.employees')).toBe(true)
    const edges = result.get('public.employees')!
    expect(edges.length).toBe(1)
    expect(edges[0].isSelfRef).toBe(true)
  })

  it('detects multiple self-ref FKs on one table', () => {
    const schema = makeSchema([
      makeTable(
        'categories',
        new Map([
          ['id', makeColumn('id')],
          ['parent_id', makeColumn('parent_id', { isNullable: true })],
          ['root_id', makeColumn('root_id', { isNullable: true })],
        ]),
        [
          makeFK('cat_parent_fk', ['parent_id'], 'categories'),
          makeFK('cat_root_fk', ['root_id'], 'categories'),
        ],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    expect(result.size).toBe(1)
    const edges = result.get('public.categories')!
    expect(edges.length).toBe(2)
  })

  it('detects nullable self-ref FK as valid for NULL-then-UPDATE', () => {
    const schema = makeSchema([
      makeTable(
        'employees',
        new Map([
          ['id', makeColumn('id')],
          ['manager_id', makeColumn('manager_id', { isNullable: true })],
        ]),
        [makeFK('emp_manager_fk', ['manager_id'], 'employees')],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    const edges = result.get('public.employees')!
    expect(edges[0].isNullable).toBe(true)
  })

  it('detects non-nullable self-ref FK', () => {
    const schema = makeSchema([
      makeTable(
        'nodes',
        new Map([
          ['id', makeColumn('id')],
          ['parent_id', makeColumn('parent_id', { isNullable: false })],
        ]),
        [makeFK('nodes_parent_fk', ['parent_id'], 'nodes')],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    const edges = result.get('public.nodes')!
    expect(edges[0].isNullable).toBe(false)
  })

  it('detects deferrable self-ref FK', () => {
    const schema = makeSchema([
      makeTable(
        'nodes',
        new Map([
          ['id', makeColumn('id')],
          ['parent_id', makeColumn('parent_id', { isNullable: false })],
        ]),
        [makeFK('nodes_parent_fk', ['parent_id'], 'nodes', { isDeferrable: true })],
      ),
    ])
    const graph = buildDependencyGraph(schema)
    const result = findSelfReferencingTables(graph)
    const edges = result.get('public.nodes')!
    expect(edges[0].fk.isDeferrable).toBe(true)
  })
})
