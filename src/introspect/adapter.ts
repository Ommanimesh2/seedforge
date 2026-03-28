import type { DatabaseSchema } from '../types/schema.js'
import { ConfigError } from '../errors/index.js'

/**
 * Supported database types.
 */
export enum DatabaseType {
  POSTGRES = 'postgres',
  MYSQL = 'mysql',
  SQLITE = 'sqlite',
}

/**
 * A unified database adapter interface for connecting, introspecting,
 * and disconnecting from different database engines.
 */
export interface DatabaseAdapter {
  readonly type: DatabaseType

  /**
   * Connect to the database.
   * @param options - Connection options including connection string
   * @returns An opaque connection handle
   */
  connect(options: AdapterConnectOptions): Promise<unknown>

  /**
   * Disconnect from the database.
   * @param connection - The connection handle returned by connect()
   */
  disconnect(connection: unknown): Promise<void>

  /**
   * Introspect the database schema.
   * @param connection - The connection handle returned by connect()
   * @param schema - The schema/database name to introspect
   * @returns The normalized DatabaseSchema
   */
  introspect(connection: unknown, schema: string): Promise<DatabaseSchema>
}

export interface AdapterConnectOptions {
  connectionString: string
  timeoutMs?: number
  schema?: string
  skipProductionCheck?: boolean
}

/**
 * Detect the database type from a connection string URL scheme.
 *
 * @param connectionString - A database connection URL
 * @returns The detected DatabaseType
 * @throws ConfigError if the scheme is not recognized
 */
export function detectDatabaseType(connectionString: string): DatabaseType {
  const trimmed = connectionString.trim()

  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    return DatabaseType.POSTGRES
  }

  if (/^mysql:\/\//i.test(trimmed)) {
    return DatabaseType.MYSQL
  }

  // SQLite detection: sqlite: prefix, file: prefix, or .sqlite/.sqlite3/.db extension
  if (
    /^sqlite:/i.test(trimmed) ||
    /^file:/i.test(trimmed) ||
    /\.(sqlite3?|db)$/i.test(trimmed)
  ) {
    return DatabaseType.SQLITE
  }

  throw new ConfigError(
    'SF5018',
    `Unsupported database URL scheme: "${trimmed.split('://')[0] ?? trimmed}"`,
    [
      'Use postgres:// or postgresql:// for PostgreSQL',
      'Use mysql:// for MySQL',
      'Use sqlite:./path/to/db.sqlite for SQLite',
      'Example: --db postgres://user:pass@localhost/mydb',
      'Example: --db mysql://user:pass@localhost/mydb',
      'Example: --db sqlite:./dev.db',
    ],
  )
}

/**
 * Create a DatabaseAdapter for the given database type.
 *
 * Uses lazy imports to avoid loading unnecessary drivers.
 *
 * @param type - The database type
 * @returns A DatabaseAdapter instance
 */
export async function createAdapter(type: DatabaseType): Promise<DatabaseAdapter> {
  switch (type) {
    case DatabaseType.POSTGRES:
      return createPostgresAdapter()
    case DatabaseType.MYSQL:
      return createMysqlAdapter()
    case DatabaseType.SQLITE:
      return createSqliteAdapter()
  }
}

async function createPostgresAdapter(): Promise<DatabaseAdapter> {
  const { connect, disconnect } = await import('./connection.js')
  const { introspect } = await import('./introspect.js')

  return {
    type: DatabaseType.POSTGRES,

    async connect(options: AdapterConnectOptions): Promise<unknown> {
      return connect({
        connectionString: options.connectionString,
        timeoutMs: options.timeoutMs,
        schema: options.schema ?? 'public',
        skipProductionCheck: options.skipProductionCheck,
      })
    },

    async disconnect(connection: unknown): Promise<void> {
      const pg = await import('pg')
      if (connection instanceof pg.default.Client) {
        await disconnect(connection)
      }
    },

    async introspect(connection: unknown, schema: string): Promise<DatabaseSchema> {
      const pg = await import('pg')
      if (!(connection instanceof pg.default.Client)) {
        throw new Error('Invalid PG connection')
      }
      return introspect(connection, schema)
    },
  }
}

async function createMysqlAdapter(): Promise<DatabaseAdapter> {
  const { connectMysql, disconnectMysql } = await import('./mysql/connection.js')
  const { introspectMysql } = await import('./mysql/introspect.js')

  return {
    type: DatabaseType.MYSQL,

    async connect(options: AdapterConnectOptions): Promise<unknown> {
      return connectMysql({
        connectionString: options.connectionString,
        timeoutMs: options.timeoutMs,
        database: options.schema,
        skipProductionCheck: options.skipProductionCheck,
      })
    },

    async disconnect(connection: unknown): Promise<void> {
      // mysql2 Connection type check via duck typing
      const conn = connection as { end?: () => Promise<void> }
      if (conn && typeof conn.end === 'function') {
        await disconnectMysql(connection as import('mysql2/promise').Connection)
      }
    },

    async introspect(connection: unknown, schema: string): Promise<DatabaseSchema> {
      return introspectMysql(
        connection as import('mysql2/promise').Connection,
        schema,
      )
    },
  }
}

async function createSqliteAdapter(): Promise<DatabaseAdapter> {
  const { connectSqlite, disconnectSqlite, extractSqlitePath } = await import('./sqlite/connection.js')
  const { introspectSqlite } = await import('./sqlite/introspect.js')

  return {
    type: DatabaseType.SQLITE,

    async connect(options: AdapterConnectOptions): Promise<unknown> {
      const filePath = extractSqlitePath(options.connectionString)
      return connectSqlite(filePath)
    },

    async disconnect(connection: unknown): Promise<void> {
      // Duck-type check for better-sqlite3 Database
      const db = connection as { close?: () => void }
      if (db && typeof db.close === 'function') {
        disconnectSqlite(connection as import('./sqlite/connection.js').SqliteDatabase)
      }
    },

    async introspect(connection: unknown, schema: string): Promise<DatabaseSchema> {
      void schema // SQLite doesn't use schema names
      const db = connection as import('./sqlite/connection.js').SqliteDatabase
      return introspectSqlite(db)
    },
  }
}
