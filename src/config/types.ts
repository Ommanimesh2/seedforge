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
  distribution?: string
}

export interface RelationshipConfig {
  /** Cardinality range ("1..10") or discrete values ([1, 3, 5]) */
  cardinality: string | number[]
  /** Distribution for range-based cardinality (default: 'uniform') */
  distribution?: 'uniform' | 'zipf' | 'normal'
  /** Weights for discrete cardinality values (parallel to cardinality array) */
  weights?: number[]
}

export interface TableConfig {
  count?: number
  columns?: Record<string, ColumnOverride>
  /** FK column relationship cardinality configurations */
  relationships?: Record<string, RelationshipConfig>
}

export interface VirtualForeignKey {
  source: { table: string; column: string }
  target: { table: string; column: string }
}

export interface ConnectionConfig {
  url?: string
  schema?: string
}

export interface ScenarioTableConfig {
  count: number
}

export interface ScenarioDef {
  tables: Record<string, ScenarioTableConfig>
}

export interface AIConfigYaml {
  enabled?: boolean
  provider?: 'openai' | 'anthropic' | 'ollama' | 'groq'
  model?: string
  baseUrl?: string
  apiKey?: string
  columns?: string[]
  temperature?: number
  maxTokensPerField?: number
  batchSize?: number
  cache?: boolean
  prompt?: string
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
  scenarios?: Record<string, ScenarioDef>
  ai?: AIConfigYaml
}

export interface CliOverrides {
  db?: string
  count?: number
  seed?: number
  schema?: string
  exclude?: string[]
  dryRun?: boolean
  output?: string
  scenario?: string
  diff?: boolean
}

export interface LoadConfigOptions {
  configPath?: string
  cwd?: string
}
