export enum ExistingDataMode {
  AUGMENT = 'AUGMENT',
  TRUNCATE = 'TRUNCATE',
  ERROR = 'ERROR',
}

export interface ColumnOverride {
  generator?: string
  unique?: boolean
  nullable?: number
  values?: unknown[]
  weights?: number[]
}

export interface TableConfig {
  count?: number
  columns?: Record<string, ColumnOverride>
}

export interface VirtualForeignKey {
  source: { table: string; column: string }
  target: { table: string; column: string }
}

export interface ConnectionConfig {
  url?: string
  schema?: string
}

export interface SeedforgeConfig {
  connection: ConnectionConfig
  seed?: number
  count: number
  locale: string
  existingData: ExistingDataMode
  tables: Record<string, TableConfig>
  exclude: string[]
  virtualForeignKeys: VirtualForeignKey[]
}

export interface CliOverrides {
  db?: string
  count?: number
  seed?: number
  schema?: string
  exclude?: string[]
  dryRun?: boolean
  output?: string
}

export interface LoadConfigOptions {
  configPath?: string
  cwd?: string
}
