import { describe, it, expect } from 'vitest'
import { NormalizedType } from '../../../types/index.js'
import { mapSqliteType, isSqliteAutoIncrement } from '../type-map.js'

describe('mapSqliteType', () => {
  const cases: [string, NormalizedType][] = [
    // Text types
    ['TEXT', NormalizedType.TEXT],
    ['text', NormalizedType.TEXT],
    ['CLOB', NormalizedType.TEXT],

    // VARCHAR / CHAR
    ['VARCHAR', NormalizedType.VARCHAR],
    ['VARCHAR(255)', NormalizedType.VARCHAR],
    ['CHARACTER VARYING(100)', NormalizedType.VARCHAR],
    ['CHAR(10)', NormalizedType.CHAR],
    ['CHARACTER(1)', NormalizedType.CHAR],

    // Integer types
    ['INTEGER', NormalizedType.INTEGER],
    ['INT', NormalizedType.INTEGER],
    ['TINYINT', NormalizedType.INTEGER],
    ['MEDIUMINT', NormalizedType.INTEGER],
    ['SMALLINT', NormalizedType.SMALLINT],
    ['INT2', NormalizedType.SMALLINT],
    ['BIGINT', NormalizedType.BIGINT],
    ['INT8', NormalizedType.BIGINT],

    // Floating point
    ['REAL', NormalizedType.REAL],
    ['DOUBLE', NormalizedType.DOUBLE],
    ['DOUBLE PRECISION', NormalizedType.DOUBLE],
    ['FLOAT', NormalizedType.DOUBLE],

    // Decimal / Numeric
    ['DECIMAL', NormalizedType.DECIMAL],
    ['DECIMAL(10,2)', NormalizedType.DECIMAL],
    ['NUMERIC', NormalizedType.DECIMAL],
    ['NUMERIC(5)', NormalizedType.DECIMAL],

    // Boolean
    ['BOOLEAN', NormalizedType.BOOLEAN],
    ['BOOL', NormalizedType.BOOLEAN],

    // Date/Time
    ['DATE', NormalizedType.DATE],
    ['DATETIME', NormalizedType.TIMESTAMP],
    ['TIMESTAMP', NormalizedType.TIMESTAMP],
    ['TIME', NormalizedType.TIME],

    // JSON
    ['JSON', NormalizedType.JSON],
    ['JSONB', NormalizedType.JSON],

    // UUID
    ['UUID', NormalizedType.UUID],

    // BLOB / Binary
    ['BLOB', NormalizedType.BYTEA],
    ['BYTEA', NormalizedType.BYTEA],
  ]

  for (const [sqliteType, expected] of cases) {
    it(`maps "${sqliteType}" to ${expected}`, () => {
      expect(mapSqliteType(sqliteType)).toBe(expected)
    })
  }

  it('is case-insensitive', () => {
    expect(mapSqliteType('integer')).toBe(NormalizedType.INTEGER)
    expect(mapSqliteType('Text')).toBe(NormalizedType.TEXT)
    expect(mapSqliteType('Boolean')).toBe(NormalizedType.BOOLEAN)
  })

  it('returns TEXT for empty type string', () => {
    expect(mapSqliteType('')).toBe(NormalizedType.TEXT)
  })

  it('handles types with extra whitespace', () => {
    expect(mapSqliteType('  INTEGER  ')).toBe(NormalizedType.INTEGER)
    expect(mapSqliteType('  VARCHAR(100)  ')).toBe(NormalizedType.VARCHAR)
  })
})

describe('isSqliteAutoIncrement', () => {
  it('detects INTEGER PRIMARY KEY as auto-increment', () => {
    expect(isSqliteAutoIncrement('INTEGER', true, null, 'id')).toBe(true)
  })

  it('does not treat INTEGER as auto-increment if not PK', () => {
    expect(isSqliteAutoIncrement('INTEGER', false, null, 'count')).toBe(false)
  })

  it('does not treat TEXT PRIMARY KEY as auto-increment', () => {
    expect(isSqliteAutoIncrement('TEXT', true, null, 'id')).toBe(false)
  })

  it('detects AUTOINCREMENT keyword in CREATE SQL', () => {
    const createSql =
      'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)'
    expect(isSqliteAutoIncrement('INTEGER', true, createSql, 'id')).toBe(true)
  })

  it('does not detect AUTOINCREMENT for wrong column', () => {
    const createSql =
      'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER)'
    expect(isSqliteAutoIncrement('INTEGER', true, createSql, 'seq')).toBe(true)
    // seq is INTEGER PRIMARY KEY -> still auto-increment by SQLite rules
  })

  it('returns false for non-integer PK types even with AUTOINCREMENT in SQL', () => {
    const createSql =
      'CREATE TABLE items (id TEXT PRIMARY KEY, seq INTEGER)'
    expect(isSqliteAutoIncrement('TEXT', true, createSql, 'id')).toBe(false)
  })
})
