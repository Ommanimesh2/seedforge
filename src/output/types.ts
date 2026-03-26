import type { Client } from 'pg'

/**
 * Output mode determines how generated data is delivered.
 */
export enum OutputMode {
  /** Insert into database via pg client */
  DIRECT = 'DIRECT',
  /** Write SQL file to disk */
  FILE = 'FILE',
  /** Preview mode: generate SQL, print summary, do not execute */
  DRY_RUN = 'DRY_RUN',
}

/**
 * Configuration for the output layer.
 */
export interface OutputOptions {
  /** Which output mode to use */
  mode: OutputMode
  /** pg.Client for DIRECT mode */
  client?: Client
  /** File path for FILE mode */
  filePath?: string
  /** Rows per INSERT statement (default: 500) */
  batchSize: number
  /** Whether to show per-table progress (default: true) */
  showProgress: boolean
  /** Suppress all non-essential output (default: false) */
  quiet: boolean
}

/**
 * A single batch of INSERT statements ready to execute.
 */
export interface InsertBatch {
  /** Table name */
  tableName: string
  /** Schema name */
  schemaName: string
  /** Ordered column names */
  columns: string[]
  /** Array of row value arrays (parallel to columns) */
  rows: unknown[][]
  /** The formatted INSERT SQL */
  sql: string
}

/**
 * Information about a sequence that needs to be reset after seeding.
 */
export interface SequenceResetInfo {
  /** Table name */
  tableName: string
  /** Schema name */
  schemaName: string
  /** The serial/identity column name */
  columnName: string
  /** The PostgreSQL sequence name */
  sequenceName: string
}

/**
 * Summary of the output/insertion operation.
 */
export interface InsertionSummary {
  /** Number of tables seeded */
  tablesSeeded: number
  /** Total rows inserted across all tables */
  totalRowsInserted: number
  /** Breakdown of rows per table */
  rowsPerTable: Map<string, number>
  /** Number of deferred UPDATE statements applied */
  deferredUpdatesApplied: number
  /** Number of sequences reset */
  sequencesReset: number
  /** Time elapsed in milliseconds */
  elapsedMs: number
  /** Warnings collected during output */
  warnings: string[]
  /** Which output mode was used */
  mode: OutputMode
}
