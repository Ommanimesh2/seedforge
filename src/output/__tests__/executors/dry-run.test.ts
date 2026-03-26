import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeDryRun } from '../../executors/dry-run.js'
import type { GenerationResult } from '../../../generate/types.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../../types/schema.js'
import type { OutputOptions } from '../../types.js'
import { OutputMode } from '../../types.js'
import { ProgressReporter } from '../../progress.js'
import { NormalizedType } from '../../../types/schema.js'

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

describe('executeDryRun', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('does not make database calls', async () => {
    const mockClient = { query: vi.fn() }
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const progress = new ProgressReporter({ quiet: false, showProgress: true })

    const genResult = makeGenerationResult([
      { name: 'public.users', rows: [{ id: 1, name: 'Alice' }] },
    ])

    const options: OutputOptions = {
      mode: OutputMode.DRY_RUN,
      client: mockClient as never,
      batchSize: 500,
      showProgress: true,
      quiet: false,
    }

    await executeDryRun(genResult, schema, ['public.users'], options, progress)
    expect(mockClient.query).not.toHaveBeenCalled()
  })

  it('outputs [DRY RUN] prefix to stderr', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const progress = new ProgressReporter({ quiet: false, showProgress: true })

    const genResult = makeGenerationResult([
      { name: 'public.users', rows: [{ id: 1, name: 'Alice' }] },
    ])

    const options: OutputOptions = {
      mode: OutputMode.DRY_RUN,
      batchSize: 500,
      showProgress: true,
      quiet: false,
    }

    await executeDryRun(genResult, schema, ['public.users'], options, progress)

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('[DRY RUN]')
    expect(output).toContain('public.users')
    expect(output).toContain('1 rows')
  })

  it('returns correct summary counts', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const postsTable = makeTable('posts', 'public', ['id', 'title'])
    const schema = makeSchema([usersTable, postsTable])
    const progress = new ProgressReporter({ quiet: true, showProgress: false })

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
        rows: [{ id: 1, title: 'Hello' }],
      },
    ])

    const options: OutputOptions = {
      mode: OutputMode.DRY_RUN,
      batchSize: 500,
      showProgress: false,
      quiet: true,
    }

    const summary = await executeDryRun(
      genResult,
      schema,
      ['public.users', 'public.posts'],
      options,
      progress,
    )

    expect(summary.tablesSeeded).toBe(2)
    expect(summary.totalRowsInserted).toBe(3)
    expect(summary.mode).toBe(OutputMode.DRY_RUN)
    expect(summary.deferredUpdatesApplied).toBe(0)
    expect(summary.sequencesReset).toBe(0)
  })

  it('shows deferred update count', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const progress = new ProgressReporter({ quiet: false, showProgress: true })

    const genResult = makeGenerationResult(
      [{ name: 'public.users', rows: [{ id: 1, name: 'Alice' }] }],
      [
        {
          tableName: 'public.users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [1],
        },
      ],
    )

    const options: OutputOptions = {
      mode: OutputMode.DRY_RUN,
      batchSize: 500,
      showProgress: true,
      quiet: false,
    }

    await executeDryRun(genResult, schema, ['public.users'], options, progress)

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Deferred updates: 1')
  })
})
