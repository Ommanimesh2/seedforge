import type { Connection } from 'mysql2/promise'
import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import { resolveTable } from '../../types/resolve.js'
import type { InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Execute INSERT statements directly against a MySQL database via mysql2.
 *
 * Each table's inserts are wrapped in a BEGIN/COMMIT transaction.
 * On failure, the current table is rolled back.
 * Deferred UPDATEs are applied after all INSERTs.
 * AUTO_INCREMENT is reset after all data is inserted.
 */
export async function executeMysqlDirect(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  orderedTables: string[],
  mysqlConnection: Connection,
  batchSize: number,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  const startTime = Date.now()
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

    const tableDef = resolveTable(schema, tableName)
    if (!tableDef) continue

    const rows = tableResult.rows
    const columns = getInsertableColumns(tableDef, rows[0])
    const totalRows = rows.length

    // Build batched inserts
    const batches = buildMysqlBatchedInserts(
      tableDef.name,
      columns,
      rows,
      batchSize,
    )

    progress.startTable(tableName, totalRows)
    const tableStart = Date.now()
    let insertedSoFar = 0

    try {
      await mysqlConnection.query('START TRANSACTION')
      for (const batch of batches) {
        await mysqlConnection.query(batch.sql)
        insertedSoFar += batch.rowCount
        progress.updateTable(tableName, insertedSoFar, totalRows)
      }
      await mysqlConnection.query('COMMIT')
    } catch (err) {
      try {
        await mysqlConnection.query('ROLLBACK')
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
        await mysqlConnection.query('START TRANSACTION')
        for (const update of updates) {
          for (let i = 0; i < update.setColumns.length; i++) {
            const sql = buildMysqlUpdateSQL(
              tableDef.name,
              update.pkColumns,
              update.pkValues,
              update.setColumns[i],
              update.setValues[i],
            )
            await mysqlConnection.query(sql)
          }
          deferredUpdatesApplied++
        }
        await mysqlConnection.query('COMMIT')
      } catch (err) {
        try {
          await mysqlConnection.query('ROLLBACK')
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

  // 3. Reset AUTO_INCREMENT for tables with auto-increment columns
  try {
    for (const tableName of orderedTables) {
      const tableDef = resolveTable(schema, tableName)
      if (!tableDef) continue

      for (const [, col] of tableDef.columns) {
        if (col.isAutoIncrement) {
          try {
            // Get the current max value and set AUTO_INCREMENT to max + 1
            const [maxRows] = await mysqlConnection.query<
              ({ max_val: number | null } & import('mysql2/promise').RowDataPacket)[]
            >(
              `SELECT MAX(${escapeIdentifier(col.name)}) AS max_val FROM ${escapeIdentifier(tableDef.name)}`,
            )
            const maxVal = maxRows[0]?.max_val
            if (maxVal !== null && maxVal !== undefined) {
              await mysqlConnection.query(
                `ALTER TABLE ${escapeIdentifier(tableDef.name)} AUTO_INCREMENT = ${Number(maxVal) + 1}`,
              )
              sequencesReset++
            }
          } catch {
            // Non-fatal: warn and continue
            warnings.push(`Failed to reset AUTO_INCREMENT for ${tableDef.name}.${col.name}`)
          }
          break // Only one AUTO_INCREMENT per table in MySQL
        }
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    warnings.push(`AUTO_INCREMENT reset failed: ${detail}`)
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

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MysqlInsertBatch {
  sql: string
  rowCount: number
}

function buildMysqlBatchedInserts(
  tableName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  batchSize: number,
): MysqlInsertBatch[] {
  const batches: MysqlInsertBatch[] = []
  for (let i = 0; i < rows.length; i += batchSize) {
    const batchRows = rows.slice(i, i + batchSize)
    const sql = buildMysqlInsertSQL(tableName, columns, batchRows)
    batches.push({ sql, rowCount: batchRows.length })
  }
  return batches
}

function buildMysqlInsertSQL(
  tableName: string,
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return ''

  const escapedColumns = columns.map(escapeIdentifier).join(', ')
  const escapedTable = escapeIdentifier(tableName)

  const valueTuples = rows.map((row) => {
    const values = columns.map((col) => escapeMysqlValue(row[col] ?? null))
    return `(${values.join(', ')})`
  })

  return `INSERT INTO ${escapedTable} (${escapedColumns}) VALUES\n${valueTuples.join(',\n')};`
}

function buildMysqlUpdateSQL(
  tableName: string,
  pkColumns: string[],
  pkValues: unknown[],
  setColumn: string,
  setValue: unknown,
): string {
  const escapedTable = escapeIdentifier(tableName)
  const setClause = `${escapeIdentifier(setColumn)} = ${escapeMysqlValue(setValue)}`

  const whereParts = pkColumns.map((col, i) => {
    const val = pkValues[i]
    if (val === null || val === undefined) {
      return `${escapeIdentifier(col)} IS NULL`
    }
    return `${escapeIdentifier(col)} = ${escapeMysqlValue(val)}`
  })

  return `UPDATE ${escapedTable} SET ${setClause} WHERE ${whereParts.join(' AND ')};`
}

/**
 * Escape a MySQL identifier (table name, column name) with backticks.
 */
function escapeIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * Escape a value for safe insertion into MySQL SQL.
 */
function escapeMysqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) return 'NULL'
    return String(value)
  }
  if (typeof value === 'bigint') {
    return String(value)
  }
  if (value instanceof Date) {
    return escapeString(value.toISOString().replace('T', ' ').replace('Z', ''))
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return `X'${buf.toString('hex')}'`
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return escapeString(JSON.stringify(value))
  }
  return escapeString(String(value))
}

function escapeString(str: string): string {
  // MySQL string escaping
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1a/g, '\\Z')
  return `'${escaped}'`
}

function getInsertableColumns(
  tableDef: { columns: Map<string, { name: string; isGenerated: boolean }> },
  sampleRow: Record<string, unknown>,
): string[] {
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    return colDef && !colDef.isGenerated
  })
}
