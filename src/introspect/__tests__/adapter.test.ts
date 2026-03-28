import { describe, it, expect } from 'vitest'
import { detectDatabaseType, DatabaseType } from '../adapter.js'

describe('detectDatabaseType', () => {
  // ─── PostgreSQL ────────────────────────────────────────────────────
  it('detects postgres:// as POSTGRES', () => {
    expect(detectDatabaseType('postgres://user:pass@localhost/mydb')).toBe(
      DatabaseType.POSTGRES,
    )
  })

  it('detects postgresql:// as POSTGRES', () => {
    expect(detectDatabaseType('postgresql://user:pass@localhost:5432/mydb')).toBe(
      DatabaseType.POSTGRES,
    )
  })

  it('detects POSTGRES:// (case-insensitive) as POSTGRES', () => {
    expect(detectDatabaseType('POSTGRES://user@localhost/mydb')).toBe(
      DatabaseType.POSTGRES,
    )
  })

  // ─── MySQL ─────────────────────────────────────────────────────────
  it('detects mysql:// as MYSQL', () => {
    expect(detectDatabaseType('mysql://root:pass@localhost/mydb')).toBe(
      DatabaseType.MYSQL,
    )
  })

  it('detects mysql:// with port as MYSQL', () => {
    expect(detectDatabaseType('mysql://root:pass@localhost:3306/mydb')).toBe(
      DatabaseType.MYSQL,
    )
  })

  it('detects MYSQL:// (case-insensitive) as MYSQL', () => {
    expect(detectDatabaseType('MYSQL://root@localhost/mydb')).toBe(
      DatabaseType.MYSQL,
    )
  })

  // ─── Whitespace handling ──────────────────────────────────────────
  it('trims whitespace before detection', () => {
    expect(detectDatabaseType('  mysql://root@localhost/mydb  ')).toBe(
      DatabaseType.MYSQL,
    )
    expect(detectDatabaseType('  postgres://user@localhost/mydb  ')).toBe(
      DatabaseType.POSTGRES,
    )
  })

  // ─── Unknown schemes ─────────────────────────────────────────────
  it('throws ConfigError for unsupported schemes', () => {
    expect(() => detectDatabaseType('mongodb://localhost/mydb')).toThrow(
      'Unsupported database URL scheme',
    )
  })

  it('throws ConfigError for missing scheme', () => {
    expect(() => detectDatabaseType('just-a-hostname')).toThrow(
      'Unsupported database URL scheme',
    )
  })
})
