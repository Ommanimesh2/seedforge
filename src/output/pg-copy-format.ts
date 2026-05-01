/**
 * Value formatting helpers for PostgreSQL COPY FROM STDIN (CSV format).
 *
 * Extracted from the original pg-copy executor so that both the in-memory
 * and the streaming COPY paths share one implementation. Any change to
 * escaping rules affects both and stays consistent.
 */

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
    // PostgreSQL array literal format with proper element escaping
    const formatted = value.map((v) => {
      if (v === null || v === undefined) return 'NULL'
      const s = String(v)
      if (
        s.includes(',') ||
        s.includes('"') ||
        s.includes('{') ||
        s.includes('}') ||
        s.includes('\\') ||
        /\s/.test(s)
      ) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      }
      return s
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
export function csvQuote(str: string): string {
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
export function rowToCsvLine(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((col) => formatCopyValue(row[col] ?? null)).join(',')
}
