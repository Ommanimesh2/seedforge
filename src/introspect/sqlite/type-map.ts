import { NormalizedType } from '../../types/index.js'

/**
 * Map a SQLite column type string to a NormalizedType.
 *
 * SQLite uses type affinity, so column type declarations can be varied.
 * This mapper inspects the declared type string with substring matching
 * to infer the best NormalizedType.
 *
 * @param declaredType - The column type string from PRAGMA table_info (may be empty)
 * @returns The best-matching NormalizedType
 */
export function mapSqliteType(declaredType: string): NormalizedType {
  if (!declaredType) {
    // SQLite allows columns with no type at all — treat as TEXT
    return NormalizedType.TEXT
  }

  const upper = declaredType.toUpperCase().trim()

  // Order matters: more specific checks first

  // Boolean (check before INT since BOOLEAN contains no INT substring confusion)
  if (upper.includes('BOOL')) {
    return NormalizedType.BOOLEAN
  }

  // JSON
  if (upper.includes('JSON')) {
    return NormalizedType.JSON
  }

  // Date/Time (check before general TEXT/INT)
  if (upper.includes('DATETIME') || upper.includes('TIMESTAMP')) {
    return NormalizedType.TIMESTAMP
  }
  if (upper.includes('DATE')) {
    return NormalizedType.DATE
  }
  if (upper.includes('TIME')) {
    return NormalizedType.TIME
  }

  // VARCHAR / CHAR (check before TEXT)
  if (upper.includes('VARCHAR') || upper.includes('VARYING')) {
    return NormalizedType.VARCHAR
  }
  if (upper.includes('CHAR') && !upper.includes('VARCHAR')) {
    return NormalizedType.CHAR
  }

  // UUID
  if (upper.includes('UUID')) {
    return NormalizedType.UUID
  }

  // Text
  if (upper === 'TEXT' || upper.includes('CLOB') || upper.includes('TEXT')) {
    return NormalizedType.TEXT
  }

  // Integer types (check specific sizes first)
  if (upper.includes('BIGINT') || upper === 'INT8') {
    return NormalizedType.BIGINT
  }
  if (upper.includes('SMALLINT') || upper === 'INT2') {
    return NormalizedType.SMALLINT
  }
  if (upper.includes('INT')) {
    // Catches INTEGER, INT, MEDIUMINT, TINYINT, etc.
    return NormalizedType.INTEGER
  }

  // Real / Double / Float
  if (upper.includes('DOUBLE') || upper.includes('FLOAT')) {
    return NormalizedType.DOUBLE
  }
  if (upper === 'REAL') {
    return NormalizedType.REAL
  }

  // Decimal / Numeric
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) {
    return NormalizedType.DECIMAL
  }

  // BLOB / Binary
  if (upper.includes('BLOB') || upper === 'BYTEA') {
    return NormalizedType.BYTEA
  }

  // Fallback: SQLite's type affinity rules
  // If nothing matched, treat as TEXT (safest default for SQLite)
  return NormalizedType.TEXT
}

/**
 * Detect if a SQLite column is auto-increment.
 *
 * In SQLite, INTEGER PRIMARY KEY is an alias for ROWID and auto-increments.
 * The AUTOINCREMENT keyword adds stricter behavior.
 *
 * @param type - The declared column type
 * @param isPk - Whether this column is the sole primary key
 * @param createSql - The full CREATE TABLE SQL (for AUTOINCREMENT detection)
 * @param columnName - The column name
 * @returns true if the column is auto-increment
 */
export function isSqliteAutoIncrement(
  type: string,
  isPk: boolean,
  createSql: string | null,
  columnName: string,
): boolean {
  if (!isPk) return false

  const upperType = type.toUpperCase().trim()
  // INTEGER PRIMARY KEY is always auto-increment in SQLite (alias for ROWID)
  if (upperType === 'INTEGER') {
    return true
  }

  // Also check CREATE TABLE sql for explicit AUTOINCREMENT
  if (createSql) {
    const re = new RegExp(
      `\\b${escapeRegex(columnName)}\\b[^,]*\\bAUTOINCREMENT\\b`,
      'i',
    )
    if (re.test(createSql)) {
      return true
    }
  }

  return false
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
