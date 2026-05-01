import { describe, it, expect } from 'vitest'
import { generateAndStream, __testing, type TableStreamConsumer } from '../generate-streaming.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { InsertPlan } from '../../graph/types.js'
import type { Row } from '../types.js'
import { generateTableStream, generateTableRows } from '../generate-table.js'
import { ReferencePoolManager } from '../reference-pool.js'
import { UniqueTracker } from '../unique-tracker.js'
import { createGenerationConfig } from '../config.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import { mapTable } from '../../mapping/mapper.js'

// ─── Fixtures ───────────────────────────────────────────────────────────

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

function makeTable(
  name: string,
  columns: Map<string, ColumnDef>,
  overrides: Partial<TableDef> = {},
): TableDef {
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
    ...overrides,
  }
}

function emptyExistingData() {
  return {
    rowCount: 0,
    existingPKs: [],
    existingUniqueValues: new Map(),
    sequenceValues: new Map(),
  }
}

// ─── teeStream ──────────────────────────────────────────────────────────

describe('teeStream', () => {
  it('yields every source row downstream while accumulating into retained', async () => {
    const source: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const sourceGen = (async function* () {
      for (const r of source) yield r
    })()

    const retained: Row[] = []
    const downstream: Row[] = []
    for await (const row of __testing.teeStream(sourceGen, retained)) {
      downstream.push(row)
    }

    expect(downstream).toEqual(source)
    expect(retained).toEqual(source)
  })

  it('does not duplicate rows when consumer pulls synchronously', async () => {
    const source: Row[] = Array.from({ length: 10 }, (_, i) => ({ n: i }))
    const sourceGen = (async function* () {
      for (const r of source) yield r
    })()

    const retained: Row[] = []
    const seen: Row[] = []
    const teed = __testing.teeStream(sourceGen, retained)
    for await (const row of teed) {
      seen.push(row)
    }

    expect(seen.length).toBe(10)
    expect(retained.length).toBe(10)
    expect(seen).toEqual(retained)
  })

  it('handles empty source correctly', async () => {
    const retained: Row[] = []
    const teed = __testing.teeStream(
      (async function* () {
        // no yields
      })(),
      retained,
    )
    const seen: Row[] = []
    for await (const row of teed) seen.push(row)

    expect(seen).toEqual([])
    expect(retained).toEqual([])
  })
})

// ─── captureMeta ────────────────────────────────────────────────────────

describe('captureMeta', () => {
  it('yields rows and stores final return value in metaRef', async () => {
    async function* source() {
      yield { id: 1 }
      yield { id: 2 }
      return { tableName: 'public.t', generatedPKs: [[1], [2]], rowCount: 2 }
    }
    const metaRef: {
      meta: { tableName: string; generatedPKs: unknown[][]; rowCount: number } | null
    } = { meta: null }
    const rows: Row[] = []
    for await (const row of __testing.captureMeta(source(), metaRef)) {
      rows.push(row)
    }

    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
    expect(metaRef.meta).toEqual({
      tableName: 'public.t',
      generatedPKs: [[1], [2]],
      rowCount: 2,
    })
  })

  it('captures meta when source yields zero rows', async () => {
    async function* source() {
      if (false as boolean) yield {} as Row
      return { tableName: 'public.empty', generatedPKs: [], rowCount: 0 }
    }
    const metaRef: {
      meta: { tableName: string; generatedPKs: unknown[][]; rowCount: number } | null
    } = { meta: null }
    const rows: Row[] = []
    for await (const row of __testing.captureMeta(source(), metaRef)) {
      rows.push(row)
    }
    expect(rows).toEqual([])
    expect(metaRef.meta?.rowCount).toBe(0)
  })
})

// ─── generateTableStream vs generateTableRows parity ────────────────────

describe('generateTableStream ↔ generateTableRows parity', () => {
  function buildItemsTable(): TableDef {
    return makeTable(
      'items',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        ['price', makeColumn('price', { dataType: NormalizedType.NUMERIC })],
      ]),
    )
  }

  async function collectStream(gen: AsyncGenerator<Row, unknown, undefined>): Promise<Row[]> {
    const rows: Row[] = []
    for await (const row of gen) rows.push(row)
    return rows
  }

  it('produces identical rows for the simple case with same seed', async () => {
    const table = buildItemsTable()
    const config = createGenerationConfig({ globalRowCount: 15, seed: 42 })

    const syncResult = generateTableRows({
      table,
      mappingResult: mapTable(table),
      config,
      faker: createSeededFaker(42),
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
    })

    const streamRows = await collectStream(
      generateTableStream({
        table,
        mappingResult: mapTable(table),
        config,
        faker: createSeededFaker(42),
        referencePool: new ReferencePoolManager(),
        uniqueTracker: new UniqueTracker(),
        existingData: emptyExistingData(),
        deferredFKColumns: new Set(),
      }),
    )

    expect(streamRows).toEqual(syncResult.rows)
  })

  it('respects aiTextPool identically across sync and stream', async () => {
    const table = makeTable(
      'posts',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['title', makeColumn('title', { dataType: NormalizedType.VARCHAR })],
        ['body', makeColumn('body', { dataType: NormalizedType.TEXT })],
      ]),
    )
    const config = createGenerationConfig({ globalRowCount: 6, seed: 7 })
    const aiTextPool = new Map([
      ['public.posts.body', ['AI-body-one', 'AI-body-two', 'AI-body-three']],
    ])

    const sync = generateTableRows({
      table,
      mappingResult: mapTable(table),
      config,
      faker: createSeededFaker(7),
      referencePool: new ReferencePoolManager(),
      uniqueTracker: new UniqueTracker(),
      existingData: emptyExistingData(),
      deferredFKColumns: new Set(),
      aiTextPool,
    })

    const stream = await collectStream(
      generateTableStream({
        table,
        mappingResult: mapTable(table),
        config,
        faker: createSeededFaker(7),
        referencePool: new ReferencePoolManager(),
        uniqueTracker: new UniqueTracker(),
        existingData: emptyExistingData(),
        deferredFKColumns: new Set(),
        aiTextPool,
      }),
    )

    expect(stream).toEqual(sync.rows)
    // Spot-check: body values came from the pool
    expect(sync.rows[0].body).toMatch(/^AI-body-/)
    expect(stream[0].body).toMatch(/^AI-body-/)
  })
})

// ─── generateAndStream orchestrator ─────────────────────────────────────

describe('generateAndStream orchestrator', () => {
  function recordingConsumer(received: Map<string, Row[]>): TableStreamConsumer {
    return async (info, rowStream) => {
      const rows: Row[] = []
      for await (const row of rowStream) rows.push(row)
      received.set(info.tableName, rows)
      return { insertedCount: rows.length }
    }
  }

  it('walks plan.ordered and hands each table to the consumer once', async () => {
    const users = makeTable(
      'users',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['email', makeColumn('email', { dataType: NormalizedType.VARCHAR })],
      ]),
    )
    const posts = makeTable(
      'posts',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ]),
      {
        foreignKeys: [
          {
            name: 'posts_user_id_fkey',
            columns: ['user_id'],
            referencedTable: 'users',
            referencedSchema: 'public',
            referencedColumns: ['id'],
            onDelete: FKAction.NO_ACTION,
            onUpdate: FKAction.NO_ACTION,
            isDeferrable: false,
            isDeferred: false,
            isVirtual: false,
          },
        ],
      },
    )

    const schema: DatabaseSchema = {
      name: 'public',
      tables: new Map([
        ['public.users', users],
        ['public.posts', posts],
      ]),
      enums: new Map(),
      schemas: ['public'],
    }

    const plan: InsertPlan = {
      ordered: ['public.users', 'public.posts'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }

    const received = new Map<string, Row[]>()
    const result = await generateAndStream(
      schema,
      plan,
      null,
      { globalRowCount: 4, seed: 123 },
      recordingConsumer(received),
    )

    expect(received.size).toBe(2)
    expect(received.get('public.users')?.length).toBe(4)
    expect(received.get('public.posts')?.length).toBe(4)

    // FK values on posts should all come from the generated users PKs
    const userIds = new Set(received.get('public.users')!.map((r) => r.id))
    for (const post of received.get('public.posts')!) {
      expect(userIds.has(post.user_id)).toBe(true)
    }

    expect(result.rowsPerTable.get('public.users')).toBe(4)
    expect(result.rowsPerTable.get('public.posts')).toBe(4)
    expect(result.deferredUpdates).toEqual([])
  })

  it('produces row counts consistent with globalRowCount', async () => {
    const simple = makeTable(
      'simple',
      new Map([['id', makeColumn('id', { dataType: NormalizedType.UUID })]]),
    )
    const schema: DatabaseSchema = {
      name: 'public',
      tables: new Map([['public.simple', simple]]),
      enums: new Map(),
      schemas: ['public'],
    }
    const plan: InsertPlan = {
      ordered: ['public.simple'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }

    const received = new Map<string, Row[]>()
    await generateAndStream(
      schema,
      plan,
      null,
      { globalRowCount: 17, seed: 1 },
      recordingConsumer(received),
    )
    expect(received.get('public.simple')?.length).toBe(17)
  })

  it('throws when the consumer fails to drain the stream', async () => {
    const t = makeTable(
      'bad',
      new Map([['id', makeColumn('id', { dataType: NormalizedType.UUID })]]),
    )
    const schema: DatabaseSchema = {
      name: 'public',
      tables: new Map([['public.bad', t]]),
      enums: new Map(),
      schemas: ['public'],
    }
    const plan: InsertPlan = {
      ordered: ['public.bad'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }

    const lazyConsumer: TableStreamConsumer = async () => {
      // Does not iterate rowStream at all
      return { insertedCount: 0 }
    }

    await expect(
      generateAndStream(schema, plan, null, { globalRowCount: 3 }, lazyConsumer),
    ).rejects.toThrow(/did not drain/)
  })

  it('retains rows and runs deferred updates for self-ref tables', async () => {
    const categories = makeTable(
      'categories',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        [
          'parent_id',
          makeColumn('parent_id', { dataType: NormalizedType.INTEGER, isNullable: true }),
        ],
      ]),
      {
        foreignKeys: [
          {
            name: 'categories_parent_id_fkey',
            columns: ['parent_id'],
            referencedTable: 'categories',
            referencedSchema: 'public',
            referencedColumns: ['id'],
            onDelete: FKAction.NO_ACTION,
            onUpdate: FKAction.NO_ACTION,
            isDeferrable: false,
            isDeferred: false,
            isVirtual: false,
          },
        ],
      },
    )

    const schema: DatabaseSchema = {
      name: 'public',
      tables: new Map([['public.categories', categories]]),
      enums: new Map(),
      schemas: ['public'],
    }

    const plan: InsertPlan = {
      ordered: ['public.categories'],
      deferredEdges: [],
      selfRefTables: ['public.categories'],
      warnings: [],
    }

    const received = new Map<string, Row[]>()
    const result = await generateAndStream(
      schema,
      plan,
      null,
      { globalRowCount: 8, seed: 99, nullableRate: 0 },
      recordingConsumer(received),
    )

    // All 8 rows flowed through the consumer
    expect(received.get('public.categories')?.length).toBe(8)

    // First insert set parent_id to NULL (deferred column)
    for (const row of received.get('public.categories')!) {
      expect(row.parent_id).toBeNull()
    }

    // Deferred updates were generated to populate parent_id later
    // (Exact count depends on faker — just assert some were produced)
    expect(result.deferredUpdates.length).toBeGreaterThan(0)
    for (const upd of result.deferredUpdates) {
      expect(upd.tableName).toBe('public.categories')
      expect(upd.setColumns).toContain('parent_id')
    }
  })
})
