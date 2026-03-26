export { redactConnectionString } from './redact.js'

export class SeedForgeError extends Error {
  readonly code: string
  readonly hints: string[]
  readonly context: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'SeedForgeError'
    this.code = code
    this.hints = hints
    this.context = context
  }

  render(): string {
    const lines: string[] = []
    lines.push(`ERROR [${this.code}]: ${this.message}`)
    lines.push('')
    if (this.hints.length > 0) {
      lines.push('  Hints:')
      for (const hint of this.hints) {
        lines.push(`    - ${hint}`)
      }
    }
    return lines.join('\n')
  }
}

export class ConnectionError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'ConnectionError'
  }
}

export class IntrospectError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'IntrospectError'
  }
}

export class GenerationError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'GenerationError'
  }
}

export class InsertionError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'InsertionError'
  }
}

export class ConfigError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'ConfigError'
  }
}

export class PluginError extends SeedForgeError {
  constructor(
    code: string,
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super(code, message, hints, context)
    this.name = 'PluginError'
  }
}

// Factory functions for common errors

export function connectionFailed(host: string, port: number): ConnectionError {
  return new ConnectionError(
    'SF1001',
    `Cannot connect to database server at ${host}:${port}`,
    [
      `Check that the server is running and accepting connections at ${host}:${port}`,
      `Try running: pg_isready -h ${host} -p ${port}`,
    ],
    { host, port },
  )
}

export function authenticationFailed(user: string): ConnectionError {
  return new ConnectionError(
    'SF1002',
    `Authentication failed for user "${user}"`,
    [
      'Verify username and password in connection string',
      'Check pg_hba.conf allows this connection method',
    ],
    { user },
  )
}

export function databaseNotFound(name: string): ConnectionError {
  return new ConnectionError(
    'SF1003',
    `Database "${name}" does not exist`,
    [
      `Create it with: createdb ${name}`,
    ],
    { database: name },
  )
}

export function connectionTimeout(ms: number): ConnectionError {
  return new ConnectionError(
    'SF1005',
    `Connection timed out after ${ms}ms`,
    [
      'Check network connectivity and firewall rules',
      'Increase timeout: --timeout <ms>',
    ],
    { timeout: ms },
  )
}

export function noTablesFound(schema: string): IntrospectError {
  return new IntrospectError(
    'SF2001',
    `No tables found in schema "${schema}"`,
    [
      'Check the schema name is correct',
      'Run migrations first if tables have not been created',
    ],
    { schema },
  )
}

export function unsupportedColumnType(
  table: string,
  column: string,
  type: string,
): IntrospectError {
  return new IntrospectError(
    'SF2003',
    `Unsupported column type "${type}" in ${table}.${column}`,
    [
      'Add a custom generator in .seedforge.yml:',
      `  tables:\n    ${table}:\n      columns:\n        ${column}:\n          generator: "faker.lorem.word"`,
    ],
    { table, column, type },
  )
}

export function circularDependency(tables: string[]): GenerationError {
  const cycle = tables.join(' -> ')
  return new GenerationError(
    'SF3001',
    `Unresolvable circular dependency: ${cycle}`,
    [
      'Make one FK column in the cycle nullable',
      'Or use deferred constraints in PostgreSQL',
    ],
    { tables },
  )
}

export function uniqueValueExhaustion(
  table: string,
  column: string,
  requested: number,
): GenerationError {
  return new GenerationError(
    'SF3002',
    `Unique value exhaustion for ${table}.${column}: requested ${requested} unique values`,
    [
      'Reduce row count for this table',
      'Or use a different generator with more distinct values',
    ],
    { table, column, requested },
  )
}
