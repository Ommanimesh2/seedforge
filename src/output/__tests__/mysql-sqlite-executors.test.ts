import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NormalizedType } from '../../types/schema.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import type { GenerationResult } from '../../generate/types.js'
import { OutputMode } from '../types.js'
import { InsertionError } from '../../errors/index.js'
import { executeSqliteDirect } from '../executors/sqlite-direct.js'

// ─── Shared helpers ────────────────────────────────────────────────────────

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

function makeTable(
  name: string,
  columnNames: string[],
  opts?: { autoIncrementCol?: string; generatedCol?: string },
): TableDef {
  const columns = new Map<string, ColumnDef>()
  for (const col of columnNames) {
    const overrides: Partial<ColumnDef> = {}
    if (col === 'id' || col === opts?.autoIncrementCol) {
      overrides.isAutoIncrement = true
      overrides.dataType = NormalizedType.INTEGER
    }
    if (col === opts?.generatedCol) {
      overrides.isGenerated = true
    }
    columns.set(col, makeColumn(col, overrides))
  }
  return {
    name,
    schema: 'public',
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
    tableMap.set(t.name, t)
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
  warnings: string[] = [],
): GenerationResult {
  const tables = new Map<
    string,
    { tableName: string; rows: Record<string, unknown>[]; generatedPKs: unknown[][] }
  >()
  for (const t of tableData) {
    tables.set(t.name, {
      tableName: t.name,
      rows: t.rows,
      generatedPKs: t.rows.map((r) => [r.id]),
    })
  }
  return { tables, deferredUpdates, warnings }
}

const mockProgress = {
  startTable: vi.fn(),
  updateTable: vi.fn(),
  finishTable: vi.fn(),
}

// ═══════════════════════════════════════════════════════════════════════════
// MySQL executor tests
// ═══════════════════════════════════════════════════════════════════════════

describe('executeMysqlDirect', () => {
  let mockConnection: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.resetAllMocks()
    mockConnection = {
      query: vi.fn().mockResolvedValue([[], []]),
    }
  })

  async function importAndExecute(
    genResult: GenerationResult,
    schema: DatabaseSchema,
    orderedTables: string[],
    batchSize = 500,
  ) {
    const { executeMysqlDirect } = await import('../../output/executors/mysql-direct.js')
    return executeMysqlDirect(
      genResult,
      schema,
      orderedTables,
      mockConnection as never,
      batchSize,
      mockProgress as never,
    )
  }

  it('calls START TRANSACTION, INSERT, COMMIT in correct order', async () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([
      {
        name: 'users',
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
    ])

    await importAndExecute(genResult, schema, ['users'])

    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))

    // Find the transaction sequence for inserts
    const startIdx = calls.indexOf('START TRANSACTION')
    const commitIdx = calls.indexOf('COMMIT')
    const insertIdx = calls.findIndex((c: string) => c.startsWith('INSERT'))

    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(insertIdx).toBeGreaterThan(startIdx)
    expect(commitIdx).toBeGreaterThan(insertIdx)
  })

  it('returns correct InsertionSummary shape', async () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([
      {
        name: 'users',
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
    ])

    const summary = await importAndExecute(genResult, schema, ['users'])

    expect(summary.tablesSeeded).toBe(1)
    expect(summary.totalRowsInserted).toBe(2)
    expect(summary.rowsPerTable.get('users')).toBe(2)
    expect(summary.mode).toBe(OutputMode.DIRECT)
    expect(summary.deferredUpdatesApplied).toBe(0)
    expect(typeof summary.elapsedMs).toBe('number')
    expect(Array.isArray(summary.warnings)).toBe(true)
  })

  it('calls ROLLBACK and throws InsertionError SF4001 on INSERT failure', async () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    mockConnection.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('INSERT')) {
        return Promise.reject(new Error('Duplicate entry'))
      }
      return Promise.resolve([[], []])
    })

    try {
      await importAndExecute(genResult, schema, ['users'])
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4001')
      expect((err as InsertionError).message).toContain('users')
      expect((err as InsertionError).message).toContain('Duplicate entry')
    }

    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls).toContain('ROLLBACK')
  })

  it('applies deferred updates wrapped in transaction', async () => {
    const usersTable = makeTable('users', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [
        {
          name: 'users',
          rows: [
            { id: 1, name: 'Alice', parent_id: null },
            { id: 2, name: 'Bob', parent_id: null },
          ],
        },
      ],
      [
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [2],
          setColumns: ['parent_id'],
          setValues: [1],
        },
      ],
    )

    await importAndExecute(genResult, schema, ['users'])

    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))
    const updateCalls = calls.filter((c: string) => c.startsWith('UPDATE'))
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]).toContain('`parent_id`')
    expect(updateCalls[0]).toContain('`users`')

    // Deferred updates should also be in a transaction
    // After the INSERT's COMMIT, there should be another START TRANSACTION / COMMIT for updates
    const startTxCount = calls.filter((c: string) => c === 'START TRANSACTION').length
    const commitCount = calls.filter((c: string) => c === 'COMMIT').length
    expect(startTxCount).toBeGreaterThanOrEqual(2)
    expect(commitCount).toBeGreaterThanOrEqual(2)
  })

  it('throws InsertionError SF4002 on deferred UPDATE failure', async () => {
    const usersTable = makeTable('users', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [{ name: 'users', rows: [{ id: 1, name: 'Alice', parent_id: null }] }],
      [
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [999],
        },
      ],
    )

    mockConnection.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('UPDATE')) {
        return Promise.reject(new Error('FK constraint violation'))
      }
      return Promise.resolve([[], []])
    })

    try {
      await importAndExecute(genResult, schema, ['users'])
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4002')
      expect((err as InsertionError).message).toContain('Deferred UPDATE failed')
    }
  })

  it('resets AUTO_INCREMENT after inserts', async () => {
    const usersTable = makeTable('users', ['id', 'name'], { autoIncrementCol: 'id' })
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 10, name: 'Alice' }] }])

    // Return max_val from the SELECT MAX query
    mockConnection.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT MAX')) {
        return Promise.resolve([[{ max_val: 10 }], []])
      }
      return Promise.resolve([[], []])
    })

    const summary = await importAndExecute(genResult, schema, ['users'])

    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))
    const alterCalls = calls.filter((c: string) => c.includes('ALTER TABLE'))
    expect(alterCalls.length).toBe(1)
    expect(alterCalls[0]).toContain('AUTO_INCREMENT = 11')
    expect(summary.sequencesReset).toBe(1)
  })

  it('treats AUTO_INCREMENT reset failure as non-fatal warning', async () => {
    const usersTable = makeTable('users', ['id', 'name'], { autoIncrementCol: 'id' })
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 5, name: 'Alice' }] }])

    mockConnection.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT MAX')) {
        return Promise.reject(new Error('permission denied'))
      }
      return Promise.resolve([[], []])
    })

    // Should NOT throw
    const summary = await importAndExecute(genResult, schema, ['users'])

    expect(summary.warnings.length).toBeGreaterThan(0)
    expect(summary.warnings.some((w: string) => w.includes('AUTO_INCREMENT'))).toBe(true)
    expect(summary.sequencesReset).toBe(0)
  })

  it('skips empty tables', async () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [] }])

    const summary = await importAndExecute(genResult, schema, ['users'])

    expect(summary.tablesSeeded).toBe(0)
    expect(summary.totalRowsInserted).toBe(0)
    // No START TRANSACTION should have been called for inserts
    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.filter((c: string) => c === 'START TRANSACTION').length).toBe(0)
  })

  it('skips tables without definitions in schema', async () => {
    const schema = makeSchema([]) // no tables in schema
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    const summary = await importAndExecute(genResult, schema, ['users'])

    expect(summary.tablesSeeded).toBe(0)
    expect(summary.totalRowsInserted).toBe(0)
  })

  it('handles multiple tables in correct order', async () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const postsTable = makeTable('posts', ['id', 'title'])
    const schema = makeSchema([usersTable, postsTable])
    const genResult = makeGenerationResult([
      { name: 'users', rows: [{ id: 1, name: 'Alice' }] },
      { name: 'posts', rows: [{ id: 1, title: 'Hello' }] },
    ])

    const summary = await importAndExecute(genResult, schema, ['users', 'posts'])

    expect(summary.tablesSeeded).toBe(2)
    expect(summary.totalRowsInserted).toBe(2)

    const calls = mockConnection.query.mock.calls.map((c: unknown[]) => String(c[0]))
    const insertCalls = calls.filter((c: string) => c.startsWith('INSERT'))
    expect(insertCalls.length).toBe(2)
    // First insert should be for users, second for posts
    expect(insertCalls[0]).toContain('`users`')
    expect(insertCalls[1]).toContain('`posts`')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SQLite executor tests
// ═══════════════════════════════════════════════════════════════════════════

describe('executeSqliteDirect', () => {
  let mockStmtRun: ReturnType<typeof vi.fn>
  let mockPrepare: ReturnType<typeof vi.fn>
  let mockTransaction: ReturnType<typeof vi.fn>
  let mockExec: ReturnType<typeof vi.fn>
  let mockDb: {
    prepare: ReturnType<typeof vi.fn>
    transaction: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mockStmtRun = vi.fn()
    mockPrepare = vi.fn().mockReturnValue({ run: mockStmtRun })
    mockTransaction = vi.fn((fn: (...args: unknown[]) => unknown) => fn)
    mockExec = vi.fn()
    mockDb = {
      prepare: mockPrepare,
      transaction: mockTransaction,
      exec: mockExec,
    }
  })

  function execute(
    genResult: GenerationResult,
    schema: DatabaseSchema,
    orderedTables: string[],
    batchSize = 500,
  ) {
    return executeSqliteDirect(
      genResult,
      schema,
      orderedTables,
      mockDb as never,
      batchSize,
      mockProgress as never,
    )
  }

  it('calls prepare with correct INSERT SQL', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    execute(genResult, schema, ['users'])

    // Should have called prepare with INSERT INTO "users" ...
    const prepareCalls = mockPrepare.mock.calls.map((c: unknown[]) => String(c[0]))
    const insertCall = prepareCalls.find((c: string) => c.startsWith('INSERT'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain('"users"')
    expect(insertCall).toContain('"id"')
    expect(insertCall).toContain('"name"')
    expect(insertCall).toContain('?')
  })

  it('uses transaction wrapper for inserts', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    execute(genResult, schema, ['users'])

    expect(mockTransaction).toHaveBeenCalled()
  })

  it('throws InsertionError SF4001 on insert failure', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    // Make the transaction callback throw when stmt.run is called
    mockStmtRun.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed')
    })

    try {
      execute(genResult, schema, ['users'])
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4001')
      expect((err as InsertionError).message).toContain('users')
    }
  })

  it('calls prepare with UPDATE SQL for deferred updates', () => {
    const usersTable = makeTable('users', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [{ name: 'users', rows: [{ id: 1, name: 'Alice', parent_id: null }] }],
      [
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [2],
        },
      ],
    )

    execute(genResult, schema, ['users'])

    const prepareCalls = mockPrepare.mock.calls.map((c: unknown[]) => String(c[0]))
    const updateCall = prepareCalls.find((c: string) => c.startsWith('UPDATE'))
    expect(updateCall).toBeDefined()
    expect(updateCall).toContain('"users"')
    expect(updateCall).toContain('"parent_id"')
  })

  it('throws InsertionError SF4002 on deferred UPDATE failure', () => {
    const usersTable = makeTable('users', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [{ name: 'users', rows: [{ id: 1, name: 'Alice', parent_id: null }] }],
      [
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [999],
        },
      ],
    )

    // The second prepare call (for UPDATE) should return a stmt that throws
    let callCount = 0
    mockPrepare.mockImplementation(() => {
      callCount++
      if (callCount > 1) {
        // This is the UPDATE prepare
        return {
          run: vi.fn().mockImplementation(() => {
            throw new Error('FK constraint failed')
          }),
        }
      }
      return { run: mockStmtRun }
    })

    try {
      execute(genResult, schema, ['users'])
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4002')
      expect((err as InsertionError).message).toContain('Deferred UPDATE failed')
    }
  })

  it('skips empty tables', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult([{ name: 'users', rows: [] }])

    const summary = execute(genResult, schema, ['users'])

    expect(summary.tablesSeeded).toBe(0)
    expect(summary.totalRowsInserted).toBe(0)
    // prepare should not have been called for inserts
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('skips tables without definitions in schema', () => {
    const schema = makeSchema([]) // no tables
    const genResult = makeGenerationResult([{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }])

    const summary = execute(genResult, schema, ['users'])

    expect(summary.tablesSeeded).toBe(0)
    expect(summary.totalRowsInserted).toBe(0)
  })

  it('returns correct InsertionSummary shape', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const postsTable = makeTable('posts', ['id', 'title'])
    const schema = makeSchema([usersTable, postsTable])
    const genResult = makeGenerationResult([
      {
        name: 'users',
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
      { name: 'posts', rows: [{ id: 1, title: 'Hello' }] },
    ])

    const summary = execute(genResult, schema, ['users', 'posts'])

    expect(summary.tablesSeeded).toBe(2)
    expect(summary.totalRowsInserted).toBe(3)
    expect(summary.rowsPerTable.get('users')).toBe(2)
    expect(summary.rowsPerTable.get('posts')).toBe(1)
    expect(summary.mode).toBe(OutputMode.DIRECT)
    expect(summary.deferredUpdatesApplied).toBe(0)
    expect(summary.sequencesReset).toBe(0)
    expect(typeof summary.elapsedMs).toBe('number')
    expect(Array.isArray(summary.warnings)).toBe(true)
  })

  it('reports correct deferredUpdatesApplied count', () => {
    const usersTable = makeTable('users', ['id', 'name', 'parent_id'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [
        {
          name: 'users',
          rows: [
            { id: 1, name: 'Alice', parent_id: null },
            { id: 2, name: 'Bob', parent_id: null },
          ],
        },
      ],
      [
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [1],
          setColumns: ['parent_id'],
          setValues: [2],
        },
        {
          tableName: 'users',
          pkColumns: ['id'],
          pkValues: [2],
          setColumns: ['parent_id'],
          setValues: [1],
        },
      ],
    )

    const summary = execute(genResult, schema, ['users'])

    expect(summary.deferredUpdatesApplied).toBe(2)
  })

  it('preserves warnings from generation result', () => {
    const usersTable = makeTable('users', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const genResult = makeGenerationResult(
      [{ name: 'users', rows: [{ id: 1, name: 'Alice' }] }],
      [],
      ['some generation warning'],
    )

    const summary = execute(genResult, schema, ['users'])

    expect(summary.warnings).toContain('some generation warning')
  })
})
