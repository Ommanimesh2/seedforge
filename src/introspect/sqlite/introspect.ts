import type { SqliteDatabase } from './connection.js'
import type { DatabaseSchema } from '../../types/index.js'
import { IntrospectError } from '../../errors/index.js'
import { queryAllTables } from './queries.js'

/**
 * Introspect a SQLite database and return a DatabaseSchema.
 *
 * This is the SQLite equivalent of the PG `introspect()` function.
 *
 * @param db - The better-sqlite3 database instance
 * @param dbPath - The file path to the database (used for the schema name)
 * @returns A DatabaseSchema representing the SQLite database
 */
export function introspectSqlite(db: SqliteDatabase, dbPath: string = ':memory:'): DatabaseSchema {
  try {
    // SQLite has no native enums
    const enums = new Map()

    // Query all tables with columns, PKs, FKs, indexes, etc.
    const tables = queryAllTables(db)

    // Derive database name from file path
    const name =
      dbPath === ':memory:'
        ? 'memory'
        : (dbPath.split(/[/\\]/).pop() ?? dbPath).replace(/\.[^.]+$/, '')

    return {
      name,
      tables,
      enums,
      schemas: ['main'],
    }
  } catch (err) {
    if (err instanceof IntrospectError) throw err
    if (err instanceof Error && 'code' in err) throw err // SeedForgeError subtype
    throw new IntrospectError(
      'SF2004',
      `SQLite schema introspection failed: ${err instanceof Error ? err.message : String(err)}`,
      [
        'Check that the SQLite database file is valid',
        'Ensure the database is not locked by another process',
      ],
    )
  }
}
