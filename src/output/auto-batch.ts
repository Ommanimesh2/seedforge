/**
 * Auto-tuning batch size for INSERT statements.
 *
 * Adjusts batch size based on table width (column count, average row size)
 * to keep individual INSERT statements under ~1MB for PostgreSQL.
 */

/** Target maximum INSERT statement size in bytes (~1MB) */
const TARGET_MAX_STATEMENT_BYTES = 1_000_000

/** Minimum batch size floor */
const MIN_BATCH_SIZE = 100

/** Maximum batch size ceiling */
const MAX_BATCH_SIZE = 5000

/** Default average bytes per column value when avgRowWidth is not provided */
const DEFAULT_AVG_BYTES_PER_COLUMN = 30

/**
 * Calculate an optimal batch size for INSERT statements based on table shape.
 *
 * Narrow tables (few columns) get larger batches (up to 5000).
 * Wide tables (many columns) get smaller batches (down to 100).
 * The goal is to keep individual INSERT statements under ~1MB.
 *
 * @param columnCount - Number of columns in the table
 * @param avgRowWidth - Average row width in bytes (optional, estimated if not provided)
 * @returns Optimal batch size clamped between 100 and 5000
 */
export function calculateOptimalBatchSize(
  columnCount: number,
  avgRowWidth?: number,
): number {
  if (columnCount < 1) {
    return MAX_BATCH_SIZE
  }

  // Estimate row width if not provided
  const estimatedRowWidth =
    avgRowWidth ?? columnCount * DEFAULT_AVG_BYTES_PER_COLUMN

  if (estimatedRowWidth <= 0) {
    return MAX_BATCH_SIZE
  }

  // Calculate how many rows fit in the target statement size
  // Account for overhead: column names, INSERT INTO preamble, parentheses, commas
  const overheadPerRow = columnCount * 3 + 10 // commas, parens, spacing
  const bytesPerRow = estimatedRowWidth + overheadPerRow

  const rawBatchSize = Math.floor(TARGET_MAX_STATEMENT_BYTES / bytesPerRow)

  // Clamp to valid range
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, rawBatchSize))
}
