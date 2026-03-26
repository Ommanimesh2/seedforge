/**
 * Minimal singularizer for common SQL table naming conventions.
 * Handles the 90% case — not a full NLP singularizer.
 */
export function singularize(tableName: string): string {
  const lower = tableName.toLowerCase()

  // Words ending in 'ies' -> 'y' (categories -> category, companies -> company)
  if (lower.endsWith('ies')) {
    return lower.slice(0, -3) + 'y'
  }

  // Words ending in 'sses' -> 'ss' (addresses is handled below, but classes -> class)
  if (lower.endsWith('sses')) {
    return lower.slice(0, -2)
  }

  // Words ending in 'ses' -> 'se' (statuses -> status needs special handling)
  // But 'ses' after a consonant: statuses -> status (remove 'es')
  if (lower.endsWith('ses')) {
    // Check if removing 'es' makes more sense (statuses -> status)
    const withoutEs = lower.slice(0, -2)
    // If the word without 'es' ends in a consonant cluster that's common, keep it
    if (withoutEs.endsWith('us') || withoutEs.endsWith('is')) {
      return withoutEs
    }
    // Otherwise remove just 's' (databases -> database)
    return lower.slice(0, -1)
  }

  // Words ending in 'shes', 'ches', 'xes', 'zes' -> remove 'es'
  if (
    lower.endsWith('shes') ||
    lower.endsWith('ches') ||
    lower.endsWith('xes') ||
    lower.endsWith('zes')
  ) {
    return lower.slice(0, -2)
  }

  // Words ending in 'ves' -> 'fe' or 'f' (not common in SQL, but handle)
  // Skip — too edge-case for SQL tables

  // Words ending in 'sses' already handled above

  // Words ending in 'es' after consonant (addresses -> address)
  if (lower.endsWith('sses')) {
    return lower.slice(0, -2)
  }

  // Generic: words ending in 's' (users -> user, orders -> order)
  if (lower.endsWith('s') && !lower.endsWith('ss') && !lower.endsWith('us') && !lower.endsWith('is')) {
    return lower.slice(0, -1)
  }

  return lower
}

/**
 * Normalizes a column name for pattern matching.
 *
 * Transformations applied in order:
 * 1. Lowercase the column name
 * 2. Strip table name prefix (plural and singular forms)
 * 3. Remove common noise suffixes (_col, _field, _val, _value)
 * 4. Replace all separators (hyphens, double underscores) with single underscores
 * 5. Strip leading/trailing underscores
 */
export function normalizeColumnName(columnName: string, tableName: string): string {
  // 1. Lowercase
  let normalized = columnName.toLowerCase()

  // 4. Replace separators early so prefix stripping works uniformly
  normalized = normalized.replace(/-/g, '_').replace(/_{2,}/g, '_')

  // 5. Strip leading/trailing underscores (first pass)
  normalized = normalized.replace(/^_+|_+$/g, '')

  // 2. Strip table name prefix (only if table name is >2 chars)
  if (tableName.length > 2) {
    const tableNameLower = tableName.toLowerCase()
    const singular = singularize(tableNameLower)

    // Try stripping singular form prefix first (more specific), then plural
    const prefixes = [singular + '_', tableNameLower + '_']
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
        normalized = normalized.slice(prefix.length)
        break
      }
    }
  }

  // 3. Remove common noise suffixes
  const noiseSuffixes = ['_col', '_field', '_val', '_value']
  for (const suffix of noiseSuffixes) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      normalized = normalized.slice(0, -suffix.length)
      break
    }
  }

  // 4 & 5 again (in case prefix/suffix stripping introduced issues)
  normalized = normalized.replace(/-/g, '_').replace(/_{2,}/g, '_')
  normalized = normalized.replace(/^_+|_+$/g, '')

  return normalized
}
