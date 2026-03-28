import { NormalizedType } from '../../types/index.js'

const MYSQL_TYPE_MAP: Record<string, NormalizedType> = {
  // String types
  varchar: NormalizedType.VARCHAR,
  char: NormalizedType.CHAR,
  text: NormalizedType.TEXT,
  tinytext: NormalizedType.TEXT,
  mediumtext: NormalizedType.TEXT,
  longtext: NormalizedType.TEXT,

  // Integer types
  smallint: NormalizedType.SMALLINT,
  mediumint: NormalizedType.INTEGER,
  int: NormalizedType.INTEGER,
  integer: NormalizedType.INTEGER,
  bigint: NormalizedType.BIGINT,

  // Floating point
  float: NormalizedType.REAL,
  double: NormalizedType.DOUBLE,
  'double precision': NormalizedType.DOUBLE,
  decimal: NormalizedType.DECIMAL,
  numeric: NormalizedType.DECIMAL,

  // Boolean (TINYINT(1) is handled specially in mapMysqlType)
  // tinyint without (1) maps to SMALLINT
  tinyint: NormalizedType.SMALLINT,

  // Date/Time
  date: NormalizedType.DATE,
  time: NormalizedType.TIME,
  datetime: NormalizedType.TIMESTAMP,
  timestamp: NormalizedType.TIMESTAMPTZ,
  year: NormalizedType.INTEGER,

  // JSON
  json: NormalizedType.JSON,

  // Binary types
  blob: NormalizedType.BYTEA,
  tinyblob: NormalizedType.BYTEA,
  mediumblob: NormalizedType.BYTEA,
  longblob: NormalizedType.BYTEA,
  binary: NormalizedType.BYTEA,
  varbinary: NormalizedType.BYTEA,

  // Spatial
  geometry: NormalizedType.GEOMETRY,
  point: NormalizedType.POINT,
  linestring: NormalizedType.LINE,
  polygon: NormalizedType.LINE,
  multipoint: NormalizedType.POINT,
  multilinestring: NormalizedType.LINE,
  multipolygon: NormalizedType.LINE,
  geometrycollection: NormalizedType.GEOMETRY,
}

/**
 * Map a MySQL column type to a NormalizedType.
 *
 * @param dataType - The DATA_TYPE from information_schema.COLUMNS (e.g., 'varchar', 'int', 'enum')
 * @param columnType - The COLUMN_TYPE from information_schema.COLUMNS (e.g., 'tinyint(1)', 'enum(\'a\',\'b\')')
 * @returns The normalized type
 */
export function mapMysqlType(dataType: string, columnType?: string): NormalizedType {
  const normalizedDataType = dataType.toLowerCase().trim()

  // ENUM and SET are special
  if (normalizedDataType === 'enum' || normalizedDataType === 'set') {
    return NormalizedType.ENUM
  }

  // TINYINT(1) → BOOLEAN
  if (normalizedDataType === 'tinyint' && columnType) {
    const normalizedColumnType = columnType.toLowerCase().trim()
    if (/^tinyint\(1\)/.test(normalizedColumnType)) {
      return NormalizedType.BOOLEAN
    }
  }

  const mapped = MYSQL_TYPE_MAP[normalizedDataType]
  if (mapped) return mapped

  return NormalizedType.UNKNOWN
}

/**
 * Extract ENUM values from a MySQL COLUMN_TYPE string.
 *
 * MySQL stores the enum definition inline in COLUMN_TYPE, e.g.:
 *   enum('active','inactive','pending')
 *   set('read','write','admin')
 *
 * @param columnType - The COLUMN_TYPE value from information_schema.COLUMNS
 * @returns Array of enum values, or null if not an enum/set type
 */
export function extractMysqlEnumValues(columnType: string): string[] | null {
  if (!columnType) return null

  const normalized = columnType.trim()

  // Match enum('val1','val2',...) or set('val1','val2',...)
  const match = normalized.match(/^(?:enum|set)\s*\((.*)\)$/i)
  if (!match) return null

  const inner = match[1]
  const values: string[] = []
  // Parse quoted values, handling escaped quotes within values
  const regex = /'((?:[^'\\]|\\.|'')*)'/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(inner)) !== null) {
    // Unescape: MySQL uses '' for literal ' inside values, and \' as well
    values.push(m[1].replace(/''/g, "'").replace(/\\'/g, "'"))
  }

  return values.length > 0 ? values : null
}
