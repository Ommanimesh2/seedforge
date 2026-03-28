/**
 * Parse a PostgreSQL text array result from array_agg().
 * The pg driver may return either a JS array (if type is known)
 * or a string like "{a,b,c}" (for text[] results from array_agg).
 */
export function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    return val.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  }
  return []
}
