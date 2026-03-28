import Database from 'better-sqlite3'
import { ConnectionError } from '../../errors/index.js'

export type SqliteDatabase = Database.Database

/**
 * Open a SQLite database and enable foreign keys.
 *
 * @param filePath - Path to the SQLite database file (or ":memory:" for in-memory)
 * @returns The opened better-sqlite3 database instance
 */
export function connectSqlite(filePath: string): SqliteDatabase {
  try {
    const db = new Database(filePath)
    db.pragma('foreign_keys = ON')
    return db
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConnectionError(
      'SF1010',
      `Cannot open SQLite database at "${filePath}": ${detail}`,
      [
        'Check that the file path is correct',
        'Ensure the directory exists and is writable',
        'For a new database, the parent directory must exist',
      ],
      { filePath },
    )
  }
}

/**
 * Close a SQLite database connection.
 *
 * @param db - The better-sqlite3 database instance
 */
export function disconnectSqlite(db: SqliteDatabase): void {
  try {
    db.close()
  } catch {
    // Swallow disconnect errors, same pattern as PG
  }
}

/**
 * Detect whether a connection string refers to a SQLite database.
 *
 * Recognized patterns:
 * - `sqlite:./path/to/db.sqlite`
 * - `sqlite:///absolute/path`
 * - `file:./path`
 * - Any path ending with `.sqlite`, `.sqlite3`, or `.db`
 *
 * @param connectionString - The connection string to test
 * @returns true if the string is a SQLite connection
 */
export function isSqliteConnection(connectionString: string): boolean {
  const trimmed = connectionString.trim()
  if (trimmed.startsWith('sqlite:') || trimmed.startsWith('file:')) {
    return true
  }
  if (/\.(sqlite3?|db)$/i.test(trimmed)) {
    return true
  }
  return false
}

/**
 * Extract the file path from a SQLite connection string.
 *
 * @param connectionString - The SQLite connection string
 * @returns The file path to the SQLite database
 */
export function extractSqlitePath(connectionString: string): string {
  const trimmed = connectionString.trim()

  if (trimmed.startsWith('sqlite:///')) {
    // sqlite:///absolute/path -> /absolute/path
    return trimmed.slice('sqlite://'.length)
  }
  if (trimmed.startsWith('sqlite:')) {
    // sqlite:./relative or sqlite:path
    return trimmed.slice('sqlite:'.length)
  }
  if (trimmed.startsWith('file:')) {
    // file:./path or file:path
    return trimmed.slice('file:'.length)
  }

  // Bare path: ./db.sqlite, /path/to/db.db, etc.
  return trimmed
}
