/**
 * Internal types for the Drizzle schema parser.
 */

export type DrizzleDialect = 'pg' | 'mysql' | 'sqlite'

export interface ParsedColumn {
  /** The column name as declared in the Drizzle column arg, e.g. 'id' in serial('id') */
  name: string
  /** The Drizzle function used, e.g. 'serial', 'text', 'varchar' */
  drizzleType: string
  /** Options object literal if present, e.g. { length: 255 } */
  options: string | null
  /** Chained modifiers like .primaryKey(), .notNull(), .default(...) */
  modifiers: string[]
  /** The full raw source text for this column definition */
  raw: string
}

export interface ParsedEnum {
  /** The JS variable name, e.g. 'userRoleEnum' */
  variableName: string
  /** The SQL enum name, e.g. 'user_role' */
  sqlName: string
  /** The enum values */
  values: string[]
}

export interface ParsedTable {
  /** The JS variable name, e.g. 'users' */
  variableName: string
  /** The SQL table name, e.g. 'users' */
  sqlName: string
  /** The dialect function used, e.g. 'pgTable', 'mysqlTable', 'sqliteTable' */
  dialectFn: string
  /** Parsed column definitions */
  columns: ParsedColumn[]
  /** Raw column block for fallback parsing */
  rawColumnsBlock: string
}

export interface ParsedReference {
  /** The column this reference is on */
  columnName: string
  /** The referenced table variable (JS name) */
  referencedTableVar: string
  /** The referenced column name */
  referencedColumn: string
  /** onDelete action if specified */
  onDelete: string | null
  /** onUpdate action if specified */
  onUpdate: string | null
}

export interface DrizzleParseResult {
  dialect: DrizzleDialect
  tables: ParsedTable[]
  enums: ParsedEnum[]
  references: Map<string, ParsedReference[]>
  /** Map from JS variable name to SQL table name */
  tableVarToSqlName: Map<string, string>
}
