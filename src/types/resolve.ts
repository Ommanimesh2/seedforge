import type { DatabaseSchema, TableDef } from './schema.js'

/**
 * Resolve a potentially schema-qualified table name (e.g., "public.users")
 * to a TableDef. The schema.tables map may be keyed by unqualified name ("users").
 */
export function resolveTable(
  schema: DatabaseSchema,
  qualifiedName: string,
): TableDef | undefined {
  // Try exact match first
  const direct = schema.tables.get(qualifiedName)
  if (direct) return direct
  // Try unqualified name (strip "schema." prefix)
  const dotIndex = qualifiedName.indexOf('.')
  if (dotIndex !== -1) {
    return schema.tables.get(qualifiedName.slice(dotIndex + 1))
  }
  return undefined
}
