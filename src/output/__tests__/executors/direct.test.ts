import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeDirect } from '../../executors/direct.js'
import type { GenerationResult } from '../../../generate/types.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../../types/schema.js'
import type { OutputOptions } from '../../types.js'
import { OutputMode } from '../../types.js'
import { ProgressReporter } from '../../progress.js'
import { InsertionError } from '../../../errors/index.js'
import { NormalizedType, FKAction } from '../../../types/schema.js'

function makeColumn(name: string, overrides?: Partial<ColumnDef>): ColumnDef {
  return {
    name,
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
    isNullable: true,
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

function makeTable(name: string, schemaName: string, columnNames: string[]): TableDef {
  const columns = new Map<string, ColumnDef>()
  for (const col of columnNames) {
    columns.set(col, makeColumn(col, col === 'id' ? { isAutoIncrement: true, dataType: NormalizedType.INTEGER } : {}))
  }
  return {
    name,
    schema: schemaName,
    columns,
    primaryKey: { columns: ['id'], name: `${name}_pkey` },
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const t of tables) {
    tableMap.set(`${t.schema}.${t.name}`, t)
  }
  return {
    name: 'testdb',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

function makeGenerationResult(
  tableData: Array<{ name: string; rows: Record<string, unknown>[] }>,
  deferredUpdates: GenerationResult['deferredUpdates'] = [],
): GenerationResult {
  const tables = new Map<string, { tableName: string; rows: Record<string, unknown>[]; generatedPKs: unknown[][] }>()
  for (const t of tableData) {
    tables.set(t.name, {
      tableName: t.name,
      rows: t.rows,
      generatedPKs: t.rows.map((r) => [r.id]),
    })
  }
  return { tables, deferredUpdates, warnings: [] }
}

describe('executeDirect', () => {
  let mockClient: { query: ReturnType<typeof vi.fn> }
  let progress: ProgressReporter

  beforeEach(() => {
    mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    progress = new ProgressReporter({ quiet: true, showProgress: false })
  })

  it('inserts rows for 2 tables with correct transaction wrapping', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const postsTable = makeTable('posts', 'public', ['id', 'title'])
    const schema = makeSchema([usersTable, postsTable])

    const genResult = makeGenerationResult([
      {
        name: 'public.users',
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
      {
        name: 'public.posts',
        rows: [
          { id: 1, title: 'Hello' },
          { id: 2, title: 'World' },
        ],
      },
    ])

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    const summary = await executeDirect(
      genResult,
      schema,
      ['public.users', 'public.posts'],
      options,
      progress,
    )

    expect(summary.tablesSeeded).toBe(2)
    expect(summary.totalRowsInserted).toBe(4)
    expect(summary.rowsPerTable.get('public.users')).toBe(2)
    expect(summary.rowsPerTable.get('public.posts')).toBe(2)
    expect(summary.mode).toBe(OutputMode.DIRECT)

    // Verify transaction calls: BEGIN, INSERT, COMMIT for each table
    const queryCalls = mockClient.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queryCalls.filter((q: string) => q === 'BEGIN').length).toBe(2)
    expect(queryCalls.filter((q: string) => q === 'COMMIT').length).toBe(2)
  })

  it('batches rows correctly', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])

    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      name: `user${i + 1}`,
    }))
    const genResult = makeGenerationResult([{ name: 'public.users', rows }])

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 100,
      showProgress: false,
      quiet: true,
    }

    const summary = await executeDirect(
      genResult,
      schema,
      ['public.users'],
      options,
      progress,
    )

    expect(summary.totalRowsInserted).toBe(250)
    // BEGIN + 3 batches (100, 100, 50) + COMMIT = 5 queries per table
    // Plus sequence query attempts
    const insertCalls = mockClient.query.mock.calls.filter((c: unknown[]) =>
      String(c[0]).startsWith('INSERT'),
    )
    expect(insertCalls.length).toBe(3)
  })

  it('skips tables with 0 rows', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])

    const genResult = makeGenerationResult([{ name: 'public.users', rows: [] }])

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    const summary = await executeDirect(
      genResult,
      schema,
      ['public.users'],
      options,
      progress,
    )

    expect(summary.tablesSeeded).toBe(0)
    expect(summary.totalRowsInserted).toBe(0)
    // No BEGIN/COMMIT for inserts (though sequences may be queried)
    const queryCalls = mockClient.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queryCalls.filter((q: string) => q === 'BEGIN').length).toBe(0)
  })

  it('applies deferred updates after all INSERTs', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name', 'parent_id'])
    usersTable.foreignKeys = [
      {
        name: 'users_parent_fk',
        columns: ['parent_id'],
        referencedTable: 'users',
        referencedSchema: 'public',
        referencedColumns: ['id'],
        onDelete: FKAction.SET_NULL,
        onUpdate: FKAction.NO_ACTION,
        isDeferrable: false,
        isDeferred: false,
        isVirtual: false,
      },
    ]
    const schema = makeSchema([usersTable])

    const genResult = makeGenerationResult(
      [
        {
          name: 'public.users',
          rows: [
            { id: 1, name: 'Alice', parent_id: null },
            { id: 2, name: 'Bob', parent_id: null },
          ],
        },
      ],
      [
        {
          tableName: 'public.users',
          pkColumns: ['id'],
          pkValues: [2],
          setColumns: ['parent_id'],
          setValues: [1],
        },
      ],
    )

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    const summary = await executeDirect(
      genResult,
      schema,
      ['public.users'],
      options,
      progress,
    )

    expect(summary.deferredUpdatesApplied).toBe(1)
    // Verify UPDATE was called
    const updateCalls = mockClient.query.mock.calls.filter((c: unknown[]) =>
      String(c[0]).startsWith('UPDATE'),
    )
    expect(updateCalls.length).toBe(1)
  })

  it('rolls back on INSERT failure and throws InsertionError', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])

    const genResult = makeGenerationResult([
      {
        name: 'public.users',
        rows: [{ id: 1, name: 'Alice' }],
      },
    ])

    // Make the INSERT query fail
    mockClient.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('INSERT')) {
        return Promise.reject(new Error('unique constraint violation'))
      }
      return Promise.resolve({ rows: [] })
    })

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    await expect(
      executeDirect(genResult, schema, ['public.users'], options, progress),
    ).rejects.toThrow(InsertionError)

    // Verify ROLLBACK was called
    const queryCalls = mockClient.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(queryCalls).toContain('ROLLBACK')
  })

  it('throws InsertionError SF4002 on deferred UPDATE failure', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])

    const genResult = makeGenerationResult(
      [{ name: 'public.users', rows: [{ id: 1, name: 'Alice', parent_id: null }] }],
      [
        {
          tableName: 'public.users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [999],
        },
      ],
    )

    // Make UPDATE queries fail
    mockClient.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('UPDATE')) {
        return Promise.reject(new Error('FK constraint violation'))
      }
      return Promise.resolve({ rows: [] })
    })

    const options: OutputOptions = {
      mode: OutputMode.DIRECT,
      client: mockClient as never,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    try {
      await executeDirect(genResult, schema, ['public.users'], options, progress)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4002')
    }
  })
})
