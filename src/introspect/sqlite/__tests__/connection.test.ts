import { describe, it, expect } from 'vitest'
import { isSqliteConnection, extractSqlitePath } from '../connection.js'

describe('isSqliteConnection', () => {
  it('detects sqlite: prefix', () => {
    expect(isSqliteConnection('sqlite:./test.db')).toBe(true)
    expect(isSqliteConnection('sqlite:test.sqlite')).toBe(true)
  })

  it('detects sqlite:/// prefix (absolute path)', () => {
    expect(isSqliteConnection('sqlite:///tmp/test.db')).toBe(true)
    expect(isSqliteConnection('sqlite:///home/user/data.sqlite')).toBe(true)
  })

  it('detects file: prefix', () => {
    expect(isSqliteConnection('file:./test.db')).toBe(true)
    expect(isSqliteConnection('file:test.sqlite')).toBe(true)
  })

  it('detects .sqlite extension', () => {
    expect(isSqliteConnection('./test.sqlite')).toBe(true)
    expect(isSqliteConnection('/path/to/db.sqlite')).toBe(true)
  })

  it('detects .sqlite3 extension', () => {
    expect(isSqliteConnection('./test.sqlite3')).toBe(true)
  })

  it('detects .db extension', () => {
    expect(isSqliteConnection('./test.db')).toBe(true)
    expect(isSqliteConnection('/absolute/path/data.db')).toBe(true)
  })

  it('is case-insensitive for file extensions', () => {
    expect(isSqliteConnection('./test.SQLITE')).toBe(true)
    expect(isSqliteConnection('./test.DB')).toBe(true)
    expect(isSqliteConnection('./test.Sqlite3')).toBe(true)
  })

  it('does not detect PostgreSQL connection strings', () => {
    expect(isSqliteConnection('postgres://localhost/mydb')).toBe(false)
    expect(isSqliteConnection('postgresql://user:pass@host/db')).toBe(false)
  })

  it('does not detect arbitrary strings', () => {
    expect(isSqliteConnection('localhost:5432')).toBe(false)
    expect(isSqliteConnection('my-database')).toBe(false)
  })

  it('handles whitespace', () => {
    expect(isSqliteConnection('  sqlite:./test.db  ')).toBe(true)
    expect(isSqliteConnection('  ./test.sqlite  ')).toBe(true)
  })
})

describe('extractSqlitePath', () => {
  it('extracts path from sqlite: prefix', () => {
    expect(extractSqlitePath('sqlite:./test.db')).toBe('./test.db')
    expect(extractSqlitePath('sqlite:test.sqlite')).toBe('test.sqlite')
  })

  it('extracts absolute path from sqlite:/// prefix', () => {
    expect(extractSqlitePath('sqlite:///tmp/test.db')).toBe('/tmp/test.db')
    expect(extractSqlitePath('sqlite:///home/user/data.sqlite')).toBe(
      '/home/user/data.sqlite',
    )
  })

  it('extracts path from file: prefix', () => {
    expect(extractSqlitePath('file:./test.db')).toBe('./test.db')
    expect(extractSqlitePath('file:test.sqlite')).toBe('test.sqlite')
  })

  it('returns bare paths unchanged', () => {
    expect(extractSqlitePath('./test.db')).toBe('./test.db')
    expect(extractSqlitePath('/absolute/path/data.sqlite')).toBe(
      '/absolute/path/data.sqlite',
    )
  })

  it('handles whitespace', () => {
    expect(extractSqlitePath('  sqlite:./test.db  ')).toBe('./test.db')
    expect(extractSqlitePath('  ./test.db  ')).toBe('./test.db')
  })
})
