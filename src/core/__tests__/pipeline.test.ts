import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'
import type { InsertPlan } from '../../graph/types.js'
import type { GenerationResult, TableGenerationResult } from '../../generate/types.js'
import type { InsertionSummary } from '../../output/types.js'
import { OutputMode } from '../../output/types.js'
import type { Client } from 'pg'
import type { Connection as MysqlConnection } from 'mysql2/promise'
import type { SqliteDatabase } from '../../introspect/sqlite/connection.js'
import type { AIConfig } from '../../ai/types.js'
import type { TableCardinalityConfig } from '../../generate/cardinality.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../graph/index.js', () => ({
  buildInsertPlan: vi.fn(),
}))

vi.mock('../../generate/index.js', () => ({
  generate: vi.fn(),
}))

vi.mock('../../output/index.js', () => ({
  executeOutput: vi.fn(),
  OutputMode: { DIRECT: 'DIRECT', DRY_RUN: 'DRY_RUN', FILE: 'FILE' },
  ProgressReporter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.printSummary = vi.fn()
  }),
}))

vi.mock('../../ai/batch.js', () => ({
  generateAITextPool: vi.fn(),
}))

vi.mock('../../output/executors/mysql-direct.js', () => ({
  executeMysqlDirect: vi.fn(),
}))

vi.mock('../../output/executors/sqlite-direct.js', () => ({
  executeSqliteDirect: vi.fn(),
}))

// connectAndIntrospect dependency mocks
vi.mock('../../introspect/adapter.js', () => ({
  detectDatabaseType: vi.fn(),
  DatabaseType: { POSTGRES: 'postgres', MYSQL: 'mysql', SQLITE: 'sqlite' },
  createAdapter: vi.fn(),
}))

vi.mock('../../introspect/index.js', () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  introspect: vi.fn(),
}))

vi.mock('../../introspect/sqlite/connection.js', () => ({
  connectSqlite: vi.fn(),
  disconnectSqlite: vi.fn(),
  extractSqlitePath: vi.fn(),
}))

vi.mock('../../introspect/sqlite/introspect.js', () => ({
  introspectSqlite: vi.fn(),
}))

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSchema(): DatabaseSchema {
  const columns = new Map<string, ColumnDef>()
  columns.set('id', {
    name: 'id',
    dataType: NormalizedType.INTEGER,
    nativeType: 'int4',
    isNullable: false,
    hasDefault: true,
    defaultValue: null,
    isAutoIncrement: true,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  })
  columns.set('name', {
    name: 'name',
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
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
  })

  const table: TableDef = {
    name: 'users',
    schema: 'public',
    columns,
    primaryKey: { columns: ['id'], name: 'users_pkey' },
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }

  return {
    name: 'testdb',
    tables: new Map([['public.users', table]]),
    enums: new Map(),
    schemas: ['public'],
  }
}

function makePlan(): InsertPlan {
  return {
    ordered: ['public.users'],
    deferredEdges: [],
    selfRefTables: [],
    warnings: [],
  }
}

function makeGenResult(): GenerationResult {
  const tableResult: TableGenerationResult = {
    tableName: 'public.users',
    rows: [{ id: 1, name: 'Alice' }],
    generatedPKs: [[1]],
  }
  return {
    tables: new Map([['public.users', tableResult]]),
    deferredUpdates: [],
    warnings: [],
  }
}

function makeSummary(): InsertionSummary {
  return {
    tablesSeeded: 1,
    totalRowsInserted: 1,
    rowsPerTable: new Map([['users', 1]]),
    deferredUpdatesApplied: 0,
    sequencesReset: 0,
    elapsedMs: 100,
    warnings: [],
    mode: OutputMode.DIRECT,
  }
}

// ─── Import subjects & mocked modules ───────────────────────────────────────

import { runPipeline, connectAndIntrospect } from '../pipeline.js'
import { buildInsertPlan } from '../../graph/index.js'
import { generate } from '../../generate/index.js'
import { executeOutput } from '../../output/index.js'
import { generateAITextPool } from '../../ai/batch.js'
import { executeMysqlDirect } from '../../output/executors/mysql-direct.js'
import { executeSqliteDirect } from '../../output/executors/sqlite-direct.js'
import { detectDatabaseType, createAdapter } from '../../introspect/adapter.js'
import { connect, disconnect, introspect } from '../../introspect/index.js'
import {
  connectSqlite,
  disconnectSqlite,
  extractSqlitePath,
} from '../../introspect/sqlite/connection.js'
import { introspectSqlite } from '../../introspect/sqlite/introspect.js'

// ─── runPipeline Tests ──────────────────────────────────────────────────────

describe('runPipeline', () => {
  const schema = makeSchema()
  const plan = makePlan()
  const genResult = makeGenResult()
  const summary = makeSummary()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildInsertPlan).mockReturnValue(plan)
    vi.mocked(generate).mockResolvedValue(genResult)
    vi.mocked(executeOutput).mockResolvedValue(summary)
  })

  it('calls buildInsertPlan with the provided schema', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 10,
    })

    expect(buildInsertPlan).toHaveBeenCalledWith(schema)
  })

  it('returns generationResult, summary, plan, and schema', async () => {
    const result = await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 10,
    })

    expect(result).toEqual({ generationResult: genResult, summary, plan, schema })
  })

  // ─── Output mode determination ──────────────────────────────────────────

  it('uses DRY_RUN mode when dryRun is true', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
      dryRun: true,
    })

    expect(executeOutput).toHaveBeenCalledWith(
      genResult,
      schema,
      plan,
      expect.objectContaining({ mode: 'DRY_RUN' }),
      expect.any(String),
    )
  })

  it('uses FILE mode when output path is provided', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
      output: '/tmp/seed.sql',
    })

    expect(executeOutput).toHaveBeenCalledWith(
      genResult,
      schema,
      plan,
      expect.objectContaining({ mode: 'FILE', filePath: '/tmp/seed.sql' }),
      expect.any(String),
    )
  })

  it('uses DIRECT mode when neither dryRun nor output is set', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
    })

    expect(executeOutput).toHaveBeenCalledWith(
      genResult,
      schema,
      plan,
      expect.objectContaining({ mode: 'DIRECT' }),
      expect.any(String),
    )
  })

  // ─── genClient logic ─────────────────────────────────────────────────────

  it('passes PG client as genClient when connection is pg and not dryRun', async () => {
    const mockClient = { query: vi.fn() } as unknown as Client

    await runPipeline({
      schema,
      connection: { type: 'pg', client: mockClient },
      count: 5,
    })

    expect(generate).toHaveBeenCalledWith(schema, plan, mockClient, expect.any(Object))
  })

  it('passes null as genClient when connection is pg but dryRun is true', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
      dryRun: true,
    })

    expect(generate).toHaveBeenCalledWith(schema, plan, null, expect.any(Object))
  })

  it('passes null as genClient when connection is mysql', async () => {
    const mysqlSummary = { ...makeSummary() }
    vi.mocked(executeMysqlDirect).mockResolvedValue(mysqlSummary)

    await runPipeline({
      schema,
      connection: { type: 'mysql', connection: {} as unknown as MysqlConnection },
      count: 5,
    })

    expect(generate).toHaveBeenCalledWith(schema, plan, null, expect.any(Object))
  })

  it('passes null as genClient when connection is sqlite', async () => {
    const sqliteSummary = { ...makeSummary() }
    vi.mocked(executeSqliteDirect).mockReturnValue(sqliteSummary)

    await runPipeline({
      schema,
      connection: { type: 'sqlite', db: {} as unknown as SqliteDatabase },
      count: 5,
    })

    expect(generate).toHaveBeenCalledWith(schema, plan, null, expect.any(Object))
  })

  // ─── AI text pool ────────────────────────────────────────────────────────

  it('generates AI text pool when ai.enabled is true', async () => {
    const aiPool = new Map([['public.users.name', ['Alice', 'Bob']]])
    vi.mocked(generateAITextPool).mockResolvedValue(aiPool)

    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
      ai: { enabled: true, provider: 'openai', model: 'gpt-4' } satisfies AIConfig,
    })

    expect(generateAITextPool).toHaveBeenCalledWith(
      schema,
      expect.objectContaining({ enabled: true }),
      expect.any(Map),
      undefined,
      expect.objectContaining({ skipConfirmation: true }),
    )
    expect(generate).toHaveBeenCalledWith(
      schema,
      plan,
      expect.anything(),
      expect.objectContaining({ aiTextPool: aiPool }),
    )
  })

  it('does not generate AI text pool when ai is not enabled', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
    })

    expect(generateAITextPool).not.toHaveBeenCalled()
  })

  // ─── Database-specific executors ──────────────────────────────────────────

  it('dispatches to executeMysqlDirect for MySQL DIRECT mode', async () => {
    const mysqlConn = { query: vi.fn() } as unknown as MysqlConnection
    const mysqlSummary = { ...makeSummary() }
    vi.mocked(executeMysqlDirect).mockResolvedValue(mysqlSummary)

    const result = await runPipeline({
      schema,
      connection: { type: 'mysql', connection: mysqlConn },
      count: 5,
      batchSize: 200,
    })

    expect(executeMysqlDirect).toHaveBeenCalledWith(
      genResult,
      schema,
      plan.ordered,
      mysqlConn,
      200,
      expect.any(Object),
    )
    expect(executeOutput).not.toHaveBeenCalled()
    expect(result.summary).toEqual(mysqlSummary)
  })

  it('dispatches to executeSqliteDirect for SQLite DIRECT mode', async () => {
    const sqliteDb = { prepare: vi.fn() } as unknown as SqliteDatabase
    const sqliteSummary = { ...makeSummary() }
    vi.mocked(executeSqliteDirect).mockReturnValue(sqliteSummary)

    const result = await runPipeline({
      schema,
      connection: { type: 'sqlite', db: sqliteDb },
      count: 5,
      batchSize: 100,
    })

    expect(executeSqliteDirect).toHaveBeenCalledWith(
      genResult,
      schema,
      plan.ordered,
      sqliteDb,
      100,
      expect.any(Object),
    )
    expect(executeOutput).not.toHaveBeenCalled()
    expect(result.summary).toEqual(sqliteSummary)
  })

  it('uses executeOutput for PG DIRECT mode', async () => {
    const pgClient = { query: vi.fn() } as unknown as Client

    await runPipeline({
      schema,
      connection: { type: 'pg', client: pgClient },
      count: 5,
    })

    expect(executeOutput).toHaveBeenCalledWith(
      genResult,
      schema,
      plan,
      expect.objectContaining({ mode: 'DIRECT', client: pgClient }),
      expect.any(String),
    )
    expect(executeMysqlDirect).not.toHaveBeenCalled()
    expect(executeSqliteDirect).not.toHaveBeenCalled()
  })

  // ─── Generation options forwarding ────────────────────────────────────────

  it('forwards seed and count to generate()', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 42,
      seed: 12345,
    })

    expect(generate).toHaveBeenCalledWith(
      schema,
      plan,
      expect.anything(),
      expect.objectContaining({
        globalRowCount: 42,
        seed: 12345,
      }),
    )
  })

  it('forwards tableCardinalityConfigs to generate()', async () => {
    const cardConfigs = new Map<string, TableCardinalityConfig>([
      [
        'public.orders',
        new Map([['user_id', { min: 1, max: 1, distribution: 'uniform' as const }]]),
      ],
    ])

    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 10,
      tableCardinalityConfigs: cardConfigs,
    })

    expect(generate).toHaveBeenCalledWith(
      schema,
      plan,
      expect.anything(),
      expect.objectContaining({ tableCardinalityConfigs: cardConfigs }),
    )
  })

  it('passes version to executeOutput', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
      version: '2.2.0',
    })

    expect(executeOutput).toHaveBeenCalledWith(genResult, schema, plan, expect.any(Object), '2.2.0')
  })

  it('uses default version 0.0.0 when not specified', async () => {
    await runPipeline({
      schema,
      connection: { type: 'pg', client: {} as unknown as Client },
      count: 5,
    })

    expect(executeOutput).toHaveBeenCalledWith(genResult, schema, plan, expect.any(Object), '0.0.0')
  })
})

// ─── connectAndIntrospect Tests ─────────────────────────────────────────────

describe('connectAndIntrospect', () => {
  const schema = makeSchema()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('connects and introspects a PostgreSQL database', async () => {
    const mockClient = { query: vi.fn() } as unknown as Client
    vi.mocked(detectDatabaseType).mockReturnValue(
      'postgres' as ReturnType<typeof detectDatabaseType>,
    )
    vi.mocked(connect).mockResolvedValue(mockClient)
    vi.mocked(introspect).mockResolvedValue(schema)
    vi.mocked(disconnect).mockResolvedValue(undefined)

    const result = await connectAndIntrospect('postgres://user:pass@localhost/testdb')

    expect(detectDatabaseType).toHaveBeenCalledWith('postgres://user:pass@localhost/testdb')
    expect(connect).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@localhost/testdb',
      schema: 'public',
      skipProductionCheck: true,
    })
    expect(introspect).toHaveBeenCalledWith(mockClient, 'public')
    expect(result.connection).toEqual({ type: 'pg', client: mockClient })
    expect(result.schema).toBe(schema)

    // Verify disconnect function works
    await result.disconnect()
    expect(disconnect).toHaveBeenCalledWith(mockClient)
  })

  it('uses custom schema option for PG', async () => {
    const mockClient = { query: vi.fn() } as unknown as Client
    vi.mocked(detectDatabaseType).mockReturnValue(
      'postgres' as ReturnType<typeof detectDatabaseType>,
    )
    vi.mocked(connect).mockResolvedValue(mockClient)
    vi.mocked(introspect).mockResolvedValue(schema)

    await connectAndIntrospect('postgres://localhost/db', { schema: 'myschema' })

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ schema: 'myschema' }))
    expect(introspect).toHaveBeenCalledWith(mockClient, 'myschema')
  })

  it('disconnects PG client on introspection failure', async () => {
    const mockClient = { query: vi.fn() } as unknown as Client
    vi.mocked(detectDatabaseType).mockReturnValue(
      'postgres' as ReturnType<typeof detectDatabaseType>,
    )
    vi.mocked(connect).mockResolvedValue(mockClient)
    vi.mocked(introspect).mockRejectedValue(new Error('introspection failed'))
    vi.mocked(disconnect).mockResolvedValue(undefined)

    await expect(connectAndIntrospect('postgres://localhost/db')).rejects.toThrow(
      'introspection failed',
    )

    expect(disconnect).toHaveBeenCalledWith(mockClient)
  })

  it('connects and introspects a MySQL database', async () => {
    const mockMysqlConn = { query: vi.fn() } as unknown as Client
    const mockAdapter = {
      type: 'mysql',
      connect: vi.fn().mockResolvedValue(mockMysqlConn),
      disconnect: vi.fn().mockResolvedValue(undefined),
      introspect: vi.fn().mockResolvedValue(schema),
    }
    vi.mocked(detectDatabaseType).mockReturnValue('mysql' as ReturnType<typeof detectDatabaseType>)
    vi.mocked(createAdapter).mockResolvedValue(
      mockAdapter as unknown as Awaited<ReturnType<typeof createAdapter>>,
    )

    const result = await connectAndIntrospect('mysql://root:pass@localhost/mydb')

    expect(createAdapter).toHaveBeenCalledWith('mysql')
    expect(mockAdapter.connect).toHaveBeenCalledWith({
      connectionString: 'mysql://root:pass@localhost/mydb',
      schema: 'public',
      skipProductionCheck: true,
    })
    // extractDatabaseName('mysql://root:pass@localhost/mydb') => 'mydb'
    expect(mockAdapter.introspect).toHaveBeenCalledWith(mockMysqlConn, 'mydb')
    expect(result.connection).toEqual({ type: 'mysql', connection: mockMysqlConn })
    expect(result.schema).toBe(schema)

    // Verify disconnect function
    await result.disconnect()
    expect(mockAdapter.disconnect).toHaveBeenCalledWith(mockMysqlConn)
  })

  it('disconnects MySQL adapter on introspection failure', async () => {
    const mockMysqlConn = { query: vi.fn() } as unknown as Client
    const mockAdapter = {
      type: 'mysql',
      connect: vi.fn().mockResolvedValue(mockMysqlConn),
      disconnect: vi.fn().mockResolvedValue(undefined),
      introspect: vi.fn().mockRejectedValue(new Error('mysql introspect failed')),
    }
    vi.mocked(detectDatabaseType).mockReturnValue('mysql' as ReturnType<typeof detectDatabaseType>)
    vi.mocked(createAdapter).mockResolvedValue(
      mockAdapter as unknown as Awaited<ReturnType<typeof createAdapter>>,
    )

    await expect(connectAndIntrospect('mysql://root@localhost/mydb')).rejects.toThrow(
      'mysql introspect failed',
    )

    expect(mockAdapter.disconnect).toHaveBeenCalledWith(mockMysqlConn)
  })

  it('connects and introspects a SQLite database', async () => {
    const mockDb = { prepare: vi.fn() } as unknown as SqliteDatabase
    vi.mocked(detectDatabaseType).mockReturnValue('sqlite' as ReturnType<typeof detectDatabaseType>)
    vi.mocked(extractSqlitePath).mockReturnValue('/tmp/test.db')
    vi.mocked(connectSqlite).mockReturnValue(mockDb)
    vi.mocked(introspectSqlite).mockReturnValue(schema)

    const result = await connectAndIntrospect('sqlite:./test.db')

    expect(extractSqlitePath).toHaveBeenCalledWith('sqlite:./test.db')
    expect(connectSqlite).toHaveBeenCalledWith('/tmp/test.db')
    expect(introspectSqlite).toHaveBeenCalledWith(mockDb, '/tmp/test.db')
    expect(result.connection).toEqual({ type: 'sqlite', db: mockDb })
    expect(result.schema).toBe(schema)

    // Verify disconnect function
    await result.disconnect()
    expect(disconnectSqlite).toHaveBeenCalledWith(mockDb)
  })

  it('disconnects SQLite on introspection failure', async () => {
    const mockDb = { prepare: vi.fn() } as unknown as SqliteDatabase
    vi.mocked(detectDatabaseType).mockReturnValue('sqlite' as ReturnType<typeof detectDatabaseType>)
    vi.mocked(extractSqlitePath).mockReturnValue('/tmp/test.db')
    vi.mocked(connectSqlite).mockReturnValue(mockDb)
    vi.mocked(introspectSqlite).mockImplementation(() => {
      throw new Error('sqlite introspect failed')
    })

    await expect(connectAndIntrospect('sqlite:./test.db')).rejects.toThrow(
      'sqlite introspect failed',
    )

    expect(disconnectSqlite).toHaveBeenCalledWith(mockDb)
  })

  it('defaults skipProductionCheck to true', async () => {
    const mockClient = { query: vi.fn() } as unknown as Client
    vi.mocked(detectDatabaseType).mockReturnValue(
      'postgres' as ReturnType<typeof detectDatabaseType>,
    )
    vi.mocked(connect).mockResolvedValue(mockClient)
    vi.mocked(introspect).mockResolvedValue(schema)

    await connectAndIntrospect('postgres://localhost/db')

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ skipProductionCheck: true }))
  })
})
