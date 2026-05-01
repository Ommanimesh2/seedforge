import type { Client } from 'pg'
import type { DatabaseSchema, TableDef } from '../types/schema.js'
import { resolveTable } from '../types/resolve.js'
import type { DependencyEdge, InsertPlan } from '../graph/types.js'
import type { DeferredUpdate, GenerationConfig, Row, ExistingData } from './types.js'
import { createGenerationConfig, getRowCount } from './config.js'
import { createSeededFaker } from '../mapping/seeded-faker.js'
import { mapTable } from '../mapping/mapper.js'
import { ReferencePoolManager } from './reference-pool.js'
import { UniqueTracker } from './unique-tracker.js'
import { queryExistingData } from './existing-data.js'
import { generateTableStream, type TableStreamMeta } from './generate-table.js'
import { generateDeferredUpdates } from './deferred-updates.js'
import { resolveCardinalityForTable } from './cardinality.js'
import { generationFailure } from '../errors/index.js'

/**
 * Per-table info passed to a streaming consumer.
 */
export interface TableStreamInfo {
  table: TableDef
  tableName: string
  /** Total rows the generator will yield for this table (pre-computed) */
  rowCount: number
}

/**
 * A consumer that receives a stream of rows for one table and writes them
 * to the destination (PG COPY, MySQL LOAD DATA, etc.).
 *
 * Must fully drain `rowStream` before resolving. Returning early leaves
 * the underlying generator incomplete and causes a streaming error.
 */
export type TableStreamConsumer = (
  info: TableStreamInfo,
  rowStream: AsyncIterable<Row>,
) => Promise<{ insertedCount: number }>

/**
 * Result of the streaming generation pipeline.
 *
 * Unlike the non-streaming path, no per-table row array is retained — only
 * totals, deferred updates, and warnings. Rows for tables that need deferred
 * updates (self-ref or cycle-broken edges) are retained internally during
 * the run but released once their updates are generated.
 */
export interface StreamPipelineResult {
  rowsPerTable: Map<string, number>
  deferredUpdates: DeferredUpdate[]
  warnings: string[]
}

function emptyExistingData(): ExistingData {
  return {
    rowCount: 0,
    existingPKs: [],
    existingUniqueValues: new Map(),
    sequenceValues: new Map(),
  }
}

/**
 * Tee an async iterable: yields each row downstream while pushing into
 * `retained`. The downstream consumer sees the exact same row sequence it
 * would see from the original iterable.
 */
async function* teeStream(
  source: AsyncIterable<Row>,
  retained: Row[],
): AsyncGenerator<Row, void, undefined> {
  for await (const row of source) {
    retained.push(row)
    yield row
  }
}

/**
 * Wrap a TableStreamMeta-returning generator as an AsyncIterable, capturing
 * the final return value into `metaRef` so the caller can pick up PK tuples
 * after the consumer finishes draining.
 */
async function* captureMeta(
  gen: AsyncGenerator<Row, TableStreamMeta, undefined>,
  metaRef: { meta: TableStreamMeta | null },
): AsyncGenerator<Row, void, undefined> {
  while (true) {
    const { value, done } = await gen.next()
    if (done) {
      metaRef.meta = value
      return
    }
    yield value
  }
}

/**
 * Streaming orchestrator that fuses generation and output per-table.
 *
 * Walks the insert plan in topological order. For each table, creates a
 * generator stream and hands it to `consumer`. Captures PK tuples from
 * each generator's return value and feeds them into the reference pool so
 * downstream tables can FK-reference them.
 *
 * Tables that appear in `plan.deferredEdges` (as `from`) or in
 * `plan.selfRefTables` have their rows teed into an in-memory buffer so
 * that `generateDeferredUpdates()` can run at the right moment. Every
 * other table streams through without row retention, keeping memory flat.
 */
export async function generateAndStream(
  schema: DatabaseSchema,
  plan: InsertPlan,
  client: Client | null,
  config: Partial<GenerationConfig> | undefined,
  consumer: TableStreamConsumer,
): Promise<StreamPipelineResult> {
  const genConfig = createGenerationConfig(config)
  const faker = createSeededFaker(genConfig.seed)
  const referencePool = new ReferencePoolManager()
  const uniqueTracker = new UniqueTracker()
  const warnings: string[] = [...plan.warnings]

  const rowsPerTable = new Map<string, number>()
  const deferredUpdates: DeferredUpdate[] = []

  // Build deferred FK column lookup (same logic as generate.ts)
  const deferredColumnMap = new Map<string, Set<string>>()
  for (const edge of plan.deferredEdges) {
    const existing = deferredColumnMap.get(edge.from) ?? new Set<string>()
    for (const col of edge.fk.columns) {
      existing.add(col)
    }
    deferredColumnMap.set(edge.from, existing)
  }

  const selfRefEdges = new Map<string, DependencyEdge[]>()
  for (const tableName of plan.selfRefTables) {
    const table = resolveTable(schema, tableName)
    if (!table) continue

    const edges: DependencyEdge[] = []
    for (const fk of table.foreignKeys) {
      const refTable = `${fk.referencedSchema}.${fk.referencedTable}`
      if (refTable === tableName) {
        const existing = deferredColumnMap.get(tableName) ?? new Set<string>()
        for (const col of fk.columns) {
          existing.add(col)
        }
        deferredColumnMap.set(tableName, existing)
        edges.push({
          from: tableName,
          to: tableName,
          fk,
          isNullable: fk.columns.every((col) => {
            const colDef = table.columns.get(col)
            return colDef !== undefined && colDef.isNullable
          }),
          isSelfRef: true,
        })
      }
    }
    if (edges.length > 0) {
      selfRefEdges.set(tableName, edges)
    }
  }

  // Retained rows per table, only populated for tables with deferred or
  // self-ref edges. Released after deferred update processing.
  const retainedRowsByTable = new Map<string, Row[]>()

  for (const tableName of plan.ordered) {
    const table = resolveTable(schema, tableName)
    if (!table) {
      warnings.push(`Table ${tableName} not found in schema, skipping`)
      continue
    }

    try {
      let existingData: ExistingData
      if (client) {
        existingData = await queryExistingData(client, table)
        if (table.primaryKey) {
          referencePool.initFromExisting(
            tableName,
            table.primaryKey.columns,
            existingData.existingPKs,
          )
        }
      } else {
        existingData = emptyExistingData()
      }

      const mapping = mapTable(table)

      const deferredFKColumns = deferredColumnMap.get(tableName) ?? new Set<string>()
      let fkAssignments: Map<string, unknown[][]> | undefined
      const cardinalityConfig = genConfig.tableCardinalityConfigs?.get(tableName)
      if (cardinalityConfig && cardinalityConfig.size > 0) {
        const rowCount = getRowCount(genConfig, tableName)
        if (rowCount > 0) {
          fkAssignments = resolveCardinalityForTable(
            table,
            referencePool,
            cardinalityConfig,
            rowCount,
            faker,
            deferredFKColumns,
          )
        }
      }

      const needsRetention =
        selfRefEdges.has(tableName) || plan.deferredEdges.some((edge) => edge.from === tableName)

      const gen = generateTableStream({
        table,
        mappingResult: mapping,
        config: genConfig,
        faker,
        referencePool,
        uniqueTracker,
        existingData,
        deferredFKColumns,
        fkAssignments,
        aiTextPool: genConfig.aiTextPool,
      })

      const metaRef: { meta: TableStreamMeta | null } = { meta: null }
      const metaCapturedStream = captureMeta(gen, metaRef)

      const retained: Row[] = []
      const streamForConsumer: AsyncIterable<Row> = needsRetention
        ? teeStream(metaCapturedStream, retained)
        : metaCapturedStream

      const tableRowCount = getRowCount(genConfig, tableName)
      await consumer({ table, tableName, rowCount: tableRowCount }, streamForConsumer)

      if (!metaRef.meta) {
        throw new Error(`Streaming consumer for ${tableName} did not drain all rows`)
      }

      if (metaRef.meta.generatedPKs.length > 0) {
        referencePool.addGenerated(tableName, metaRef.meta.generatedPKs)
      }

      rowsPerTable.set(tableName, metaRef.meta.rowCount)

      if (needsRetention) {
        retainedRowsByTable.set(tableName, retained)

        const selfEdges = selfRefEdges.get(tableName)
        if (selfEdges && selfEdges.length > 0) {
          const updates = generateDeferredUpdates({
            tableName,
            table,
            generatedRows: retained,
            generatedPKs: metaRef.meta.generatedPKs,
            deferredFKEdges: selfEdges,
            referencePool,
            faker,
          })
          deferredUpdates.push(...updates)
        }
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw err
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw generationFailure(tableName, detail)
    }
  }

  // Process cycle-broken deferred edges (needs retained rows from earlier)
  for (const edge of plan.deferredEdges) {
    const tableName = edge.from
    const table = resolveTable(schema, tableName)
    if (!table) continue

    const retained = retainedRowsByTable.get(tableName)
    if (!retained) continue

    const pks: unknown[][] = []
    if (table.primaryKey) {
      for (const row of retained) {
        const pk = table.primaryKey.columns.map((c) => row[c])
        if (pk.every((v) => v !== undefined)) pks.push(pk)
      }
    }

    try {
      const updates = generateDeferredUpdates({
        tableName,
        table,
        generatedRows: retained,
        generatedPKs: pks,
        deferredFKEdges: [edge],
        referencePool,
        faker,
      })
      deferredUpdates.push(...updates)
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw err
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw generationFailure(tableName, detail)
    }
  }

  return { rowsPerTable, deferredUpdates, warnings }
}

/**
 * Exported for unit testing.
 */
export const __testing = { teeStream, captureMeta }
