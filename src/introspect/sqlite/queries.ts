import type { SqliteDatabase } from './connection.js'
import type {
  TableDef,
  ColumnDef,
  PrimaryKeyDef,
  ForeignKeyDef,
  UniqueConstraintDef,
  IndexDef,
  CheckConstraintDef,
} from '../../types/index.js'
import { FKAction } from '../../types/index.js'
import { noTablesFound } from '../../errors/index.js'
import { mapSqliteType, isSqliteAutoIncrement } from './type-map.js'
import { extractEnumLikeValues } from '../queries/check-constraints.js'

// ─── PRAGMA row types ───

interface TableInfoRow {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface ForeignKeyRow {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

interface IndexListRow {
  seq: number
  name: string
  unique: number
  origin: string
  partial: number
}

interface IndexInfoRow {
  seqno: number
  cid: number
  name: string
}

interface SqliteMasterRow {
  name: string
  sql: string | null
}

// ─── FK action mapping ───

const FK_ACTION_MAP: Record<string, FKAction> = {
  'NO ACTION': FKAction.NO_ACTION,
  RESTRICT: FKAction.RESTRICT,
  CASCADE: FKAction.CASCADE,
  'SET NULL': FKAction.SET_NULL,
  'SET DEFAULT': FKAction.SET_DEFAULT,
}

// ─── Query functions ───

/**
 * Query all user tables from the SQLite database.
 * Excludes internal SQLite tables (sqlite_*).
 */
export function queryTables(db: SqliteDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as SqliteMasterRow[]

  return rows.map((r) => r.name)
}

/**
 * Get the CREATE TABLE SQL for a given table.
 */
export function getCreateTableSql(
  db: SqliteDatabase,
  tableName: string,
): string | null {
  const row = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) as SqliteMasterRow | undefined

  return row?.sql ?? null
}

/**
 * Query columns for a specific table using PRAGMA table_info.
 */
export function queryColumns(
  db: SqliteDatabase,
  tableName: string,
  createSql: string | null,
): { columns: Map<string, ColumnDef>; pkColumns: string[] } {
  const rows = db.pragma(`table_info("${tableName}")`) as TableInfoRow[]

  const columns = new Map<string, ColumnDef>()
  const pkColumns: string[] = []

  // Collect pk columns first (for composite PK detection)
  for (const row of rows) {
    if (row.pk > 0) {
      pkColumns.push(row.name)
    }
  }

  const isSingleColumnPk = pkColumns.length === 1

  for (const row of rows) {
    const isPkColumn = row.pk > 0
    const isSolePk = isPkColumn && isSingleColumnPk
    const dataType = mapSqliteType(row.type)
    const isAutoIncrement = isSqliteAutoIncrement(
      row.type,
      isSolePk,
      createSql,
      row.name,
    )

    // Extract maxLength from VARCHAR(N) etc.
    const maxLength = extractMaxLength(row.type)

    // Extract precision/scale from DECIMAL(P,S) etc.
    const { precision, scale } = extractPrecisionScale(row.type)

    const col: ColumnDef = {
      name: row.name,
      dataType,
      nativeType: row.type || 'TEXT',
      isNullable: row.notnull === 0 && !isPkColumn,
      hasDefault: row.dflt_value !== null || isAutoIncrement,
      defaultValue: row.dflt_value,
      isAutoIncrement,
      isGenerated: false, // SQLite doesn't have GENERATED ALWAYS AS in older versions
      maxLength,
      numericPrecision: precision,
      numericScale: scale,
      enumValues: null,
      comment: null, // SQLite doesn't have column comments
    }

    columns.set(row.name, col)
  }

  return { columns, pkColumns }
}

/**
 * Query primary key definition for a table.
 */
export function queryPrimaryKey(
  pkColumns: string[],
): PrimaryKeyDef | null {
  if (pkColumns.length === 0) return null
  return {
    columns: pkColumns,
    name: null, // SQLite doesn't name PKs
  }
}

/**
 * Query foreign keys for a table using PRAGMA foreign_key_list.
 */
export function queryForeignKeys(
  db: SqliteDatabase,
  tableName: string,
): ForeignKeyDef[] {
  const rows = db.pragma(`foreign_key_list("${tableName}")`) as ForeignKeyRow[]

  if (rows.length === 0) return []

  // Group by FK id (composite FKs share the same id)
  const fkMap = new Map<
    number,
    { table: string; columns: string[]; refColumns: string[]; onDelete: string; onUpdate: string }
  >()

  for (const row of rows) {
    if (!fkMap.has(row.id)) {
      fkMap.set(row.id, {
        table: row.table,
        columns: [],
        refColumns: [],
        onDelete: row.on_delete,
        onUpdate: row.on_update,
      })
    }
    const fk = fkMap.get(row.id)!
    fk.columns.push(row.from)
    fk.refColumns.push(row.to)
  }

  const result: ForeignKeyDef[] = []
  for (const [id, fk] of fkMap) {
    result.push({
      name: `fk_${tableName}_${id}`,
      columns: fk.columns,
      referencedTable: fk.table,
      referencedSchema: 'main',
      referencedColumns: fk.refColumns,
      onDelete: FK_ACTION_MAP[fk.onDelete] ?? FKAction.NO_ACTION,
      onUpdate: FK_ACTION_MAP[fk.onUpdate] ?? FKAction.NO_ACTION,
      isDeferrable: false,
      isDeferred: false,
      isVirtual: false,
    })
  }

  return result
}

/**
 * Query unique constraints and indexes for a table.
 */
export function queryUniqueAndIndexes(
  db: SqliteDatabase,
  tableName: string,
): { uniqueConstraints: UniqueConstraintDef[]; indexes: IndexDef[] } {
  const indexRows = db.pragma(`index_list("${tableName}")`) as IndexListRow[]

  const uniqueConstraints: UniqueConstraintDef[] = []
  const indexes: IndexDef[] = []

  for (const idx of indexRows) {
    // Skip autoindex entries that are PKs
    if (idx.name.startsWith('sqlite_autoindex_')) continue

    const infoCols = db.pragma(`index_info("${idx.name}")`) as IndexInfoRow[]
    const columnNames = infoCols.map((c) => c.name)

    if (columnNames.length === 0) continue

    if (idx.unique && idx.origin === 'u') {
      // Origin 'u' = unique constraint
      uniqueConstraints.push({
        columns: columnNames,
        name: idx.name,
      })
    } else {
      indexes.push({
        columns: columnNames,
        name: idx.name,
        isUnique: idx.unique === 1,
      })
    }
  }

  return { uniqueConstraints, indexes }
}

/**
 * Parse CHECK constraints from the CREATE TABLE SQL.
 *
 * SQLite stores CHECK constraints inline in the CREATE TABLE statement.
 * We extract them by parsing the SQL.
 */
export function parseCheckConstraints(
  createSql: string | null,
): CheckConstraintDef[] {
  if (!createSql) return []

  const checks: CheckConstraintDef[] = []

  // Match CHECK(...) expressions, handling nested parentheses
  const checkPattern = /\bCHECK\s*\(/gi
  let match: RegExpExecArray | null

  while ((match = checkPattern.exec(createSql)) !== null) {
    const startIdx = match.index + match[0].length - 1 // position of opening (
    const expression = extractBalancedParens(createSql, startIdx)
    if (expression) {
      // Remove outer parentheses
      const inner = expression.slice(1, -1).trim()
      checks.push({
        expression: inner,
        name: null, // SQLite doesn't typically name inline CHECK constraints
        inferredValues: extractEnumLikeValues(inner),
      })
    }
  }

  return checks
}

/**
 * Build a complete TableDef for a SQLite table.
 */
export function buildTableDef(
  db: SqliteDatabase,
  tableName: string,
): TableDef {
  const createSql = getCreateTableSql(db, tableName)
  const { columns, pkColumns } = queryColumns(db, tableName, createSql)
  const primaryKey = queryPrimaryKey(pkColumns)
  const foreignKeys = queryForeignKeys(db, tableName)
  const { uniqueConstraints, indexes } = queryUniqueAndIndexes(db, tableName)
  const checkConstraints = parseCheckConstraints(createSql)

  // Propagate CHECK-inferred enum values to columns
  for (const check of checkConstraints) {
    if (!check.inferredValues || check.inferredValues.length === 0) continue
    for (const [colName, col] of columns) {
      if (col.enumValues) continue
      if (check.expression.includes(colName)) {
        col.enumValues = check.inferredValues
        break
      }
    }
  }

  return {
    name: tableName,
    schema: 'main',
    columns,
    primaryKey,
    foreignKeys,
    uniqueConstraints,
    checkConstraints,
    indexes,
    comment: null,
  }
}

/**
 * Introspect all tables in the SQLite database and return a Map.
 */
export function queryAllTables(
  db: SqliteDatabase,
): Map<string, TableDef> {
  const tableNames = queryTables(db)

  if (tableNames.length === 0) {
    throw noTablesFound('main')
  }

  const tables = new Map<string, TableDef>()
  for (const name of tableNames) {
    tables.set(name, buildTableDef(db, name))
  }

  return tables
}

// ─── Helpers ───

/**
 * Extract a balanced parenthesized expression from a string.
 */
function extractBalancedParens(
  str: string,
  startIdx: number,
): string | null {
  if (str[startIdx] !== '(') return null

  let depth = 0
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === '(') depth++
    else if (str[i] === ')') depth--
    if (depth === 0) {
      return str.slice(startIdx, i + 1)
    }
  }
  return null
}

/**
 * Extract max length from a type declaration like VARCHAR(255).
 */
function extractMaxLength(type: string): number | null {
  const match = type.match(/\(\s*(\d+)\s*\)/i)
  if (match) {
    // Only return for string-like types
    const upper = type.toUpperCase()
    if (
      upper.includes('CHAR') ||
      upper.includes('VARCHAR') ||
      upper.includes('TEXT') ||
      upper.includes('VARYING')
    ) {
      return parseInt(match[1], 10)
    }
  }
  return null
}

/**
 * Extract precision and scale from a type like DECIMAL(10,2).
 */
function extractPrecisionScale(
  type: string,
): { precision: number | null; scale: number | null } {
  const match = type.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/i)
  if (match) {
    const upper = type.toUpperCase()
    if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) {
      return {
        precision: parseInt(match[1], 10),
        scale: parseInt(match[2], 10),
      }
    }
  }
  // Single-arg precision
  const singleMatch = type.match(/\(\s*(\d+)\s*\)/i)
  if (singleMatch) {
    const upper = type.toUpperCase()
    if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) {
      return {
        precision: parseInt(singleMatch[1], 10),
        scale: null,
      }
    }
  }
  return { precision: null, scale: null }
}
