/**
 * Map Drizzle column type functions to NormalizedType values.
 */

import { NormalizedType } from '../../types/index.js'
import type { DrizzleDialect } from './types.js'

interface TypeMapping {
  type: NormalizedType
  isAutoIncrement?: boolean
  nativeType: string
}

const PG_TYPE_MAP: Record<string, TypeMapping> = {
  // Serial types (auto-increment)
  serial: { type: NormalizedType.INTEGER, isAutoIncrement: true, nativeType: 'serial' },
  bigserial: { type: NormalizedType.BIGINT, isAutoIncrement: true, nativeType: 'bigserial' },
  smallserial: { type: NormalizedType.SMALLINT, isAutoIncrement: true, nativeType: 'smallserial' },

  // String types
  text: { type: NormalizedType.TEXT, nativeType: 'text' },
  varchar: { type: NormalizedType.VARCHAR, nativeType: 'character varying' },
  char: { type: NormalizedType.CHAR, nativeType: 'character' },

  // Integer types
  integer: { type: NormalizedType.INTEGER, nativeType: 'integer' },
  bigint: { type: NormalizedType.BIGINT, nativeType: 'bigint' },
  smallint: { type: NormalizedType.SMALLINT, nativeType: 'smallint' },

  // Floating point
  real: { type: NormalizedType.REAL, nativeType: 'real' },
  doublePrecision: { type: NormalizedType.DOUBLE, nativeType: 'double precision' },
  numeric: { type: NormalizedType.DECIMAL, nativeType: 'numeric' },
  decimal: { type: NormalizedType.DECIMAL, nativeType: 'numeric' },

  // Boolean
  boolean: { type: NormalizedType.BOOLEAN, nativeType: 'boolean' },

  // Date/Time
  timestamp: { type: NormalizedType.TIMESTAMPTZ, nativeType: 'timestamp with time zone' },
  date: { type: NormalizedType.DATE, nativeType: 'date' },
  time: { type: NormalizedType.TIME, nativeType: 'time without time zone' },
  interval: { type: NormalizedType.INTERVAL, nativeType: 'interval' },

  // JSON
  json: { type: NormalizedType.JSON, nativeType: 'json' },
  jsonb: { type: NormalizedType.JSONB, nativeType: 'jsonb' },

  // Identifiers
  uuid: { type: NormalizedType.UUID, nativeType: 'uuid' },

  // Binary
  bytea: { type: NormalizedType.BYTEA, nativeType: 'bytea' },

  // Network
  inet: { type: NormalizedType.INET, nativeType: 'inet' },
  cidr: { type: NormalizedType.CIDR, nativeType: 'cidr' },
  macaddr: { type: NormalizedType.MACADDR, nativeType: 'macaddr' },

  // Geometric
  point: { type: NormalizedType.POINT, nativeType: 'point' },
  line: { type: NormalizedType.LINE, nativeType: 'line' },

  // Vector
  vector: { type: NormalizedType.VECTOR, nativeType: 'vector' },
}

const MYSQL_TYPE_MAP: Record<string, TypeMapping> = {
  // Serial
  serial: { type: NormalizedType.BIGINT, isAutoIncrement: true, nativeType: 'serial' },

  // String types
  text: { type: NormalizedType.TEXT, nativeType: 'text' },
  varchar: { type: NormalizedType.VARCHAR, nativeType: 'varchar' },
  char: { type: NormalizedType.CHAR, nativeType: 'char' },
  tinytext: { type: NormalizedType.TEXT, nativeType: 'tinytext' },
  mediumtext: { type: NormalizedType.TEXT, nativeType: 'mediumtext' },
  longtext: { type: NormalizedType.TEXT, nativeType: 'longtext' },

  // Integer types
  int: { type: NormalizedType.INTEGER, nativeType: 'int' },
  integer: { type: NormalizedType.INTEGER, nativeType: 'int' },
  tinyint: { type: NormalizedType.SMALLINT, nativeType: 'tinyint' },
  smallint: { type: NormalizedType.SMALLINT, nativeType: 'smallint' },
  mediumint: { type: NormalizedType.INTEGER, nativeType: 'mediumint' },
  bigint: { type: NormalizedType.BIGINT, nativeType: 'bigint' },

  // Floating point
  float: { type: NormalizedType.REAL, nativeType: 'float' },
  double: { type: NormalizedType.DOUBLE, nativeType: 'double' },
  decimal: { type: NormalizedType.DECIMAL, nativeType: 'decimal' },
  numeric: { type: NormalizedType.DECIMAL, nativeType: 'decimal' },
  real: { type: NormalizedType.REAL, nativeType: 'real' },

  // Boolean
  boolean: { type: NormalizedType.BOOLEAN, nativeType: 'boolean' },

  // Date/Time
  timestamp: { type: NormalizedType.TIMESTAMP, nativeType: 'timestamp' },
  datetime: { type: NormalizedType.TIMESTAMP, nativeType: 'datetime' },
  date: { type: NormalizedType.DATE, nativeType: 'date' },
  time: { type: NormalizedType.TIME, nativeType: 'time' },

  // JSON
  json: { type: NormalizedType.JSON, nativeType: 'json' },

  // Binary
  binary: { type: NormalizedType.BYTEA, nativeType: 'binary' },
  varbinary: { type: NormalizedType.BYTEA, nativeType: 'varbinary' },
  blob: { type: NormalizedType.BYTEA, nativeType: 'blob' },
}

const SQLITE_TYPE_MAP: Record<string, TypeMapping> = {
  text: { type: NormalizedType.TEXT, nativeType: 'text' },
  integer: { type: NormalizedType.INTEGER, nativeType: 'integer' },
  real: { type: NormalizedType.REAL, nativeType: 'real' },
  blob: { type: NormalizedType.BYTEA, nativeType: 'blob' },
  numeric: { type: NormalizedType.DECIMAL, nativeType: 'numeric' },
}

const DIALECT_MAPS: Record<DrizzleDialect, Record<string, TypeMapping>> = {
  pg: PG_TYPE_MAP,
  mysql: MYSQL_TYPE_MAP,
  sqlite: SQLITE_TYPE_MAP,
}

const DEFAULT_MAPPING: TypeMapping = {
  type: NormalizedType.UNKNOWN,
  nativeType: 'unknown',
}

export function mapDrizzleType(
  drizzleType: string,
  dialect: DrizzleDialect,
): TypeMapping {
  const map = DIALECT_MAPS[dialect]
  return map[drizzleType] ?? DEFAULT_MAPPING
}
