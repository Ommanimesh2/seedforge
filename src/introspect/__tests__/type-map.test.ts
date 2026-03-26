import { describe, it, expect } from 'vitest'
import { NormalizedType } from '../../types/index.js'
import { mapNativeType, isSerialType, isGeneratedColumn } from '../type-map.js'

describe('mapNativeType', () => {
  const cases: [string, string | undefined, NormalizedType][] = [
    ['text', undefined, NormalizedType.TEXT],
    ['character varying', undefined, NormalizedType.VARCHAR],
    ['character varying', 'varchar', NormalizedType.VARCHAR],
    ['character', 'bpchar', NormalizedType.CHAR],
    ['smallint', 'int2', NormalizedType.SMALLINT],
    ['integer', 'int4', NormalizedType.INTEGER],
    ['bigint', 'int8', NormalizedType.BIGINT],
    ['real', 'float4', NormalizedType.REAL],
    ['double precision', 'float8', NormalizedType.DOUBLE],
    ['numeric', 'numeric', NormalizedType.DECIMAL],
    ['boolean', 'bool', NormalizedType.BOOLEAN],
    ['date', undefined, NormalizedType.DATE],
    ['time without time zone', undefined, NormalizedType.TIME],
    ['timestamp without time zone', 'timestamp', NormalizedType.TIMESTAMP],
    ['timestamp with time zone', 'timestamptz', NormalizedType.TIMESTAMPTZ],
    ['interval', undefined, NormalizedType.INTERVAL],
    ['json', undefined, NormalizedType.JSON],
    ['jsonb', undefined, NormalizedType.JSONB],
    ['uuid', undefined, NormalizedType.UUID],
    ['bytea', undefined, NormalizedType.BYTEA],
    ['inet', undefined, NormalizedType.INET],
    ['cidr', undefined, NormalizedType.CIDR],
    ['macaddr', undefined, NormalizedType.MACADDR],
    ['point', undefined, NormalizedType.POINT],
    ['line', undefined, NormalizedType.LINE],
    ['ARRAY', '_text', NormalizedType.ARRAY],
    ['ARRAY', '_int4', NormalizedType.ARRAY],
    ['USER-DEFINED', 'my_enum', NormalizedType.ENUM],
  ]

  for (const [dataType, udtName, expected] of cases) {
    it(`maps ${dataType}${udtName ? ` (${udtName})` : ''} to ${expected}`, () => {
      expect(mapNativeType(dataType, udtName)).toBe(expected)
    })
  }

  it('is case-insensitive', () => {
    expect(mapNativeType('TEXT')).toBe(NormalizedType.TEXT)
    expect(mapNativeType('Integer')).toBe(NormalizedType.INTEGER)
    expect(mapNativeType('BOOLEAN')).toBe(NormalizedType.BOOLEAN)
  })

  it('returns UNKNOWN for unrecognized types', () => {
    expect(mapNativeType('tsvector')).toBe(NormalizedType.UNKNOWN)
    expect(mapNativeType('tsquery')).toBe(NormalizedType.UNKNOWN)
    expect(mapNativeType('xml')).toBe(NormalizedType.UNKNOWN)
  })
})

describe('isSerialType', () => {
  it('detects nextval() as serial', () => {
    expect(isSerialType("nextval('users_id_seq'::regclass)")).toBe(true)
    expect(isSerialType("nextval('orders_id_seq')")).toBe(true)
  })

  it('returns false for non-serial defaults', () => {
    expect(isSerialType("'active'::text")).toBe(false)
    expect(isSerialType('now()')).toBe(false)
    expect(isSerialType('0')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isSerialType(null)).toBe(false)
  })
})

describe('isGeneratedColumn', () => {
  it('detects GENERATED ALWAYS AS IDENTITY', () => {
    expect(isGeneratedColumn(null, 'ALWAYS')).toBe(true)
  })

  it('detects GENERATED ALWAYS AS (stored)', () => {
    expect(isGeneratedColumn("(name || ' <' || email || '>')", null)).toBe(true)
  })

  it('returns false for normal columns', () => {
    expect(isGeneratedColumn(null, null)).toBe(false)
    expect(isGeneratedColumn('', null)).toBe(false)
    expect(isGeneratedColumn(null, 'BY DEFAULT')).toBe(false)
  })
})
