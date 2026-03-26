import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import type { OutputOptions, InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { buildBatchedInserts } from '../batcher.js'

/**
 * Dry-run executor: generates data summary without executing anything.
 *
 * No database interaction, no file writes. Only stderr output.
 */
export async function executeDryRun(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  orderedTables: string[],
  _options: OutputOptions,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  const startTime = Date.now()
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  const warnings = [...generationResult.warnings]

  // 1. Show what would be inserted for each table
  for (const tableName of orderedTables) {
    const tableResult = generationResult.tables.get(tableName)
    if (!tableResult || tableResult.rows.length === 0) {
      continue
    }

    const tableDef = schema.tables.get(tableName)
    if (!tableDef) continue

    const rows = tableResult.rows
    const columns = getInsertableColumns(tableDef, rows[0])
    const totalRows = rows.length

    const batches = buildBatchedInserts(
      tableDef.name,
      tableDef.schema,
      columns,
      rows,
      _options.batchSize,
    )

    process.stderr.write(
      `[DRY RUN] ${tableDef.schema}.${tableDef.name}: ${totalRows} rows, ${batches.length} batches\n`,
    )

    rowsPerTable.set(tableName, totalRows)
    totalRowsInserted += totalRows
  }

  // 2. Show deferred update count
  const deferredCount = generationResult.deferredUpdates.length
  if (deferredCount > 0) {
    process.stderr.write(
      `[DRY RUN] Deferred updates: ${deferredCount} UPDATE statements\n`,
    )
  }

  // 3. Show sequence info
  const sequenceCount = countSequencesFromSchema(schema, orderedTables)
  if (sequenceCount > 0) {
    process.stderr.write(
      `[DRY RUN] Sequences to reset: ${sequenceCount}\n`,
    )
  }

  const elapsedMs = Date.now() - startTime

  const summary: InsertionSummary = {
    tablesSeeded: rowsPerTable.size,
    totalRowsInserted,
    rowsPerTable,
    deferredUpdatesApplied: 0,
    sequencesReset: 0,
    elapsedMs,
    warnings,
    mode: OutputMode.DRY_RUN,
  }

  progress.printSummary(summary)

  return summary
}

/**
 * Count sequences from schema metadata (no DB query).
 */
function countSequencesFromSchema(
  schema: DatabaseSchema,
  orderedTables: string[],
): number {
  let count = 0
  for (const tableName of orderedTables) {
    const tableDef = schema.tables.get(tableName)
    if (!tableDef) continue
    for (const [, colDef] of tableDef.columns) {
      if (colDef.isAutoIncrement) {
        count++
      }
    }
  }
  return count
}

/**
 * Determine which columns to insert for a table.
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
