import type { InsertBatch } from './types.js'
import { buildInsertSQL } from './sql-builder.js'

/**
 * Convert an array of row objects into batches of row arrays.
 *
 * Each row object is converted to an array of values ordered by the columns array.
 * The result is split into chunks of batchSize.
 *
 * @param rows - Array of row objects (column name -> value)
 * @param columns - Ordered column names
 * @param batchSize - Maximum rows per batch
 * @returns Array of batches, each being an array of row value arrays
 */
export function splitIntoBatches(
  rows: Record<string, unknown>[],
  columns: string[],
  batchSize: number,
): unknown[][][] {
  if (rows.length === 0) {
    return []
  }

  // Convert each row object to an array of values in column order
  const rowArrays = rows.map((row) => columns.map((col) => row[col] ?? null))

  // Split into chunks of batchSize
  const batches: unknown[][][] = []
  for (let i = 0; i < rowArrays.length; i += batchSize) {
    batches.push(rowArrays.slice(i, i + batchSize))
  }
  return batches
}

/**
 * Build batched INSERT statements from row objects.
 *
 * Combines splitIntoBatches with buildInsertSQL to produce ready-to-execute
 * InsertBatch objects.
 *
 * @param tableName - The table name
 * @param schemaName - The schema name
 * @param columns - Ordered column names
 * @param rows - Array of row objects
 * @param batchSize - Maximum rows per INSERT statement
 * @returns Array of InsertBatch objects
 */
export function buildBatchedInserts(
  tableName: string,
  schemaName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  batchSize: number,
): InsertBatch[] {
  const batches = splitIntoBatches(rows, columns, batchSize)
  return batches.map((batchRows) => ({
    tableName,
    schemaName,
    columns,
    rows: batchRows,
    sql: buildInsertSQL(tableName, schemaName, columns, batchRows),
  }))
}
