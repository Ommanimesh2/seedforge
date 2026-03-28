import { describe, it, expect } from 'vitest'
import { NormalizedType } from '../../../types/index.js'
import { mapMysqlType, extractMysqlEnumValues } from '../type-map.js'

describe('mapMysqlType', () => {
  // ─── String types ──────────────────────────────────────────────────
  const stringCases: [string, string | undefined, NormalizedType][] = [
    ['varchar', undefined, NormalizedType.VARCHAR],
    ['char', undefined, NormalizedType.CHAR],
    ['text', undefined, NormalizedType.TEXT],
    ['tinytext', undefined, NormalizedType.TEXT],
    ['mediumtext', undefined, NormalizedType.TEXT],
    ['longtext', undefined, NormalizedType.TEXT],
  ]

  for (const [dataType, columnType, expected] of stringCases) {
    it(`maps ${dataType} to ${expected}`, () => {
      expect(mapMysqlType(dataType, columnType)).toBe(expected)
    })
  }

  // ─── Integer types ─────────────────────────────────────────────────
  const intCases: [string, string | undefined, NormalizedType][] = [
    ['tinyint', 'tinyint(4)', NormalizedType.SMALLINT],
    ['smallint', undefined, NormalizedType.SMALLINT],
    ['mediumint', undefined, NormalizedType.INTEGER],
    ['int', undefined, NormalizedType.INTEGER],
    ['integer', undefined, NormalizedType.INTEGER],
    ['bigint', undefined, NormalizedType.BIGINT],
  ]

  for (const [dataType, columnType, expected] of intCases) {
    it(`maps ${dataType}${columnType ? ` (${columnType})` : ''} to ${expected}`, () => {
      expect(mapMysqlType(dataType, columnType)).toBe(expected)
    })
  }

  // ─── TINYINT(1) → BOOLEAN ─────────────────────────────────────────
  it('maps tinyint(1) to BOOLEAN', () => {
    expect(mapMysqlType('tinyint', 'tinyint(1)')).toBe(NormalizedType.BOOLEAN)
  })

  it('maps TINYINT(1) to BOOLEAN (case-insensitive)', () => {
    expect(mapMysqlType('TINYINT', 'TINYINT(1)')).toBe(NormalizedType.BOOLEAN)
  })

  it('maps tinyint(1) unsigned to BOOLEAN', () => {
    expect(mapMysqlType('tinyint', 'tinyint(1) unsigned')).toBe(NormalizedType.BOOLEAN)
  })

  it('does NOT map tinyint(2) to BOOLEAN', () => {
    expect(mapMysqlType('tinyint', 'tinyint(2)')).toBe(NormalizedType.SMALLINT)
  })

  // ─── Floating point ───────────────────────────────────────────────
  const floatCases: [string, NormalizedType][] = [
    ['float', NormalizedType.REAL],
    ['double', NormalizedType.DOUBLE],
    ['double precision', NormalizedType.DOUBLE],
    ['decimal', NormalizedType.DECIMAL],
    ['numeric', NormalizedType.DECIMAL],
  ]

  for (const [dataType, expected] of floatCases) {
    it(`maps ${dataType} to ${expected}`, () => {
      expect(mapMysqlType(dataType)).toBe(expected)
    })
  }

  // ─── Date/Time ────────────────────────────────────────────────────
  const dateCases: [string, NormalizedType][] = [
    ['date', NormalizedType.DATE],
    ['time', NormalizedType.TIME],
    ['datetime', NormalizedType.TIMESTAMP],
    ['timestamp', NormalizedType.TIMESTAMPTZ],
    ['year', NormalizedType.INTEGER],
  ]

  for (const [dataType, expected] of dateCases) {
    it(`maps ${dataType} to ${expected}`, () => {
      expect(mapMysqlType(dataType)).toBe(expected)
    })
  }

  // ─── JSON ─────────────────────────────────────────────────────────
  it('maps json to JSON', () => {
    expect(mapMysqlType('json')).toBe(NormalizedType.JSON)
  })

  // ─── Binary types ─────────────────────────────────────────────────
  const binaryCases: string[] = ['blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary']

  for (const dataType of binaryCases) {
    it(`maps ${dataType} to BYTEA`, () => {
      expect(mapMysqlType(dataType)).toBe(NormalizedType.BYTEA)
    })
  }

  // ─── ENUM and SET ─────────────────────────────────────────────────
  it('maps enum to ENUM', () => {
    expect(mapMysqlType('enum', "enum('a','b','c')")).toBe(NormalizedType.ENUM)
  })

  it('maps set to ENUM', () => {
    expect(mapMysqlType('set', "set('read','write')")).toBe(NormalizedType.ENUM)
  })

  // ─── Case insensitive ────────────────────────────────────────────
  it('is case-insensitive', () => {
    expect(mapMysqlType('VARCHAR')).toBe(NormalizedType.VARCHAR)
    expect(mapMysqlType('Int')).toBe(NormalizedType.INTEGER)
    expect(mapMysqlType('JSON')).toBe(NormalizedType.JSON)
  })

  // ─── Unknown types ───────────────────────────────────────────────
  it('returns UNKNOWN for unrecognized types', () => {
    expect(mapMysqlType('bit')).toBe(NormalizedType.UNKNOWN)
    expect(mapMysqlType('geometrycollection')).toBe(NormalizedType.GEOMETRY)
  })
})

describe('extractMysqlEnumValues', () => {
  it('extracts values from enum column type', () => {
    expect(extractMysqlEnumValues("enum('active','inactive','pending')")).toEqual([
      'active',
      'inactive',
      'pending',
    ])
  })

  it('extracts values from set column type', () => {
    expect(extractMysqlEnumValues("set('read','write','admin')")).toEqual([
      'read',
      'write',
      'admin',
    ])
  })

  it('handles single value enum', () => {
    expect(extractMysqlEnumValues("enum('only')")).toEqual(['only'])
  })

  it('handles enum values with spaces', () => {
    expect(extractMysqlEnumValues("enum('hello world','foo bar')")).toEqual([
      'hello world',
      'foo bar',
    ])
  })

  it('handles escaped quotes in enum values', () => {
    expect(extractMysqlEnumValues("enum('it''s','test')")).toEqual([
      "it's",
      'test',
    ])
  })

  it('returns null for non-enum types', () => {
    expect(extractMysqlEnumValues('varchar(255)')).toBeNull()
    expect(extractMysqlEnumValues('int')).toBeNull()
    expect(extractMysqlEnumValues('')).toBeNull()
  })

  it('is case-insensitive for enum/set prefix', () => {
    expect(extractMysqlEnumValues("ENUM('a','b')")).toEqual(['a', 'b'])
    expect(extractMysqlEnumValues("SET('x','y')")).toEqual(['x', 'y'])
  })
})
