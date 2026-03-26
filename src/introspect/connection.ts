import pg from 'pg'
import {
  connectionFailed,
  authenticationFailed,
  databaseNotFound,
  connectionTimeout,
  ConnectionError,
  redactConnectionString,
} from '../errors/index.js'
import {
  isProductionHost,
  extractHostFromConnectionString,
  confirmProductionAccess,
} from './safety.js'

export interface ConnectOptions {
  connectionString: string
  timeoutMs?: number
  schema?: string
  skipProductionCheck?: boolean
}

export async function connect(options: ConnectOptions): Promise<pg.Client> {
  const {
    connectionString,
    timeoutMs = 10_000,
    schema = 'public',
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

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
  })

  try {
    await client.connect()
  } catch (err) {
    throw mapPgError(err, connectionString, timeoutMs)
  }

  try {
    await client.query(`SET search_path TO ${pg.Client.prototype.escapeIdentifier(schema)}`)
  } catch (err) {
    await disconnect(client)
    throw mapPgError(err, connectionString, timeoutMs)
  }

  return client
}

export async function disconnect(client: pg.Client): Promise<void> {
  try {
    await client.end()
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

function mapPgError(
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

  const pgErr = err as Error & { code?: string }
  const message = redactConnectionString(pgErr.message)

  // System-level errors
  if (pgErr.code === 'ECONNREFUSED' || pgErr.code === 'ENOTFOUND' || pgErr.code === 'EHOSTUNREACH') {
    const host = extractHostFromConnectionString(connectionString)
    return connectionFailed(host ?? 'unknown', 5432)
  }

  if (pgErr.code === 'ETIMEDOUT' || message.includes('timeout')) {
    return connectionTimeout(timeoutMs)
  }

  // PG protocol errors
  if (pgErr.code === '28P01' || pgErr.code === '28000') {
    const host = extractHostFromConnectionString(connectionString)
    return authenticationFailed(host ?? 'unknown')
  }

  if (pgErr.code === '3D000') {
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
