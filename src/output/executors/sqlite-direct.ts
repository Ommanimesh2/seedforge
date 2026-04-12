import type { SqliteDatabase } from '../../introspect/sqlite/connection.js'
import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import { resolveTable } from '../../types/resolve.js'
import type { InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Strip schema prefix from a qualified table name for SQLite SQL.
 * SQLite uses "main" as its default schema, but INSERT INTO "main.User" is
 * interpreted as a table literally named "main.User" — not schema-qualified.
 */
function sqliteTableName(qualifiedName: string): string {
  const dotIndex = qualifiedName.indexOf('.')
  return dotIndex !== -1 ? qualifiedName.slice(dotIndex + 1) : qualifiedName
}

/**
 * Execute INSERT statements directly against a SQLite database via better-sqlite3.
 *
 * Each table's inserts are wrapped in a transaction.
 * On failure, the current table is rolled back.
 * Deferred UPDATEs are applied after all INSERTs.
 * No sequence reset needed (SQLite uses ROWID).
 */
export function executeSqliteDirect(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  orderedTables: string[],
  db: SqliteDatabase,
  batchSize: number,
  progress: ProgressReporter,
): InsertionSummary {
  const startTime = Date.now()
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  let deferredUpdatesApplied = 0
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

    progress.startTable(tableName, totalRows)
    const tableStart = Date.now()

    try {
      // Build prepared statement for this table
      const placeholders = columns.map(() => '?').join(', ')
      const escapedCols = columns.map((c) => `"${c}"`).join(', ')
      const sql = `INSERT INTO "${sqliteTableName(tableName)}" (${escapedCols}) VALUES (${placeholders})`
      const stmt = db.prepare(sql)

      // Wrap all inserts for this table in a single transaction
      const insertAll = db.transaction((rowsToInsert: Record<string, unknown>[]) => {
        let inserted = 0
        for (const row of rowsToInsert) {
          const values = columns.map((col) => prepareSqliteValue(row[col]))
          stmt.run(...values)
          inserted++
          if (inserted % batchSize === 0) {
            progress.updateTable(tableName, inserted, totalRows)
          }
        }
        return inserted
      })

      const insertedCount = insertAll(rows)
      progress.updateTable(tableName, insertedCount, totalRows)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new InsertionError(
        'SF4001',
        `INSERT failed for table ${tableName}: ${detail}`,
        [
          'Check for unique constraint violations (try reducing row count)',
          'Check for NOT NULL constraint violations',
          'Run with --dry-run to preview generated SQL',
        ],
        { tableName },
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
        const applyUpdates = db.transaction(() => {
          for (const update of updates) {
            for (let i = 0; i < update.setColumns.length; i++) {
              const setCol = update.setColumns[i]
              const setValue = prepareSqliteValue(update.setValues[i])

              const whereParts = update.pkColumns.map((col) => `"${col}" = ?`)
              const sql = `UPDATE "${sqliteTableName(tableName)}" SET "${setCol}" = ? WHERE ${whereParts.join(' AND ')}`

              const whereValues = update.pkValues.map(prepareSqliteValue)
              db.prepare(sql).run(setValue, ...whereValues)
            }
            deferredUpdatesApplied++
          }
        })

        applyUpdates()
      } catch (err) {
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

  // 3. No sequence reset needed for SQLite (uses ROWID)

  const elapsedMs = Date.now() - startTime

  return {
    tablesSeeded: rowsPerTable.size,
    totalRowsInserted,
    rowsPerTable,
    deferredUpdatesApplied,
    sequencesReset: 0,
    elapsedMs,
    warnings,
    mode: OutputMode.DIRECT,
  }
}

/**
 * Prepare a value for SQLite insertion.
 * better-sqlite3 accepts: number, string, Buffer, bigint, null.
 */
function prepareSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value)
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value)
  }
  return value
}

/**
 * Determine which columns to insert for a table.
 * Excludes auto-generated columns not present in the row data.
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
