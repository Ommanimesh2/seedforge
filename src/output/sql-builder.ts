import pgFormat from 'pg-format'

/**
 * Prepare a value for safe insertion via pg-format.
 * Handles special types: Date, Buffer, objects (JSON), etc.
 */
function prepareValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return '\\x' + buf.toString('hex')
  }
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return value
}

/**
 * Build a multi-row INSERT statement using pg-format for safe escaping.
 *
 * @param tableName - The table name
 * @param schemaName - The schema name
 * @param columns - Ordered column names
 * @param rows - Array of row arrays (each row is an array of values parallel to columns)
 * @returns The complete INSERT SQL string
 */
export function buildInsertSQL(
  tableName: string,
  schemaName: string,
  columns: string[],
  rows: unknown[][],
): string {
  if (rows.length === 0) {
    return ''
  }

  // Escape column names individually
  const escapedColumns = columns.map((col) => pgFormat('%I', col)).join(', ')
  const qualifiedTable = pgFormat('%I.%I', schemaName, tableName)

  // Prepare all values
  const preparedRows = rows.map((row) => row.map(prepareValue))

  // Build VALUES list using pg-format %L for each row
  const valueTuples = preparedRows.map((row) => {
    const values = row.map((v) => {
      if (v === null) return 'NULL'
      return pgFormat('%L', v)
    })
    return `(${values.join(', ')})`
  })

  return `INSERT INTO ${qualifiedTable} (${escapedColumns}) VALUES\n${valueTuples.join(',\n')};`
}

/**
 * Build an UPDATE statement for a deferred update (self-ref, cycle resolution).
 *
 * @param tableName - The table name
 * @param schemaName - The schema name
 * @param pkColumns - Primary key column names
 * @param pkValues - Primary key values for the WHERE clause
 * @param setColumn - Column to update
 * @param setValue - Value to set
 * @returns The complete UPDATE SQL string
 */
export function buildUpdateSQL(
  tableName: string,
  schemaName: string,
  pkColumns: string[],
  pkValues: unknown[],
  setColumn: string,
  setValue: unknown,
): string {
  const qualifiedTable = pgFormat('%I.%I', schemaName, tableName)
  const preparedSetValue = prepareValue(setValue)

  let setClause: string
  if (preparedSetValue === null) {
    setClause = pgFormat('%I = NULL', setColumn)
  } else {
    setClause = pgFormat('%I = %L', setColumn, preparedSetValue)
  }

  const whereParts = pkColumns.map((col, i) => {
    const pkVal = prepareValue(pkValues[i])
    if (pkVal === null) {
      return pgFormat('%I IS NULL', col)
    }
    return pgFormat('%I = %L', col, pkVal)
  })

  return `UPDATE ${qualifiedTable} SET ${setClause} WHERE ${whereParts.join(' AND ')};`
}

/**
 * Build a SELECT setval() statement to reset a sequence after seeding.
 *
 * @param schemaName - The schema name
 * @param tableName - The table name
 * @param columnName - The serial/identity column name
 * @param sequenceName - The PostgreSQL sequence name
 * @returns The complete SELECT setval SQL string
 */
export function buildSequenceResetSQL(
  schemaName: string,
  tableName: string,
  columnName: string,
  sequenceName: string,
): string {
  return pgFormat(
    'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I.%I), 1));',
    sequenceName,
    columnName,
    schemaName,
    tableName,
  )
}

/**
 * Wrap an array of SQL statements in a BEGIN/COMMIT transaction block.
 *
 * @param statements - SQL statements to wrap
 * @returns The complete transaction block string
 */
export function buildTransactionWrapper(statements: string[]): string {
  return ['BEGIN;', ...statements, 'COMMIT;'].join('\n')
}
