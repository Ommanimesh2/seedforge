import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Client } from 'pg'
import type { DatabaseSchema } from '../../types/schema.js'
import { resolveTable } from '../../types/resolve.js'
import type { InsertPlan } from '../../graph/types.js'
import type { GenerationConfig, Row } from '../../generate/types.js'
import {
  generateAndStream,
  type TableStreamConsumer,
  type TableStreamInfo,
} from '../../generate/generate-streaming.js'
import { rowToCsvLine } from '../pg-copy-format.js'
import type { InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { buildUpdateSQL } from '../sql-builder.js'
import { findSequences, resetSequences } from '../sequences.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Type augmentation: pg Client accepting a CopyFromQueryStream via query().
 */
interface CopyClient {
  query(stream: NodeJS.WritableStream): NodeJS.WritableStream
}

/**
 * Determine insertable columns for a row. Excludes GENERATED ALWAYS AS columns.
 *
 * Uses the keys present in the first row (which the generator produces with
 * consistent shape per-table), intersected with non-generated columns from
 * the schema.
 */
function getInsertableColumns(
  tableDef: { columns: Map<string, { name: string; isGenerated: boolean }> },
  sampleRow: Row,
): string[] {
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    return colDef && !colDef.isGenerated
  })
}

/**
 * Build a row-line AsyncGenerator from an AsyncIterable<Row> for streaming
 * into pg-copy-streams. Reports progress every PROGRESS_THROTTLE rows.
 */
async function* rowsToCsvLines(
  rowIterable: AsyncIterable<Row>,
  columns: string[],
  onProgress: (insertedSoFar: number) => void,
  initialRow: Row | null = null,
): AsyncGenerator<string, void, undefined> {
  let count = 0
  const emit = (row: Row) => {
    count++
    return rowToCsvLine(row, columns) + '\n'
  }

  if (initialRow !== null) {
    yield emit(initialRow)
  }

  for await (const row of rowIterable) {
    yield emit(row)
    if (count % 1000 === 0) {
      onProgress(count)
    }
  }
  onProgress(count)
}

/**
 * Create a streaming consumer that pipes rows through pg-copy-streams.
 *
 * Wraps the COPY in a BEGIN/COMMIT transaction per table. Honors pg-copy-
 * streams backpressure via pipeline(). Buffers only the first row to derive
 * the column list — memory stays flat otherwise.
 */
export function createPgCopyConsumer(
  client: Client,
  progress: ProgressReporter,
  rowsPerTable: Map<string, number>,
): TableStreamConsumer {
  return async function consume(info: TableStreamInfo, rowStream: AsyncIterable<Row>) {
    const { table, tableName, rowCount } = info

    // Get underlying iterator so we can peek the first row for column discovery.
    const iterator = rowStream[Symbol.asyncIterator]()
    const firstResult = await iterator.next()
    if (firstResult.done) {
      // No rows for this table (e.g. globalRowCount=0)
      progress.startTable(tableName, 0)
      progress.finishTable(tableName, 0, 0)
      rowsPerTable.set(tableName, 0)
      return { insertedCount: 0 }
    }

    const firstRow = firstResult.value
    const columns = getInsertableColumns(table, firstRow)
    const qualifiedTable = `"${table.schema}"."${table.name}"`
    const quotedColumns = columns.map((c) => `"${c}"`).join(', ')
    const copySQL = `COPY ${qualifiedTable} (${quotedColumns}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`

    progress.startTable(tableName, rowCount)
    const tableStart = Date.now()

    // Re-wrap the iterator so for-await-of can consume the remaining rows.
    const rest: AsyncIterable<Row> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => iterator.next(),
          return: iterator.return ? (v: unknown) => iterator.return!(v) : undefined,
          throw: iterator.throw ? (e: unknown) => iterator.throw!(e) : undefined,
        } as AsyncIterator<Row>
      },
    }

    const pgCopyStreams = await import('pg-copy-streams')
    const copyFrom = pgCopyStreams.from

    try {
      await client.query('BEGIN')

      const copyStream = (client as unknown as CopyClient).query(copyFrom(copySQL))

      const linesGen = rowsToCsvLines(
        rest,
        columns,
        (insertedSoFar) => progress.updateTable(tableName, insertedSoFar, rowCount),
        firstRow,
      )

      // Readable.from handles backpressure: when the downstream Writable
      // returns false, the generator is paused until drain.
      const readable = Readable.from(linesGen, { objectMode: false })
      await pipeline(readable, copyStream as NodeJS.WritableStream)

      await client.query('COMMIT')
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Swallow rollback errors
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw new InsertionError(
        'SF4001',
        `COPY failed for table ${tableName}: ${detail}`,
        [
          'Check for unique constraint violations (try reducing row count)',
          'Check for NOT NULL constraint violations',
          'The --fast flag uses COPY which may have stricter type requirements',
          'Try running without --fast to use batched INSERTs instead',
        ],
        { tableName },
      )
    }

    const tableElapsed = Date.now() - tableStart
    progress.finishTable(tableName, rowCount, tableElapsed)
    rowsPerTable.set(tableName, rowCount)

    return { insertedCount: rowCount }
  }
}

/**
 * Fused generate+COPY pipeline for --fast PostgreSQL insertion.
 *
 * Streams rows directly from the generator into PostgreSQL COPY per table,
 * never materializing the full row set in memory. Handles deferred updates
 * for self-ref and cycle-broken edges, then resets sequences.
 */
export async function executeFastPgPipeline(
  schema: DatabaseSchema,
  plan: InsertPlan,
  client: Client,
  config: Partial<GenerationConfig> | undefined,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  const startTime = Date.now()
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  let deferredUpdatesApplied = 0
  let sequencesReset = 0

  const consumer = createPgCopyConsumer(client, progress, rowsPerTable)

  // 1. Streaming generation + COPY per table
  const streamResult = await generateAndStream(schema, plan, client, config, consumer)
  const warnings: string[] = [...streamResult.warnings]

  for (const count of rowsPerTable.values()) {
    totalRowsInserted += count
  }

  // 2. Apply deferred updates (same pattern as executeDirect/executePgCopy)
  if (streamResult.deferredUpdates.length > 0) {
    const updatesByTable = new Map<string, typeof streamResult.deferredUpdates>()
    for (const update of streamResult.deferredUpdates) {
      const existing = updatesByTable.get(update.tableName) ?? []
      existing.push(update)
      updatesByTable.set(update.tableName, existing)
    }

    for (const [tableName, updates] of updatesByTable) {
      const tableDef = resolveTable(schema, tableName)
      if (!tableDef) continue

      try {
        await client.query('BEGIN')
        for (const update of updates) {
          for (let i = 0; i < update.setColumns.length; i++) {
            const sql = buildUpdateSQL(
              tableDef.name,
              tableDef.schema,
              update.pkColumns,
              update.pkValues,
              update.setColumns[i],
              update.setValues[i],
            )
            await client.query(sql)
          }
          deferredUpdatesApplied++
        }
        await client.query('COMMIT')
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Swallow rollback errors
        }
        const detail = err instanceof Error ? err.message : String(err)
        const colName = updates.length > 0 ? updates[0].setColumns.join(', ') : 'unknown'
        throw new InsertionError(
          'SF4002',
          `Deferred UPDATE failed for ${tableName}.${colName}: ${detail}`,
          [
            'This may indicate an issue with circular FK resolution',
            'Check that the referenced row exists',
          ],
          { tableName, column: colName },
        )
      }
    }
  }

  // 3. Reset sequences
  try {
    const schemaMap = new Map<string, string[]>()
    for (const tableName of plan.ordered) {
      const tableDef = resolveTable(schema, tableName)
      if (tableDef) {
        const tables = schemaMap.get(tableDef.schema) ?? []
        tables.push(tableDef.name)
        schemaMap.set(tableDef.schema, tables)
      }
    }
    for (const [schemaName, tableNames] of schemaMap) {
      const sequences = await findSequences(client, schemaName, tableNames)
      sequencesReset += await resetSequences(client, sequences)
    }
  } catch (err) {
    if (err instanceof InsertionError) {
      warnings.push(err.message)
    } else {
      const detail = err instanceof Error ? err.message : String(err)
      warnings.push(`Sequence reset failed: ${detail}`)
    }
  }

  const elapsedMs = Date.now() - startTime

  return {
    tablesSeeded: rowsPerTable.size,
    totalRowsInserted,
    rowsPerTable,
    deferredUpdatesApplied,
    sequencesReset,
    elapsedMs,
    warnings,
    mode: OutputMode.DIRECT,
  }
}
