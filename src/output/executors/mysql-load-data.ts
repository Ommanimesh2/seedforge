import { Readable } from 'node:stream'
import type { Connection } from 'mysql2/promise'
import type { DatabaseSchema } from '../../types/schema.js'
import { resolveTable } from '../../types/resolve.js'
import type { InsertPlan } from '../../graph/types.js'
import type { GenerationConfig, Row } from '../../generate/types.js'
import {
  generateAndStream,
  type TableStreamConsumer,
  type TableStreamInfo,
} from '../../generate/generate-streaming.js'
import type { InsertionSummary } from '../types.js'
import { OutputMode } from '../types.js'
import type { ProgressReporter } from '../progress.js'
import { InsertionError } from '../../errors/index.js'

/**
 * Escape one string value for MySQL's LOAD DATA default escape rules
 * (`ESCAPED BY '\\'`, `FIELDS TERMINATED BY '\t'`, `LINES TERMINATED BY '\n'`).
 *
 * MySQL unescapes these sequences when reading: `\\n` → newline, `\\t` → tab,
 * `\\r` → CR, `\\0` → NUL, `\\\\` → backslash. So to emit a string containing
 * any of those characters literally, we must replace them with their escaped
 * form. Backslash must be replaced first.
 */
function escapeMysqlTsvString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
}

/**
 * Format a single JS value as a MySQL LOAD DATA field.
 *
 * - `null`/`undefined` → `\N` (MySQL NULL marker, not a regular escape)
 * - booleans → `1`/`0`
 * - Date → `YYYY-MM-DD HH:MM:SS` (MySQL DATETIME-compatible)
 * - Buffer/Uint8Array → byte-wise escaped latin1 (round-trips through BLOB)
 * - arrays/objects → JSON string, then escape
 * - everything else → String() + escape
 */
export function formatMysqlTsvField(value: unknown): string {
  if (value === null || value === undefined) return '\\N'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') {
    if (!isFinite(value)) return '\\N'
    return String(value)
  }
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ')
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    let out = ''
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i]
      if (b === 0x00) out += '\\0'
      else if (b === 0x09) out += '\\t'
      else if (b === 0x0a) out += '\\n'
      else if (b === 0x0d) out += '\\r'
      else if (b === 0x5c) out += '\\\\'
      else out += String.fromCharCode(b)
    }
    return out
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return escapeMysqlTsvString(JSON.stringify(value))
  }
  return escapeMysqlTsvString(String(value))
}

/**
 * Build one TSV line (fields joined by \t, terminated by \n) from a row.
 */
export function rowToMysqlTsvLine(row: Row, columns: string[]): string {
  const fields = columns.map((c) => formatMysqlTsvField(row[c]))
  return fields.join('\t') + '\n'
}

function getInsertableColumns(
  tableDef: { columns: Map<string, { name: string; isGenerated: boolean }> },
  sampleRow: Row,
): string[] {
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    return colDef && !colDef.isGenerated
  })
}

function escapeMysqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * Stream TSV lines from a Row iterable, peeking at the first row so the
 * caller can derive columns. Reports progress every 1000 rows.
 */
async function* rowsToMysqlTsvLines(
  rowIterable: AsyncIterable<Row>,
  columns: string[],
  onProgress: (insertedSoFar: number) => void,
  initialRow: Row | null = null,
): AsyncGenerator<string, void, undefined> {
  let count = 0
  if (initialRow !== null) {
    count++
    yield rowToMysqlTsvLine(initialRow, columns)
  }
  for await (const row of rowIterable) {
    count++
    yield rowToMysqlTsvLine(row, columns)
    if (count % 1000 === 0) onProgress(count)
  }
  onProgress(count)
}

/**
 * Create a streaming consumer that ships rows into MySQL via
 * `LOAD DATA LOCAL INFILE`. Wraps each table in a START TRANSACTION/COMMIT
 * and uses mysql2's `infileStreamFactory` to feed the row stream as the
 * "local file" content, so the server reads our generator output byte-for-byte.
 *
 * The connection MUST have been opened with `flags: ['+LOCAL_FILES']` or the
 * equivalent `localInfile: true` option — otherwise the server will reject
 * LOCAL INFILE.
 */
export function createMysqlLoadDataConsumer(
  connection: Connection,
  progress: ProgressReporter,
  rowsPerTable: Map<string, number>,
): TableStreamConsumer {
  return async function consume(info: TableStreamInfo, rowStream: AsyncIterable<Row>) {
    const { table, tableName, rowCount } = info

    const iterator = rowStream[Symbol.asyncIterator]()
    const firstResult = await iterator.next()
    if (firstResult.done) {
      progress.startTable(tableName, 0)
      progress.finishTable(tableName, 0, 0)
      rowsPerTable.set(tableName, 0)
      return { insertedCount: 0 }
    }

    const firstRow = firstResult.value
    const columns = getInsertableColumns(table, firstRow)
    const escapedTable = escapeMysqlIdentifier(table.name)
    const escapedColumns = columns.map(escapeMysqlIdentifier).join(', ')
    const loadSql =
      `LOAD DATA LOCAL INFILE 'seedforge-stream.tsv' ` +
      `INTO TABLE ${escapedTable} ` +
      `CHARACTER SET utf8mb4 ` +
      `FIELDS TERMINATED BY '\\t' ESCAPED BY '\\\\' ` +
      `LINES TERMINATED BY '\\n' ` +
      `(${escapedColumns})`

    progress.startTable(tableName, rowCount)
    const tableStart = Date.now()

    const rest: AsyncIterable<Row> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => iterator.next(),
          return: iterator.return ? (v: unknown) => iterator.return!(v) : undefined,
          throw: iterator.throw ? (e: unknown) => iterator.throw!(e) : undefined,
        } as AsyncIterator<Row>
      },
    }

    try {
      await connection.query('START TRANSACTION')
      const linesGen = rowsToMysqlTsvLines(
        rest,
        columns,
        (insertedSoFar) => progress.updateTable(tableName, insertedSoFar, rowCount),
        firstRow,
      )
      await connection.query({
        sql: loadSql,
        infileStreamFactory: () => Readable.from(linesGen, { objectMode: false }),
      })
      await connection.query('COMMIT')
    } catch (err) {
      try {
        await connection.query('ROLLBACK')
      } catch {
        // Swallow rollback errors
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw new InsertionError(
        'SF4001',
        `LOAD DATA failed for table ${tableName}: ${detail}`,
        [
          'Ensure the server allows LOCAL INFILE (local_infile=ON)',
          'Check for unique constraint violations (try reducing row count)',
          'Check for NOT NULL constraint violations',
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
 * Fused generate + LOAD DATA pipeline for --fast MySQL insertion.
 */
export async function executeFastMysqlPipeline(
  schema: DatabaseSchema,
  plan: InsertPlan,
  connection: Connection,
  config: Partial<GenerationConfig> | undefined,
  progress: ProgressReporter,
): Promise<InsertionSummary> {
  const startTime = Date.now()
  const rowsPerTable = new Map<string, number>()
  let totalRowsInserted = 0
  let deferredUpdatesApplied = 0
  let sequencesReset = 0

  const consumer = createMysqlLoadDataConsumer(connection, progress, rowsPerTable)

  // 1. Streaming generation + LOAD DATA per table.
  // Pass null for the client — MySQL existing-data queries aren't supported in
  // the streaming path (same as the non-streaming MySQL executor).
  const streamResult = await generateAndStream(schema, plan, null, config, consumer)
  const warnings: string[] = [...streamResult.warnings]

  for (const count of rowsPerTable.values()) {
    totalRowsInserted += count
  }

  // 2. Apply deferred updates
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
        await connection.query('START TRANSACTION')
        for (const update of updates) {
          for (let i = 0; i < update.setColumns.length; i++) {
            const sql = buildMysqlUpdateSQL(
              tableDef.name,
              update.pkColumns,
              update.pkValues,
              update.setColumns[i],
              update.setValues[i],
            )
            await connection.query(sql)
          }
          deferredUpdatesApplied++
        }
        await connection.query('COMMIT')
      } catch (err) {
        try {
          await connection.query('ROLLBACK')
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

  // 3. Reset AUTO_INCREMENT on seeded tables (best-effort)
  try {
    for (const tableName of plan.ordered) {
      const tableDef = resolveTable(schema, tableName)
      if (!tableDef) continue
      for (const [, col] of tableDef.columns) {
        if (col.isAutoIncrement) {
          try {
            const [maxRows] = await connection.query<
              ({ max_val: number | null } & import('mysql2/promise').RowDataPacket)[]
            >(
              `SELECT MAX(${escapeMysqlIdentifier(col.name)}) AS max_val FROM ${escapeMysqlIdentifier(tableDef.name)}`,
            )
            const maxVal = maxRows[0]?.max_val
            if (maxVal !== null && maxVal !== undefined) {
              await connection.query(
                `ALTER TABLE ${escapeMysqlIdentifier(tableDef.name)} AUTO_INCREMENT = ${Number(maxVal) + 1}`,
              )
              sequencesReset++
            }
          } catch {
            warnings.push(`Failed to reset AUTO_INCREMENT for ${tableDef.name}.${col.name}`)
          }
          break
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

function buildMysqlUpdateSQL(
  tableName: string,
  pkColumns: string[],
  pkValues: unknown[],
  setColumn: string,
  setValue: unknown,
): string {
  const escapedTable = escapeMysqlIdentifier(tableName)
  const setClause = `${escapeMysqlIdentifier(setColumn)} = ${escapeInlineValue(setValue)}`
  const whereParts = pkColumns.map((col, i) => {
    const val = pkValues[i]
    if (val === null || val === undefined) {
      return `${escapeMysqlIdentifier(col)} IS NULL`
    }
    return `${escapeMysqlIdentifier(col)} = ${escapeInlineValue(val)}`
  })
  return `UPDATE ${escapedTable} SET ${setClause} WHERE ${whereParts.join(' AND ')};`
}

function escapeInlineValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return !isFinite(value) ? 'NULL' : String(value)
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) {
    return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return `X'${buf.toString('hex')}'`
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return `'${escapeSqlString(JSON.stringify(value))}'`
  }
  return `'${escapeSqlString(String(value))}'`
}

function escapeSqlString(str: string): string {
  return (
    str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1a/g, '\\Z')
  )
}
