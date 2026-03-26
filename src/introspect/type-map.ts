import { NormalizedType } from '../types/index.js'

const TYPE_MAP: Record<string, NormalizedType> = {
  // String types
  text: NormalizedType.TEXT,
  'character varying': NormalizedType.VARCHAR,
  varchar: NormalizedType.VARCHAR,
  character: NormalizedType.CHAR,
  char: NormalizedType.CHAR,
  bpchar: NormalizedType.CHAR,

  // Integer types
  smallint: NormalizedType.SMALLINT,
  int2: NormalizedType.SMALLINT,
  integer: NormalizedType.INTEGER,
  int4: NormalizedType.INTEGER,
  int: NormalizedType.INTEGER,
  bigint: NormalizedType.BIGINT,
  int8: NormalizedType.BIGINT,

  // Floating point
  real: NormalizedType.REAL,
  float4: NormalizedType.REAL,
  'double precision': NormalizedType.DOUBLE,
  float8: NormalizedType.DOUBLE,
  numeric: NormalizedType.DECIMAL,
  decimal: NormalizedType.DECIMAL,

  // Boolean
  boolean: NormalizedType.BOOLEAN,
  bool: NormalizedType.BOOLEAN,

  // Date/Time
  date: NormalizedType.DATE,
  time: NormalizedType.TIME,
  'time without time zone': NormalizedType.TIME,
  timetz: NormalizedType.TIME,
  'time with time zone': NormalizedType.TIME,
  timestamp: NormalizedType.TIMESTAMP,
  'timestamp without time zone': NormalizedType.TIMESTAMP,
  'timestamp with time zone': NormalizedType.TIMESTAMPTZ,
  timestamptz: NormalizedType.TIMESTAMPTZ,
  interval: NormalizedType.INTERVAL,

  // JSON
  json: NormalizedType.JSON,
  jsonb: NormalizedType.JSONB,

  // Identifiers
  uuid: NormalizedType.UUID,

  // Binary
  bytea: NormalizedType.BYTEA,

  // Network
  inet: NormalizedType.INET,
  cidr: NormalizedType.CIDR,
  macaddr: NormalizedType.MACADDR,
  macaddr8: NormalizedType.MACADDR,

  // Geometric
  point: NormalizedType.POINT,
  line: NormalizedType.LINE,
  lseg: NormalizedType.LINE,
  box: NormalizedType.LINE,
  path: NormalizedType.LINE,
  polygon: NormalizedType.LINE,
  circle: NormalizedType.LINE,

  // Spatial
  geometry: NormalizedType.GEOMETRY,
  geography: NormalizedType.GEOMETRY,

  // Vector (pgvector)
  vector: NormalizedType.VECTOR,
}

export function mapNativeType(dataType: string, udtName?: string): NormalizedType {
  const normalizedDataType = dataType.toLowerCase().trim()

  // Array detection
  if (normalizedDataType === 'array') {
    return NormalizedType.ARRAY
  }

  // User-defined types (enums)
  if (normalizedDataType === 'user-defined') {
    // Will be resolved to ENUM if udtName matches a known enum
    return NormalizedType.ENUM
  }

  // Check udtName first (more specific)
  if (udtName) {
    const udtLower = udtName.toLowerCase().trim()
    // Handle array element type names (e.g., _text, _int4)
    if (udtLower.startsWith('_')) {
      return NormalizedType.ARRAY
    }
    const fromUdt = TYPE_MAP[udtLower]
    if (fromUdt) return fromUdt
  }

  // Then check data_type
  const fromDataType = TYPE_MAP[normalizedDataType]
  if (fromDataType) return fromDataType

  return NormalizedType.UNKNOWN
}

export function isSerialType(defaultValue: string | null): boolean {
  if (!defaultValue) return false
  return /^nextval\(/.test(defaultValue)
}

export function isGeneratedColumn(
  generationExpression: string | null,
  identityGeneration: string | null,
): boolean {
  if (generationExpression && generationExpression.trim() !== '') return true
  if (identityGeneration === 'ALWAYS') return true
  return false
}
