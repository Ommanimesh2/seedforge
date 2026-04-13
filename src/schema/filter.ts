import type { DatabaseSchema, TableDef } from '../types/schema.js'
import { isTableExcluded } from '../config/exclude.js'

export interface FilterSchemaOptions {
  only?: string[]
  exclude?: string[]
  includeFKAncestors?: boolean
}

export interface FilterResult {
  schema: DatabaseSchema
  selected: string[]
  autoIncluded: string[]
  excluded: string[]
  missing: string[]
}

function unqualifiedName(name: string): string {
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(dot + 1)
}

function findTableKey(schema: DatabaseSchema, name: string): string | null {
  if (schema.tables.has(name)) return name
  const unqualified = unqualifiedName(name)
  if (schema.tables.has(unqualified)) return unqualified
  for (const [key, table] of schema.tables) {
    if (`${table.schema}.${table.name}` === name) return key
  }
  return null
}

function collectFKAncestors(schema: DatabaseSchema, startKeys: string[]): Set<string> {
  const visited = new Set<string>(startKeys)
  const stack = [...startKeys]

  while (stack.length > 0) {
    const key = stack.pop()!
    const table = schema.tables.get(key)
    if (!table) continue

    for (const fk of table.foreignKeys) {
      const refKey =
        findTableKey(schema, `${fk.referencedSchema}.${fk.referencedTable}`) ??
        findTableKey(schema, fk.referencedTable)
      if (refKey && !visited.has(refKey)) {
        visited.add(refKey)
        stack.push(refKey)
      }
    }
  }

  return visited
}

function cloneTable(table: TableDef, keepTables: Set<string>): TableDef {
  return {
    ...table,
    columns: new Map(table.columns),
    foreignKeys: table.foreignKeys.filter((fk) => {
      return (
        keepTables.has(fk.referencedTable) ||
        keepTables.has(`${fk.referencedSchema}.${fk.referencedTable}`)
      )
    }),
    uniqueConstraints: [...table.uniqueConstraints],
    checkConstraints: [...table.checkConstraints],
    indexes: [...table.indexes],
  }
}

/**
 * Produce a new DatabaseSchema containing only the tables selected by the
 * given options. Supports:
 *   - `only`: explicit list of tables to keep (qualified or unqualified names)
 *   - `exclude`: glob patterns to drop (matches existing --exclude behavior)
 *   - `includeFKAncestors`: when `only` is set, transitively include all
 *     tables referenced by FK (default: true)
 *
 * When a `--only` table references another table that is also in `--exclude`,
 * the exclude wins — seedforge will drop the FK and the consuming column will
 * be treated as orphaned (generated as null if nullable, otherwise an error
 * at generation time). This matches how the graph treats orphan references.
 */
export function filterSchema(schema: DatabaseSchema, options: FilterSchemaOptions): FilterResult {
  const { only, exclude = [], includeFKAncestors = true } = options
  const missing: string[] = []
  const excluded: string[] = []
  const selected: string[] = []
  const autoIncluded: string[] = []

  // Step 1: resolve explicit selection
  let keepKeys: Set<string>
  if (only && only.length > 0) {
    const seedKeys: string[] = []
    for (const name of only) {
      const key = findTableKey(schema, name)
      if (key) {
        seedKeys.push(key)
        selected.push(key)
      } else {
        missing.push(name)
      }
    }

    // Always compute the ancestor closure so callers can see what *would*
    // be auto-included even when includeFKAncestors=false.
    const closure = collectFKAncestors(schema, seedKeys)
    for (const key of closure) {
      if (!selected.includes(key)) autoIncluded.push(key)
    }

    keepKeys = includeFKAncestors ? closure : new Set(seedKeys)
  } else {
    keepKeys = new Set(schema.tables.keys())
  }

  // Step 2: apply exclude patterns
  if (exclude.length > 0) {
    for (const key of Array.from(keepKeys)) {
      const table = schema.tables.get(key)
      if (!table) continue
      const unqualified = table.name
      const qualified = `${table.schema}.${table.name}`
      if (isTableExcluded(unqualified, exclude) || isTableExcluded(qualified, exclude)) {
        keepKeys.delete(key)
        excluded.push(key)
      }
    }
  }

  // Step 3: build the filtered schema
  const filteredTables = new Map<string, TableDef>()
  for (const [key, table] of schema.tables) {
    if (keepKeys.has(key)) {
      filteredTables.set(key, cloneTable(table, keepKeys))
    }
  }

  const filteredSchema: DatabaseSchema = {
    name: schema.name,
    tables: filteredTables,
    enums: new Map(schema.enums),
    schemas: [...schema.schemas],
  }

  return {
    schema: filteredSchema,
    selected,
    autoIncluded,
    excluded,
    missing,
  }
}
