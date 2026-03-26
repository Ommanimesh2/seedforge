export enum NormalizedType {
  TEXT = 'TEXT',
  VARCHAR = 'VARCHAR',
  CHAR = 'CHAR',
  SMALLINT = 'SMALLINT',
  INTEGER = 'INTEGER',
  BIGINT = 'BIGINT',
  REAL = 'REAL',
  DOUBLE = 'DOUBLE',
  DECIMAL = 'DECIMAL',
  BOOLEAN = 'BOOLEAN',
  DATE = 'DATE',
  TIME = 'TIME',
  TIMESTAMP = 'TIMESTAMP',
  TIMESTAMPTZ = 'TIMESTAMPTZ',
  INTERVAL = 'INTERVAL',
  JSON = 'JSON',
  JSONB = 'JSONB',
  UUID = 'UUID',
  BYTEA = 'BYTEA',
  INET = 'INET',
  CIDR = 'CIDR',
  MACADDR = 'MACADDR',
  ARRAY = 'ARRAY',
  ENUM = 'ENUM',
  POINT = 'POINT',
  LINE = 'LINE',
  GEOMETRY = 'GEOMETRY',
  VECTOR = 'VECTOR',
  UNKNOWN = 'UNKNOWN',
}

export enum FKAction {
  CASCADE = 'CASCADE',
  SET_NULL = 'SET_NULL',
  SET_DEFAULT = 'SET_DEFAULT',
  RESTRICT = 'RESTRICT',
  NO_ACTION = 'NO_ACTION',
}

export interface ColumnDef {
  name: string
  dataType: NormalizedType
  nativeType: string
  isNullable: boolean
  hasDefault: boolean
  defaultValue: string | null
  isAutoIncrement: boolean
  isGenerated: boolean
  maxLength: number | null
  numericPrecision: number | null
  numericScale: number | null
  enumValues: string[] | null
  comment: string | null
}

export interface PrimaryKeyDef {
  columns: string[]
  name: string | null
}

export interface ForeignKeyDef {
  name: string
  columns: string[]
  referencedTable: string
  referencedSchema: string
  referencedColumns: string[]
  onDelete: FKAction
  onUpdate: FKAction
  isDeferrable: boolean
  isDeferred: boolean
  isVirtual: boolean
}

export interface UniqueConstraintDef {
  columns: string[]
  name: string | null
}

export interface CheckConstraintDef {
  expression: string
  name: string | null
  inferredValues: string[] | null
}

export interface IndexDef {
  columns: string[]
  name: string | null
  isUnique: boolean
}

export interface TableDef {
  name: string
  schema: string
  columns: Map<string, ColumnDef>
  primaryKey: PrimaryKeyDef | null
  foreignKeys: ForeignKeyDef[]
  uniqueConstraints: UniqueConstraintDef[]
  checkConstraints: CheckConstraintDef[]
  indexes: IndexDef[]
  comment: string | null
}

export interface EnumDef {
  name: string
  schema: string
  values: string[]
}

export interface DatabaseSchema {
  name: string
  tables: Map<string, TableDef>
  enums: Map<string, EnumDef>
  schemas: string[]
}
