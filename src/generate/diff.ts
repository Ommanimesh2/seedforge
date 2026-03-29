import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { DatabaseSchema, TableDef, ColumnDef } from '../types/schema.js'

/**
 * State file name stored in the project root.
 */
const STATE_FILE_NAME = '.seedforge.state.json'

/**
 * Schema state persisted between runs.
 */
export interface SchemaState {
  /** Timestamp of the last generation run */
  generatedAt: string
  /** Per-table hash of column definitions */
  tableHashes: Record<string, string>
}

/**
 * Result of comparing current schema to stored state.
 */
export interface SchemaDiff {
  /** Tables that changed since last run (need regeneration) */
  changedTables: string[]
  /** Tables that were added (new, need generation) */
  addedTables: string[]
  /** Tables that were removed (exist in state but not in current schema) */
  removedTables: string[]
  /** Tables that are identical (can be skipped) */
  unchangedTables: string[]
}

/**
 * Computes a deterministic hash of a table's column definitions.
 *
 * The hash captures column names, types, nullability, and constraints
 * so that any schema change triggers regeneration.
 */
export function hashTableSchema(table: TableDef): string {
  const hash = crypto.createHash('sha256')

  // Sort columns by name for deterministic ordering
  const sortedColumns = Array.from(table.columns.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )

  for (const [name, col] of sortedColumns) {
    hash.update(serializeColumnDef(name, col))
  }

  // Include primary key
  if (table.primaryKey) {
    hash.update(`PK:${table.primaryKey.columns.join(',')}`)
  }

  // Include foreign keys (sorted for determinism)
  const sortedFKs = [...table.foreignKeys].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  for (const fk of sortedFKs) {
    hash.update(
      `FK:${fk.name}:${fk.columns.join(',')}:${fk.referencedSchema}.${fk.referencedTable}:${fk.referencedColumns.join(',')}`,
    )
  }

  // Include unique constraints
  const sortedUC = [...table.uniqueConstraints].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  )
  for (const uc of sortedUC) {
    hash.update(`UC:${uc.columns.join(',')}`)
  }

  return hash.digest('hex')
}

/**
 * Serializes a column definition into a deterministic string for hashing.
 */
function serializeColumnDef(name: string, col: ColumnDef): string {
  return [
    `COL:${name}`,
    `type:${col.dataType}`,
    `native:${col.nativeType}`,
    `nullable:${col.isNullable}`,
    `default:${col.hasDefault}`,
    `defaultVal:${col.defaultValue ?? ''}`,
    `autoInc:${col.isAutoIncrement}`,
    `generated:${col.isGenerated}`,
    `maxLen:${col.maxLength ?? ''}`,
    `precision:${col.numericPrecision ?? ''}`,
    `scale:${col.numericScale ?? ''}`,
    `enum:${col.enumValues ? col.enumValues.join(',') : ''}`,
  ].join('|')
}

/**
 * Computes hashes for all tables in a schema.
 */
export function computeSchemaHashes(
  schema: DatabaseSchema,
): Record<string, string> {
  const hashes: Record<string, string> = {}

  for (const [qualifiedName, table] of schema.tables) {
    hashes[qualifiedName] = hashTableSchema(table)
  }

  return hashes
}

/**
 * Saves schema state to .seedforge.state.json.
 *
 * @param cwd - Directory to write the state file in
 * @param schema - The current database schema
 */
export function saveSchemaState(
  cwd: string,
  schema: DatabaseSchema,
): void {
  const state: SchemaState = {
    generatedAt: new Date().toISOString(),
    tableHashes: computeSchemaHashes(schema),
  }

  const filePath = path.join(cwd, STATE_FILE_NAME)
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Loads schema state from .seedforge.state.json.
 * Returns null if the file does not exist.
 *
 * @param cwd - Directory to read the state file from
 */
export function loadSchemaState(cwd: string): SchemaState | null {
  const filePath = path.join(cwd, STATE_FILE_NAME)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as SchemaState
  } catch {
    // Corrupted file — treat as no state
    return null
  }
}

/**
 * Compares the current schema against the stored state to determine
 * which tables have changed and need regeneration.
 *
 * @param schema - Current database schema
 * @param state - Previously stored schema state (from .seedforge.state.json)
 * @returns A SchemaDiff describing what changed
 */
export function diffSchema(
  schema: DatabaseSchema,
  state: SchemaState,
): SchemaDiff {
  const currentHashes = computeSchemaHashes(schema)
  const previousHashes = state.tableHashes

  const changedTables: string[] = []
  const addedTables: string[] = []
  const unchangedTables: string[] = []

  // Check current tables against previous state
  for (const [tableName, currentHash] of Object.entries(currentHashes)) {
    const previousHash = previousHashes[tableName]
    if (previousHash === undefined) {
      addedTables.push(tableName)
    } else if (previousHash !== currentHash) {
      changedTables.push(tableName)
    } else {
      unchangedTables.push(tableName)
    }
  }

  // Check for removed tables (in previous state but not in current schema)
  const removedTables: string[] = []
  for (const tableName of Object.keys(previousHashes)) {
    if (!(tableName in currentHashes)) {
      removedTables.push(tableName)
    }
  }

  return {
    changedTables,
    addedTables,
    removedTables,
    unchangedTables,
  }
}

/**
 * Determines which tables need regeneration.
 *
 * Returns the list of tables that should be regenerated (changed + added),
 * or null if there is no previous state (meaning all tables should be generated).
 *
 * @param schema - Current database schema
 * @param cwd - Working directory containing .seedforge.state.json
 * @returns Array of table names to regenerate, or null if all should be generated
 */
export function getTablesNeedingRegeneration(
  schema: DatabaseSchema,
  cwd: string,
): string[] | null {
  const state = loadSchemaState(cwd)

  if (!state) {
    // No previous state — regenerate everything
    return null
  }

  const diff = diffSchema(schema, state)
  return [...diff.changedTables, ...diff.addedTables]
}
