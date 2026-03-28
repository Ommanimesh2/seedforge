import type { Connection, RowDataPacket } from 'mysql2/promise'
import type {
  TableDef,
  ColumnDef,
  PrimaryKeyDef,
  ForeignKeyDef,
  UniqueConstraintDef,
  CheckConstraintDef,
  IndexDef,
  EnumDef,
} from '../../types/index.js'
import { NormalizedType, FKAction } from '../../types/index.js'
import { noTablesFound } from '../../errors/index.js'
import { mapMysqlType, extractMysqlEnumValues } from './type-map.js'

// ─── Row interfaces ─────────────────────────────────────────────────────────

interface TableRow extends RowDataPacket {
  TABLE_NAME: string
  TABLE_COMMENT: string | null
}

interface ColumnRow extends RowDataPacket {
  TABLE_NAME: string
  COLUMN_NAME: string
  DATA_TYPE: string
  COLUMN_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
  CHARACTER_MAXIMUM_LENGTH: number | null
  NUMERIC_PRECISION: number | null
  NUMERIC_SCALE: number | null
  EXTRA: string
  COLUMN_COMMENT: string | null
}

interface PKRow extends RowDataPacket {
  TABLE_NAME: string
  CONSTRAINT_NAME: string
  COLUMN_NAME: string
  ORDINAL_POSITION: number
}

interface FKRow extends RowDataPacket {
  TABLE_NAME: string
  CONSTRAINT_NAME: string
  COLUMN_NAME: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_TABLE_SCHEMA: string
  REFERENCED_COLUMN_NAME: string
  ORDINAL_POSITION: number
  DELETE_RULE: string
  UPDATE_RULE: string
}

interface UniqueRow extends RowDataPacket {
  TABLE_NAME: string
  CONSTRAINT_NAME: string
  COLUMN_NAME: string
  ORDINAL_POSITION: number
}

interface CheckRow extends RowDataPacket {
  TABLE_NAME: string
  CONSTRAINT_NAME: string
  CHECK_CLAUSE: string
}

interface IndexRow extends RowDataPacket {
  TABLE_NAME: string
  INDEX_NAME: string
  COLUMN_NAME: string
  SEQ_IN_INDEX: number
  NON_UNIQUE: number
}

// ─── Query functions ────────────────────────────────────────────────────────

/**
 * Query all tables and their columns from information_schema.
 */
export async function queryMysqlTables(
  connection: Connection,
  database: string,
): Promise<Map<string, TableDef>> {
  // Step 1: Fetch tables
  const [tableRows] = await connection.query<TableRow[]>(
    `SELECT TABLE_NAME, TABLE_COMMENT
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database],
  )

  if (tableRows.length === 0) {
    throw noTablesFound(database)
  }

  // Step 2: Fetch columns
  const [columnRows] = await connection.query<ColumnRow[]>(
    `SELECT
       TABLE_NAME,
       COLUMN_NAME,
       DATA_TYPE,
       COLUMN_TYPE,
       IS_NULLABLE,
       COLUMN_DEFAULT,
       CHARACTER_MAXIMUM_LENGTH,
       NUMERIC_PRECISION,
       NUMERIC_SCALE,
       EXTRA,
       COLUMN_COMMENT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  )

  // Group columns by table
  const columnsByTable = new Map<string, ColumnDef[]>()
  for (const row of columnRows) {
    const dataType = mapMysqlType(row.DATA_TYPE, row.COLUMN_TYPE)
    const isAutoIncrement = row.EXTRA.toLowerCase().includes('auto_increment')
    const isGenerated =
      row.EXTRA.toLowerCase().includes('virtual generated') ||
      row.EXTRA.toLowerCase().includes('stored generated')

    // Extract enum values for ENUM/SET types
    let enumValues: string[] | null = null
    if (dataType === NormalizedType.ENUM) {
      enumValues = extractMysqlEnumValues(row.COLUMN_TYPE)
    }

    const col: ColumnDef = {
      name: row.COLUMN_NAME,
      dataType,
      nativeType: row.COLUMN_TYPE,
      isNullable: row.IS_NULLABLE === 'YES',
      hasDefault: row.COLUMN_DEFAULT !== null || isAutoIncrement || isGenerated,
      defaultValue: row.COLUMN_DEFAULT,
      isAutoIncrement,
      isGenerated,
      maxLength: row.CHARACTER_MAXIMUM_LENGTH,
      numericPrecision: row.NUMERIC_PRECISION,
      numericScale: row.NUMERIC_SCALE,
      enumValues,
      comment: row.COLUMN_COMMENT || null,
    }

    if (!columnsByTable.has(row.TABLE_NAME)) {
      columnsByTable.set(row.TABLE_NAME, [])
    }
    columnsByTable.get(row.TABLE_NAME)!.push(col)
  }

  // Build table map
  const tables = new Map<string, TableDef>()
  for (const row of tableRows) {
    const columns = new Map<string, ColumnDef>()
    const tableCols = columnsByTable.get(row.TABLE_NAME) ?? []
    for (const col of tableCols) {
      columns.set(col.name, col)
    }

    tables.set(row.TABLE_NAME, {
      name: row.TABLE_NAME,
      schema: database,
      columns,
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: row.TABLE_COMMENT || null,
    })
  }

  return tables
}

/**
 * Query primary keys for all tables in the database.
 */
export async function queryMysqlPrimaryKeys(
  connection: Connection,
  database: string,
): Promise<Map<string, PrimaryKeyDef>> {
  const [rows] = await connection.query<PKRow[]>(
    `SELECT
       kcu.TABLE_NAME,
       kcu.CONSTRAINT_NAME,
       kcu.COLUMN_NAME,
       kcu.ORDINAL_POSITION
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       AND kcu.TABLE_NAME = tc.TABLE_NAME
     WHERE kcu.TABLE_SCHEMA = ?
       AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
     ORDER BY kcu.TABLE_NAME, kcu.ORDINAL_POSITION`,
    [database],
  )

  const pkMap = new Map<string, { name: string; columns: string[] }>()
  for (const row of rows) {
    if (!pkMap.has(row.TABLE_NAME)) {
      pkMap.set(row.TABLE_NAME, { name: row.CONSTRAINT_NAME, columns: [] })
    }
    pkMap.get(row.TABLE_NAME)!.columns.push(row.COLUMN_NAME)
  }

  const result = new Map<string, PrimaryKeyDef>()
  for (const [tableName, pk] of pkMap) {
    result.set(tableName, {
      columns: pk.columns,
      name: pk.name,
    })
  }
  return result
}

/**
 * Query foreign keys for all tables in the database.
 */
export async function queryMysqlForeignKeys(
  connection: Connection,
  database: string,
): Promise<Map<string, ForeignKeyDef[]>> {
  const [rows] = await connection.query<FKRow[]>(
    `SELECT
       kcu.TABLE_NAME,
       kcu.CONSTRAINT_NAME,
       kcu.COLUMN_NAME,
       kcu.REFERENCED_TABLE_NAME,
       kcu.REFERENCED_TABLE_SCHEMA,
       kcu.REFERENCED_COLUMN_NAME,
       kcu.ORDINAL_POSITION,
       rc.DELETE_RULE,
       rc.UPDATE_RULE
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
     WHERE kcu.TABLE_SCHEMA = ?
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [database],
  )

  // Group by (table, constraint)
  const fkGroupMap = new Map<
    string,
    {
      tableName: string
      constraintName: string
      columns: string[]
      referencedTable: string
      referencedSchema: string
      referencedColumns: string[]
      deleteRule: string
      updateRule: string
    }
  >()

  for (const row of rows) {
    const key = `${row.TABLE_NAME}::${row.CONSTRAINT_NAME}`
    if (!fkGroupMap.has(key)) {
      fkGroupMap.set(key, {
        tableName: row.TABLE_NAME,
        constraintName: row.CONSTRAINT_NAME,
        columns: [],
        referencedTable: row.REFERENCED_TABLE_NAME,
        referencedSchema: row.REFERENCED_TABLE_SCHEMA,
        referencedColumns: [],
        deleteRule: row.DELETE_RULE,
        updateRule: row.UPDATE_RULE,
      })
    }
    const group = fkGroupMap.get(key)!
    group.columns.push(row.COLUMN_NAME)
    group.referencedColumns.push(row.REFERENCED_COLUMN_NAME)
  }

  const result = new Map<string, ForeignKeyDef[]>()
  for (const group of fkGroupMap.values()) {
    const fk: ForeignKeyDef = {
      name: group.constraintName,
      columns: group.columns,
      referencedTable: group.referencedTable,
      referencedSchema: group.referencedSchema,
      referencedColumns: group.referencedColumns,
      onDelete: mapMysqlFKAction(group.deleteRule),
      onUpdate: mapMysqlFKAction(group.updateRule),
      isDeferrable: false, // MySQL does not support deferred constraints
      isDeferred: false,
      isVirtual: false,
    }

    if (!result.has(group.tableName)) {
      result.set(group.tableName, [])
    }
    result.get(group.tableName)!.push(fk)
  }

  return result
}

/**
 * Query UNIQUE constraints for all tables.
 */
export async function queryMysqlUniqueConstraints(
  connection: Connection,
  database: string,
): Promise<Map<string, UniqueConstraintDef[]>> {
  const [rows] = await connection.query<UniqueRow[]>(
    `SELECT
       kcu.TABLE_NAME,
       kcu.CONSTRAINT_NAME,
       kcu.COLUMN_NAME,
       kcu.ORDINAL_POSITION
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       AND kcu.TABLE_NAME = tc.TABLE_NAME
     WHERE kcu.TABLE_SCHEMA = ?
       AND tc.CONSTRAINT_TYPE = 'UNIQUE'
     ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [database],
  )

  const groupMap = new Map<string, { tableName: string; name: string; columns: string[] }>()
  for (const row of rows) {
    const key = `${row.TABLE_NAME}::${row.CONSTRAINT_NAME}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        tableName: row.TABLE_NAME,
        name: row.CONSTRAINT_NAME,
        columns: [],
      })
    }
    groupMap.get(key)!.columns.push(row.COLUMN_NAME)
  }

  const result = new Map<string, UniqueConstraintDef[]>()
  for (const group of groupMap.values()) {
    if (!result.has(group.tableName)) {
      result.set(group.tableName, [])
    }
    result.get(group.tableName)!.push({
      columns: group.columns,
      name: group.name,
    })
  }

  return result
}

/**
 * Query CHECK constraints (MySQL 8.0.16+).
 */
export async function queryMysqlCheckConstraints(
  connection: Connection,
  database: string,
): Promise<Map<string, CheckConstraintDef[]>> {
  const result = new Map<string, CheckConstraintDef[]>()

  try {
    const [rows] = await connection.query<CheckRow[]>(
      `SELECT
         tc.TABLE_NAME,
         cc.CONSTRAINT_NAME,
         cc.CHECK_CLAUSE
       FROM information_schema.CHECK_CONSTRAINTS cc
       JOIN information_schema.TABLE_CONSTRAINTS tc
         ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       WHERE cc.CONSTRAINT_SCHEMA = ?
         AND tc.CONSTRAINT_TYPE = 'CHECK'
       ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME`,
      [database],
    )

    for (const row of rows) {
      if (!result.has(row.TABLE_NAME)) {
        result.set(row.TABLE_NAME, [])
      }
      result.get(row.TABLE_NAME)!.push({
        expression: row.CHECK_CLAUSE,
        name: row.CONSTRAINT_NAME,
        inferredValues: extractCheckEnumValues(row.CHECK_CLAUSE),
      })
    }
  } catch {
    // MySQL < 8.0.16 does not have CHECK_CONSTRAINTS table
    // Silently return empty map
  }

  return result
}

/**
 * Query non-primary, non-unique indexes.
 */
export async function queryMysqlIndexes(
  connection: Connection,
  database: string,
): Promise<Map<string, IndexDef[]>> {
  const [rows] = await connection.query<IndexRow[]>(
    `SELECT
       TABLE_NAME,
       INDEX_NAME,
       COLUMN_NAME,
       SEQ_IN_INDEX,
       NON_UNIQUE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND INDEX_NAME != 'PRIMARY'
       AND INDEX_NAME NOT IN (
         SELECT CONSTRAINT_NAME
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ?
           AND CONSTRAINT_TYPE = 'UNIQUE'
       )
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database, database],
  )

  const groupMap = new Map<
    string,
    { tableName: string; name: string; columns: string[]; isUnique: boolean }
  >()

  for (const row of rows) {
    const key = `${row.TABLE_NAME}::${row.INDEX_NAME}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        tableName: row.TABLE_NAME,
        name: row.INDEX_NAME,
        columns: [],
        isUnique: row.NON_UNIQUE === 0,
      })
    }
    groupMap.get(key)!.columns.push(row.COLUMN_NAME)
  }

  const result = new Map<string, IndexDef[]>()
  for (const group of groupMap.values()) {
    if (!result.has(group.tableName)) {
      result.set(group.tableName, [])
    }
    result.get(group.tableName)!.push({
      columns: group.columns,
      name: group.name,
      isUnique: group.isUnique,
    })
  }

  return result
}

/**
 * Collect inline ENUM definitions as EnumDef entries.
 * MySQL does not have a separate enum registry like PG; enums are inline in column types.
 * We synthesize EnumDef entries keyed by "tableName.columnName".
 */
export function collectMysqlEnums(tables: Map<string, TableDef>): Map<string, EnumDef> {
  const enums = new Map<string, EnumDef>()
  for (const [tableName, table] of tables) {
    for (const [, col] of table.columns) {
      if (col.dataType === NormalizedType.ENUM && col.enumValues && col.enumValues.length > 0) {
        const enumName = `${tableName}.${col.name}`
        enums.set(enumName, {
          name: enumName,
          schema: table.schema,
          values: col.enumValues,
        })
      }
    }
  }
  return enums
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const FK_ACTION_MAP: Record<string, FKAction> = {
  CASCADE: FKAction.CASCADE,
  'SET NULL': FKAction.SET_NULL,
  'SET DEFAULT': FKAction.SET_DEFAULT,
  RESTRICT: FKAction.RESTRICT,
  'NO ACTION': FKAction.NO_ACTION,
}

function mapMysqlFKAction(rule: string): FKAction {
  return FK_ACTION_MAP[rule.toUpperCase()] ?? FKAction.NO_ACTION
}

/**
 * Extract enum-like values from a CHECK constraint expression.
 * Reuses the same patterns as PG check constraint parsing.
 */
function extractCheckEnumValues(expression: string): string[] | null {
  if (!expression) return null

  // Pattern: IN ('val1', 'val2', ...)
  const inMatch = expression.match(
    /\bIN\s*\(\s*((?:'[^']*'(?:\s*,\s*)?)+)\s*\)/i,
  )
  if (inMatch) {
    return extractQuotedValues(inMatch[1])
  }

  // Pattern: OR chain: col = 'val1' OR col = 'val2'
  const orParts = expression.split(/\bOR\b/i)
  if (orParts.length >= 2) {
    const values: string[] = []
    for (const part of orParts) {
      const match = part.match(/=\s*'([^']*)'/)
      if (match) {
        values.push(match[1])
      }
    }
    if (values.length === orParts.length && values.length >= 2) {
      return values
    }
  }

  return null
}

function extractQuotedValues(str: string): string[] | null {
  const matches = str.match(/'([^']*)'/g)
  if (!matches || matches.length === 0) return null
  return matches.map((m) => m.slice(1, -1))
}
