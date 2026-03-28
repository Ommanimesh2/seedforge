import mysql from 'mysql2/promise'
import type { Connection } from 'mysql2/promise'
import {
  connectionFailed,
  authenticationFailed,
  databaseNotFound,
  connectionTimeout,
  ConnectionError,
  redactConnectionString,
} from '../../errors/index.js'
import {
  isProductionHost,
  extractHostFromConnectionString,
  confirmProductionAccess,
} from '../safety.js'

export interface MysqlConnectOptions {
  connectionString: string
  timeoutMs?: number
  database?: string
  skipProductionCheck?: boolean
}

export async function connectMysql(options: MysqlConnectOptions): Promise<Connection> {
  const {
    connectionString,
    timeoutMs = 10_000,
    skipProductionCheck = false,
  } = options

  // Production safety check
  const host = extractHostFromConnectionString(connectionString)
  if (host && isProductionHost(host)) {
    const confirmed = await confirmProductionAccess(host, skipProductionCheck)
    if (!confirmed) {
      throw connectionAborted()
    }
  }

  try {
    const connection = await mysql.createConnection({
      uri: connectionString,
      connectTimeout: timeoutMs,
    })
    return connection
  } catch (err) {
    throw mapMysqlError(err, connectionString, timeoutMs)
  }
}

export async function disconnectMysql(connection: Connection): Promise<void> {
  try {
    await connection.end()
  } catch {
    // Swallow disconnect errors
  }
}

function connectionAborted(): ConnectionError {
  return new ConnectionError(
    'SF1006',
    'Connection aborted by user',
    ['Use --yes to skip production confirmation prompts'],
  )
}

function mapMysqlError(
  err: unknown,
  connectionString: string,
  timeoutMs: number,
): ConnectionError {
  if (!(err instanceof Error)) {
    return new ConnectionError(
      'SF1004',
      'Unknown connection error',
      ['Check your connection string and try again'],
    )
  }

  const mysqlErr = err as Error & { code?: string; errno?: number }
  const message = redactConnectionString(mysqlErr.message)

  // System-level errors
  if (mysqlErr.code === 'ECONNREFUSED' || mysqlErr.code === 'ENOTFOUND' || mysqlErr.code === 'EHOSTUNREACH') {
    const host = extractHostFromConnectionString(connectionString)
    return connectionFailed(host ?? 'unknown', 3306)
  }

  if (mysqlErr.code === 'ETIMEDOUT' || mysqlErr.code === 'PROTOCOL_CONNECTION_LOST' || message.includes('timeout')) {
    return connectionTimeout(timeoutMs)
  }

  // MySQL protocol errors
  // ER_ACCESS_DENIED_ERROR = 1045
  if (mysqlErr.errno === 1045 || mysqlErr.code === 'ER_ACCESS_DENIED_ERROR') {
    const host = extractHostFromConnectionString(connectionString)
    return authenticationFailed(host ?? 'unknown')
  }

  // ER_BAD_DB_ERROR = 1049
  if (mysqlErr.errno === 1049 || mysqlErr.code === 'ER_BAD_DB_ERROR') {
    const dbName = extractDatabaseName(connectionString)
    return databaseNotFound(dbName ?? 'unknown')
  }

  return new ConnectionError('SF1004', message, [
    'Check your connection string and database server status',
  ])
}

function extractDatabaseName(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}
