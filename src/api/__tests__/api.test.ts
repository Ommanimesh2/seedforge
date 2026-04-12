import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DatabaseSchema } from '../../types/schema.js'
import type { InsertPlan } from '../../graph/types.js'
import type { Seeder } from '../seeder.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockConnectAndIntrospect = vi.fn()
const mockRunPipeline = vi.fn()

vi.mock('../../core/pipeline.js', () => ({
  connectAndIntrospect: (...args: unknown[]) => mockConnectAndIntrospect(...args),
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}))

const mockBuildInsertPlan = vi.fn()
vi.mock('../../graph/index.js', () => ({
  buildInsertPlan: (...args: unknown[]) => mockBuildInsertPlan(...args),
}))

const mockGenerate = vi.fn()
vi.mock('../../generate/index.js', () => ({
  generate: (...args: unknown[]) => mockGenerate(...args),
}))

// ---------------------------------------------------------------------------
// Helpers for constructing mock data
// ---------------------------------------------------------------------------

function makeMockSchema(tableNames: string[] = ['users']) {
  const tables = new Map<
    string,
    { name: string; schema: string; columns: Map<string, { name: string; isGenerated: boolean }> }
  >()
  for (const name of tableNames) {
    tables.set(`public.${name}`, {
      name,
      schema: 'public',
      columns: new Map([
        ['id', { name: 'id', isGenerated: false }],
        ['name', { name: 'name', isGenerated: false }],
      ]),
    })
  }
  return { name: 'test_db', tables, enums: new Map(), schemas: ['public'] }
}

function makeMockPipelineResult(tableNames: string[] = ['users']) {
  const tables = new Map<string, { rows: Record<string, unknown>[] }>()
  for (const name of tableNames) {
    tables.set(name, {
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    })
  }
  return {
    generationResult: { tables, deferredUpdates: [] },
    summary: { tables: [], totalRows: 2, duration: 10 },
    plan: { ordered: tableNames, deferredEdges: [], selfRefTables: [], warnings: [] },
    schema: makeMockSchema(tableNames),
  }
}

function makeMockDisconnect() {
  return vi.fn().mockResolvedValue(undefined)
}

function setupConnectAndIntrospect(tableNames: string[] = ['users']) {
  const disconnect = makeMockDisconnect()
  const schema = makeMockSchema(tableNames)
  mockConnectAndIntrospect.mockResolvedValue({
    connection: { type: 'none' },
    schema,
    disconnect,
  })
  return { disconnect, schema }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// 1. seed() — one-liner API (src/api/seed.ts)
// ============================================================================

describe('seed() one-liner', () => {
  // Lazy import so module-level mocks are in place before the module loads
  const getSeed = async () => (await import('../seed.js')).seed

  it('accepts a string URL and uses it as connectionUrl', async () => {
    const { disconnect } = setupConnectAndIntrospect()
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult())

    const seed = await getSeed()
    await seed('postgres://localhost/testdb')

    expect(mockConnectAndIntrospect).toHaveBeenCalledWith(
      'postgres://localhost/testdb',
      expect.objectContaining({ schema: 'public', skipProductionCheck: true }),
    )
    expect(disconnect).toHaveBeenCalled()
  })

  it('accepts an object with db field and extracts the URL', async () => {
    const { disconnect } = setupConnectAndIntrospect()
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult())

    const seed = await getSeed()
    await seed({ db: 'postgres://localhost/mydb', count: 10 })

    expect(mockConnectAndIntrospect).toHaveBeenCalledWith(
      'postgres://localhost/mydb',
      expect.objectContaining({ schema: 'public' }),
    )
    expect(disconnect).toHaveBeenCalled()
  })

  it('throws when no URL or parser is provided', async () => {
    const seed = await getSeed()

    await expect(seed({})).rejects.toThrow('No database connection or schema file provided')
  })

  it('applies default options (count=50, schema=public, quiet=true)', async () => {
    setupConnectAndIntrospect()
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult())

    const seed = await getSeed()
    await seed('postgres://localhost/testdb')

    expect(mockRunPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 50,
        quiet: true,
        dryRun: false,
        fast: false,
        batchSize: 500,
      }),
    )
  })

  it('passes explicit options through to runPipeline', async () => {
    setupConnectAndIntrospect()
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult())

    const seed = await getSeed()
    await seed('postgres://localhost/testdb', {
      count: 10,
      seed: 42,
      dryRun: true,
      fast: true,
      batchSize: 100,
      quiet: false,
    })

    expect(mockRunPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 10,
        seed: 42,
        dryRun: true,
        fast: true,
        batchSize: 100,
        quiet: false,
      }),
    )
  })

  it('excludes tables by direct name match', async () => {
    setupConnectAndIntrospect(['users', 'audit_log'])
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult(['users']))

    const seed = await getSeed()
    await seed('postgres://localhost/testdb', { exclude: ['public.audit_log'] })

    // The schema passed to runPipeline should no longer contain audit_log
    const pipelineCall = mockRunPipeline.mock.calls[0][0]
    expect(pipelineCall.schema.tables.has('public.audit_log')).toBe(false)
    expect(pipelineCall.schema.tables.has('public.users')).toBe(true)
  })

  it('excludes tables by unqualified name matching table.name', async () => {
    setupConnectAndIntrospect(['users', 'audit_log'])
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult(['users']))

    const seed = await getSeed()
    await seed('postgres://localhost/testdb', { exclude: ['audit_log'] })

    const pipelineCall = mockRunPipeline.mock.calls[0][0]
    expect(pipelineCall.schema.tables.has('public.audit_log')).toBe(false)
  })

  it('calls disconnectFn in finally block even when pipeline throws', async () => {
    const { disconnect } = setupConnectAndIntrospect()
    mockRunPipeline.mockRejectedValue(new Error('pipeline boom'))

    const seed = await getSeed()
    await expect(seed('postgres://localhost/testdb')).rejects.toThrow('pipeline boom')
    expect(disconnect).toHaveBeenCalled()
  })

  it('returns SeedResult with tables, rowCount, duration, and summary', async () => {
    setupConnectAndIntrospect()
    mockRunPipeline.mockResolvedValue(makeMockPipelineResult())

    const seed = await getSeed()
    const result = await seed('postgres://localhost/testdb')

    expect(result.tables).toBeInstanceOf(Map)
    expect(result.tables.get('users')).toHaveLength(2)
    expect(result.rowCount).toBe(2)
    expect(typeof result.duration).toBe('number')
    expect(result.summary).toBeDefined()
  })
})

// ============================================================================
// 2. Seeder class & createSeeder() (src/api/seeder.ts)
// ============================================================================

describe('Seeder', () => {
  const getSeederModule = async () => import('../seeder.js')

  function makeSeederDeps(tableNames: string[] = ['users']) {
    const schema = makeMockSchema(tableNames)
    const plan: InsertPlan = {
      ordered: tableNames,
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const connection = { type: 'none' as const }
    return { schema, plan, disconnect, connection }
  }

  describe('createSeeder()', () => {
    it('connects, introspects, and builds a plan', async () => {
      const { disconnect, schema } = setupConnectAndIntrospect()
      const plan = {
        ordered: ['users'],
        deferredEdges: [],
        selfRefTables: [],
        warnings: [],
      }
      mockBuildInsertPlan.mockReturnValue(plan)

      const { createSeeder } = await getSeederModule()
      const seeder = await createSeeder('postgres://localhost/testdb')

      expect(mockConnectAndIntrospect).toHaveBeenCalledWith(
        'postgres://localhost/testdb',
        expect.objectContaining({ schema: 'public', skipProductionCheck: true }),
      )
      expect(mockBuildInsertPlan).toHaveBeenCalledWith(schema)
      expect(seeder).toBeDefined()

      // Cleanup
      await seeder.disconnect()
      expect(disconnect).toHaveBeenCalled()
    })

    it('begins a transaction when transaction option is true', async () => {
      const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
      const disconnect = vi.fn().mockResolvedValue(undefined)
      mockConnectAndIntrospect.mockResolvedValue({
        connection: { type: 'pg', client: mockClient },
        schema: makeMockSchema(),
        disconnect,
      })
      mockBuildInsertPlan.mockReturnValue({
        ordered: ['users'],
        deferredEdges: [],
        selfRefTables: [],
        warnings: [],
      })

      const { createSeeder } = await getSeederModule()
      const seeder = await createSeeder('postgres://localhost/testdb', {
        transaction: true,
      })

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')

      // Cleanup
      await seeder.teardown()
    })
  })

  describe('Seeder._assertOpen()', () => {
    it('throws after disconnect()', async () => {
      const deps = makeSeederDeps()
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      await seeder.disconnect()

      expect(() => seeder.table('users', 5)).toThrow('Seeder has been closed')
    })

    it('throws after teardown()', async () => {
      const deps = makeSeederDeps()
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      await seeder.teardown()

      expect(() => seeder.table('users', 5)).toThrow('Seeder has been closed')
    })
  })

  describe('Seeder.seed()', () => {
    it('throws when the table is not in the plan', async () => {
      const deps = makeSeederDeps(['users'])
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      await expect(seeder.seed('nonexistent', 5)).rejects.toThrow(
        'Table "nonexistent" not found in schema',
      )

      await seeder.disconnect()
    })

    it('returns empty array when generate returns no rows', async () => {
      const deps = makeSeederDeps(['users'])
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      mockGenerate.mockResolvedValue({
        tables: new Map([['users', { rows: [] }]]),
        deferredUpdates: [],
      })

      const rows = await seeder.seed('users', 0)
      expect(rows).toEqual([])

      await seeder.disconnect()
    })

    it('increments seed per call for deterministic variation', async () => {
      const deps = makeSeederDeps(['users'])
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { seed: 100, transaction: false, quiet: true, batchSize: 500 },
      )

      mockGenerate.mockResolvedValue({
        tables: new Map([['users', { rows: [{ id: 1, name: 'Alice' }] }]]),
        deferredUpdates: [],
      })

      await seeder.seed('users', 1)
      const firstCall = mockGenerate.mock.calls[0][3]
      expect(firstCall.seed).toBe(100)

      await seeder.seed('users', 1)
      const secondCall = mockGenerate.mock.calls[1][3]
      expect(secondCall.seed).toBe(101)

      await seeder.disconnect()
    })
  })

  describe('Seeder.teardown()', () => {
    it('is idempotent — calling twice does not throw', async () => {
      const deps = makeSeederDeps()
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      await seeder.teardown()
      await seeder.teardown() // Should not throw

      expect(deps.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Seeder.disconnect()', () => {
    it('is idempotent — calling twice does not throw', async () => {
      const deps = makeSeederDeps()
      const { Seeder } = await getSeederModule()
      const seeder = new Seeder(
        deps.connection,
        deps.schema as unknown as DatabaseSchema,
        deps.plan,
        deps.disconnect,
        { transaction: false, quiet: true, batchSize: 500 },
      )

      await seeder.disconnect()
      await seeder.disconnect()

      expect(deps.disconnect).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// 3. TableChain (src/api/builder.ts)
// ============================================================================

describe('TableChain', () => {
  const getTableChain = async () => (await import('../builder.js')).TableChain

  it('table() returns `this` for chaining', async () => {
    const TableChain = await getTableChain()
    const mockSeeder = { seed: vi.fn() } as unknown as Seeder
    const chain = new TableChain(mockSeeder)

    const returned = chain.table('users', 5)
    expect(returned).toBe(chain)
  })

  it('execute() calls seeder.seed() for each entry in order', async () => {
    const TableChain = await getTableChain()
    const seedFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1, name: 'Alice' }])
      .mockResolvedValueOnce([{ id: 1, title: 'Post 1' }])
    const mockSeeder = { seed: seedFn } as unknown as Seeder

    const chain = new TableChain(mockSeeder)
    chain.table('users', 5).table('posts', 10)

    await chain.execute()

    expect(seedFn).toHaveBeenCalledTimes(2)
    expect(seedFn.mock.calls[0][0]).toBe('users')
    expect(seedFn.mock.calls[0][1]).toBe(5)
    expect(seedFn.mock.calls[1][0]).toBe('posts')
    expect(seedFn.mock.calls[1][1]).toBe(10)

    // Called in order: users first, then posts
    expect(seedFn.mock.invocationCallOrder[0]).toBeLessThan(seedFn.mock.invocationCallOrder[1])
  })

  it('execute() returns results keyed by table name', async () => {
    const TableChain = await getTableChain()
    const seedFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }])
    const mockSeeder = { seed: seedFn } as unknown as Seeder

    const chain = new TableChain(mockSeeder)
    chain.table('users', 1).table('posts', 1)

    const results = await chain.execute()
    expect(results).toEqual({
      users: [{ id: 1 }],
      posts: [{ id: 2 }],
    })
  })

  it('passes per-table options through to seeder.seed()', async () => {
    const TableChain = await getTableChain()
    const seedFn = vi.fn().mockResolvedValue([])
    const mockSeeder = { seed: seedFn } as unknown as Seeder

    const opts = { columns: { name: { values: ['X'] } } }
    const chain = new TableChain(mockSeeder)
    chain.table('users', 3, opts)
    await chain.execute()

    expect(seedFn).toHaveBeenCalledWith('users', 3, opts)
  })
})

// ============================================================================
// 4. withSeed() — test helper (src/api/helpers.ts)
// ============================================================================

describe('withSeed()', () => {
  const getWithSeed = async () => (await import('../helpers.js')).withSeed

  it('returns seed and teardown functions', async () => {
    const withSeed = await getWithSeed()
    const result = withSeed('postgres://localhost/testdb')

    expect(typeof result.seed).toBe('function')
    expect(typeof result.teardown).toBe('function')
  })

  it('does not connect until first seed() call (lazy connection)', async () => {
    const withSeed = await getWithSeed()

    // Just calling withSeed should NOT trigger any connection
    withSeed('postgres://localhost/testdb')
    expect(mockConnectAndIntrospect).not.toHaveBeenCalled()
  })

  it('seed() establishes connection and calls seeder.seed()', async () => {
    // Setup mocks for the createSeeder path
    const disconnect = vi.fn().mockResolvedValue(undefined)
    mockConnectAndIntrospect.mockResolvedValue({
      connection: { type: 'none' },
      schema: makeMockSchema(),
      disconnect,
    })
    mockBuildInsertPlan.mockReturnValue({
      ordered: ['users'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    })

    // We need to mock createSeeder itself since withSeed dynamically imports it
    await import('../seeder.js')

    const withSeed = await getWithSeed()
    const { seed, teardown } = withSeed('postgres://localhost/testdb', {
      seed: 42,
      transaction: true,
    })

    // After constructing, no connection yet
    const callCountBefore = mockConnectAndIntrospect.mock.calls.length

    // The first seed() call should trigger connection
    mockGenerate.mockResolvedValue({
      tables: new Map([['users', { rows: [{ id: 1, name: 'A' }] }]]),
      deferredUpdates: [],
    })

    await seed('users', 5)

    // Now the connection should have been established
    expect(mockConnectAndIntrospect.mock.calls.length).toBeGreaterThan(callCountBefore)

    await teardown()
  })

  it('prevents concurrent connection attempts', async () => {
    mockConnectAndIntrospect.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                connection: { type: 'none' },
                schema: makeMockSchema(),
                disconnect: vi.fn().mockResolvedValue(undefined),
              }),
            50,
          ),
        ),
    )
    mockBuildInsertPlan.mockReturnValue({
      ordered: ['users'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    })
    mockGenerate.mockResolvedValue({
      tables: new Map([['users', { rows: [{ id: 1, name: 'A' }] }]]),
      deferredUpdates: [],
    })

    const withSeed = await getWithSeed()
    const { seed, teardown } = withSeed('postgres://localhost/testdb')

    // Fire two seed calls concurrently — should only connect once
    await Promise.all([seed('users', 1), seed('users', 1)])

    // connectAndIntrospect should only have been called once for this instance
    // (There may be prior calls from other tests, so check relative count)
    const connectCalls = mockConnectAndIntrospect.mock.calls.filter(
      (c) => c[0] === 'postgres://localhost/testdb',
    )
    expect(connectCalls.length).toBe(1)

    await teardown()
  })

  it('teardown() swallows errors', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    mockConnectAndIntrospect.mockResolvedValue({
      connection: { type: 'none' },
      schema: makeMockSchema(),
      disconnect,
    })
    mockBuildInsertPlan.mockReturnValue({
      ordered: ['users'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    })

    const withSeed = await getWithSeed()
    const { seed, teardown } = withSeed('postgres://localhost/testdb')

    // Force a connection by calling seed
    mockGenerate.mockResolvedValue({
      tables: new Map([['users', { rows: [{ id: 1, name: 'A' }] }]]),
      deferredUpdates: [],
    })
    await seed('users', 1)

    // Make the seeder's teardown throw
    disconnect.mockRejectedValue(new Error('disconnect failed'))

    // teardown should NOT throw
    await expect(teardown()).resolves.toBeUndefined()
  })

  it('teardown() works even if seed was never called', async () => {
    const withSeed = await getWithSeed()
    const { teardown } = withSeed('postgres://localhost/testdb')

    // No seed() call means no connecting promise — should still resolve
    await expect(teardown()).resolves.toBeUndefined()
  })
})
