/**
 * Converts a simple glob pattern (supporting * and ?) into a RegExp.
 * - `*` matches zero or more characters (not including `.`)
 * - `?` matches exactly one character (not `.`)
 * All other regex-special characters are escaped.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = ''
  for (const ch of pattern) {
    if (ch === '*') {
      regexStr += '[^.]*'
    } else if (ch === '?') {
      regexStr += '[^.]'
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch
    } else {
      regexStr += ch
    }
  }
  return new RegExp(`^${regexStr}$`)
}

/**
 * Checks whether a table name matches any of the exclusion patterns.
 * Supports exact match and glob patterns (* and ? wildcards).
 * Matching is case-sensitive.
 */
export function isTableExcluded(
  tableName: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?')) {
      if (globToRegex(pattern).test(tableName)) {
        return true
      }
    } else {
      if (tableName === pattern) {
        return true
      }
    }
  }
  return false
}

/**
 * Returns the subset of tableNames that are NOT excluded by any pattern.
 */
export function filterExcludedTables(
  tableNames: string[],
  patterns: string[],
): string[] {
  return tableNames.filter((name) => !isTableExcluded(name, patterns))
}
