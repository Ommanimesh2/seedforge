import type { Client } from 'pg'
import type { Connection as MysqlConnection } from 'mysql2/promise'
import type { SqliteDatabase } from '../introspect/sqlite/connection.js'
import type { DatabaseSchema } from '../types/schema.js'
import type { GenerationResult } from '../generate/types.js'
import type { InsertPlan } from '../graph/types.js'
import type { InsertionSummary } from '../output/types.js'

/**
 * A database connection abstraction used by the pipeline.
 */
export type PipelineConnection =
  | { type: 'pg'; client: Client }
  | { type: 'mysql'; connection: MysqlConnection }
  | { type: 'sqlite'; db: SqliteDatabase }
  | { type: 'none' }

/**
 * Options for runPipeline().
 */
export interface PipelineOptions {
  schema: DatabaseSchema
  connection: PipelineConnection
  count: number
  seed?: number
  dryRun?: boolean
  output?: string
  fast?: boolean
  batchSize?: number
  quiet?: boolean
  version?: string
  /** Per-table FK cardinality configurations */
  tableCardinalityConfigs?: Map<string, import('../generate/cardinality.js').TableCardinalityConfig>
}

/**
 * Result of a pipeline run.
 */
export interface PipelineResult {
  generationResult: GenerationResult
  summary: InsertionSummary
  plan: InsertPlan
  schema: DatabaseSchema
}
