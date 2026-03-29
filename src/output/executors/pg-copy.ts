import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import { resolveTable } from '../../types/resolve.js'
import type { OutputOptions, InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { buildUpdateSQL } from '../sql-builder.js'
import { findSequences, resetSequences } from '../sequences.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Format a single value for COPY CSV format.
 *
 * Rules:
 * - NULL -> \N
 * - Strings containing commas, quotes, newlines, or backslashes are quoted
 * - Quotes inside quoted strings are doubled
 * - Date -> ISO string
 * - Buffer/Uint8Array -> hex
 * - Objects -> JSON string
 * - Arrays -> PostgreSQL array literal
 */
export function formatCopyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '\\N'
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return '\\x' + buf.toString('hex')
  }

  if (Array.isArray(value)) {
    // PostgreSQL array literal format
    const formatted = value.map((v) => {
      if (v === null || v === undefined) return 'NULL'
      return String(v)
    })
    return csvQuote(`{${formatted.join(',')}}`)
  }

  if (typeof value === 'object') {
    return csvQuote(JSON.stringify(value))
  }

  if (typeof value === 'boolean') {
    return value ? 't' : 'f'
  }

  const str = String(value)
  return csvQuote(str)
}

/**
 * Quote a string for CSV format if it contains special characters.
 * Doubles internal quotes per CSV spec.
 */
function csvQuote(str: string): string {
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r') ||
    str.includes('\\')
  ) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * Convert a row object to a CSV line for COPY FROM STDIN.
 *
 * @param row - Row data keyed by column name
 * @param columns - Ordered column names
 * @returns CSV line (no trailing newline)
 */
export function rowToCsvLine(
  row: Record<string, unknown>,
  columns: string[],
): string {
  return columns.map((col) => formatCopyValue(row[col] ?? null)).join(',')
}

/**
 * Execute COPY FROM STDIN for fast PostgreSQL bulk insertion.
 *
 * Uses pg-copy-streams to stream rows as CSV directly into PostgreSQL's
 * COPY protocol, which is significantly faster than batched INSERTs
 * for large datasets.
 *
 * Each table's COPY is wrapped in a transaction.
 * On failure, the current table is rolled back.
 * Deferred UPDATEs are applied after all COPYs.
 * Sequences are reset after all data is inserted.
 */
export async function executePgCopy(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  orderedTables: string[],
  options: OutputOptions,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  // Dynamically import pg-copy-streams to avoid hard dependency at module level
  const pgCopyStreams = await import('pg-copy-streams')
  const copyFrom = pgCopyStreams.from

  const startTime = Date.now()
  const client = options.client!
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  let deferredUpdatesApplied = 0
  let sequencesReset = 0
  const warnings = [...generationResult.warnings]

  // 1. COPY rows for each table in order
  for (const tableName of orderedTables) {
    const tableResult = generationResult.tables.get(tableName)
    if (!tableResult || tableResult.rows.length === 0) {
      continue
    }

    const tableDef = resolveTable(schema, tableName)
    if (!tableDef) continue

    const rows = tableResult.rows
    const columns = getInsertableColumns(tableDef, rows[0])
    const totalRows = rows.length

    const qualifiedTable = `"${tableDef.schema}"."${tableDef.name}"`
    const quotedColumns = columns.map((c) => `"${c}"`).join(', ')
    const copySQL = `COPY ${qualifiedTable} (${quotedColumns}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`

    progress.startTable(tableName, totalRows)
    const tableStart = Date.now()

    try {
      await client.query('BEGIN')

      // Create COPY stream
      const copyStream = (client as CopyClient).query(copyFrom(copySQL))

      // Create readable stream from rows
      let rowIndex = 0
      const rowStream = new Readable({
        read() {
          // Push rows in chunks to avoid backpressure issues
          const chunkSize = 1000
          let pushed = 0
          while (rowIndex < totalRows && pushed < chunkSize) {
            const line = rowToCsvLine(rows[rowIndex], columns) + '\n'
            this.push(line)
            rowIndex++
            pushed++
          }
          if (pushed > 0) {
            progress.updateTable(tableName, rowIndex, totalRows)
          }
          if (rowIndex >= totalRows) {
            this.push(null) // Signal end
          }
        },
      })

      await pipeline(rowStream, copyStream)
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
    progress.finishTable(tableName, totalRows, tableElapsed)
    rowsPerTable.set(tableName, totalRows)
    totalRowsInserted += totalRows
  }

  // 2. Apply deferred updates (same as direct executor)
  if (generationResult.deferredUpdates.length > 0) {
    const updatesByTable = new Map<string, typeof generationResult.deferredUpdates>()
    for (const update of generationResult.deferredUpdates) {
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
    for (const tableName of orderedTables) {
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

/**
 * Determine which columns to insert for a table.
 * Excludes auto-generated columns that are not present in the row data.
 */
function getInsertableColumns(
  tableDef: { columns: Map<string, { name: string; isGenerated: boolean }> },
  sampleRow: Record<string, unknown>,
): string[] {
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    return colDef && !colDef.isGenerated
  })
}

/**
 * Type augmentation: pg Client with support for query() returning a writable stream
 * when passed a CopyFromQueryStream.
 */
interface CopyClient {
  query(stream: NodeJS.WritableStream): NodeJS.WritableStream
}
