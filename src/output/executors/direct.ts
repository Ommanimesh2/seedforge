import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import type { OutputOptions, InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { buildBatchedInserts } from '../batcher.js'
import { buildUpdateSQL } from '../sql-builder.js'
import { findSequences, resetSequences } from '../sequences.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Execute INSERT statements directly against a PostgreSQL database via the pg client.
 *
 * Each table's inserts are wrapped in a BEGIN/COMMIT transaction.
 * On failure, the current table is rolled back.
 * Deferred UPDATEs are applied after all INSERTs.
 * Sequences are reset after all data is inserted.
 */
export async function executeDirect(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  orderedTables: string[],
  options: OutputOptions,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  const startTime = Date.now()
  const client = options.client!
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  let deferredUpdatesApplied = 0
  let sequencesReset = 0
  const warnings = [...generationResult.warnings]

  // 1. Insert rows for each table in order
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
      options.batchSize,
    )

    progress.startTable(tableName, totalRows)
    const tableStart = Date.now()
    let insertedSoFar = 0

    try {
      await client.query('BEGIN')
      for (const batch of batches) {
        await client.query(batch.sql)
        insertedSoFar += batch.rows.length
        progress.updateTable(tableName, insertedSoFar, totalRows)
      }
      await client.query('COMMIT')
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Swallow rollback errors
      }
      const detail = err instanceof Error ? err.message : String(err)
      const failingSql = batches.length > 0 ? batches[0].sql : ''
      throw new InsertionError(
        'SF4001',
        `INSERT failed for table ${tableName}: ${detail}`,
        [
          'Check for unique constraint violations (try reducing row count)',
          'Check for NOT NULL constraint violations',
          'Run with --dry-run to preview generated SQL',
        ],
        { tableName, sql: failingSql.slice(0, 500) },
      )
    }

    const tableElapsed = Date.now() - tableStart
    progress.finishTable(tableName, totalRows, tableElapsed)
    rowsPerTable.set(tableName, totalRows)
    totalRowsInserted += totalRows
  }

  // 2. Apply deferred updates
  if (generationResult.deferredUpdates.length > 0) {
    // Group by table
    const updatesByTable = new Map<string, typeof generationResult.deferredUpdates>()
    for (const update of generationResult.deferredUpdates) {
      const existing = updatesByTable.get(update.tableName) ?? []
      existing.push(update)
      updatesByTable.set(update.tableName, existing)
    }

    for (const [tableName, updates] of updatesByTable) {
      const tableDef = schema.tables.get(tableName)
      if (!tableDef) continue

      try {
        await client.query('BEGIN')
        for (const update of updates) {
          // Build UPDATE for each setColumn/setValue pair
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
    // Collect unique schema-qualified table names for sequence lookup
    const schemaMap = new Map<string, string[]>()
    for (const tableName of orderedTables) {
      const tableDef = schema.tables.get(tableName)
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
  // Use the keys from the generated row, maintaining the order they appear
  // This respects the columns that the generation engine chose to include
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    // Exclude columns that are generated (GENERATED ALWAYS AS)
    return colDef && !colDef.isGenerated
  })
}
