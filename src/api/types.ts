import type { InsertionSummary } from '../output/types.js'
import type { Row } from '../generate/types.js'

// Re-export Row from the generation engine so API modules can import it from here
export type { Row }

/**
 * Options for the seed() one-liner function.
 */
export interface SeedOptions {
  /** Rows per table (default: 50) */
  count?: number
  /** PRNG seed for deterministic output */
  seed?: number
  /** Tables to exclude from seeding */
  exclude?: string[]
  /** Database schema to introspect (default: 'public') */
  schema?: string
  /** Generate SQL without executing */
  dryRun?: boolean
  /** Write SQL to a file instead of executing */
  output?: string
  /** Use COPY-based insertion for PostgreSQL (faster for large datasets) */
  fast?: boolean
  /** Rows per INSERT statement (default: 500) */
  batchSize?: number
  /** Suppress console output */
  quiet?: boolean
  /** Skip production safety prompts */
  skipProductionCheck?: boolean

  // Parser-based seeding (no live DB connection needed for generation)
  /** Path to Prisma schema file */
  prisma?: string
  /** Path to Drizzle schema file or directory */
  drizzle?: string
  /** Path to JPA entity classes directory */
  jpa?: string
  /** Path to TypeORM entity classes directory */
  typeorm?: string

  /** AI text generation config (opt-in) */
  ai?: import('../ai/types.js').AIConfig
}

/**
 * Options for seed() when called with a config object instead of a URL.
 */
export type SeedConfigOptions = SeedOptions & {
  /** Database connection URL (required when not using a parser) */
  db?: string
}

/**
 * Result of a seed() call.
 */
export interface SeedResult {
  /** Generated rows per table, keyed by table name */
  tables: Map<string, Row[]>
  /** Total rows generated across all tables */
  rowCount: number
  /** Execution time in milliseconds */
  duration: number
  /** Generated SQL (only available when dryRun is true) */
  sql?: string
  /** Detailed insertion summary */
  summary: InsertionSummary
}

/**
 * Options for createSeeder().
 */
export interface SeederOptions {
  /** PRNG seed for deterministic output */
  seed?: number
  /** Wrap all operations in a transaction (enables teardown/rollback) */
  transaction?: boolean
  /** Database schema to introspect (default: 'public') */
  schema?: string
  /** Suppress console output */
  quiet?: boolean
  /** Skip production safety prompts */
  skipProductionCheck?: boolean
  /** Rows per INSERT statement (default: 500) */
  batchSize?: number
}

/**
 * Per-table overrides for seeder.seed() calls.
 */
export interface TableSeedOptions {
  /** Column-level overrides */
  columns?: Record<string, SeedColumnOverride>
  /** FK relationship cardinality overrides */
  relationship?: Record<string, RelationshipSeedOverride>
}

/**
 * Cardinality override for a single FK column.
 */
export interface RelationshipSeedOverride {
  /** Cardinality specification: min/max range with optional distribution */
  cardinality?: {
    min: number
    max: number
    distribution?: 'uniform' | 'zipf' | 'normal'
  }
}

/**
 * Override generation for a specific column.
 */
export interface SeedColumnOverride {
  /** Fixed values to cycle through */
  values?: unknown[]
  /** Weights for value selection (parallel to values array) */
  weights?: number[]
}

/**
 * Options for withSeed() test helper.
 */
export interface WithSeedOptions {
  /** PRNG seed for deterministic output */
  seed?: number
  /** Wrap operations in a transaction for automatic cleanup */
  transaction?: boolean
  /** Database schema to introspect (default: 'public') */
  schema?: string
  /** Suppress console output */
  quiet?: boolean
}
