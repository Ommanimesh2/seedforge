/**
 * Core data structures produced by the data generation engine.
 */

/**
 * Configuration for the data generation engine.
 */
export interface GenerationConfig {
  /** Default rows per table (default: 50) */
  globalRowCount: number
  /** Per-table row count overrides (key: qualified table name) */
  tableRowCounts: Map<string, number>
  /** Probability [0..1] that a nullable column receives NULL (default: 0.1) */
  nullableRate: number
  /** Seed for deterministic generation (passed to createSeededFaker) */
  seed?: number
  /**
   * Per-table FK cardinality configuration.
   * Key1: qualified table name (e.g., "public.orders")
   * Key2: FK column name (e.g., "user_id")
   */
  tableCardinalityConfigs?: Map<string, import('./cardinality.js').TableCardinalityConfig>
}

/**
 * A single generated row keyed by column name.
 */
export type Row = Record<string, unknown>

/**
 * A deferred UPDATE operation for self-ref or cycle-broken FK columns.
 */
export interface DeferredUpdate {
  /** Qualified table name */
  tableName: string
  /** PK column names used to identify the row */
  pkColumns: string[]
  /** PK values for this specific row */
  pkValues: unknown[]
  /** Columns to UPDATE (the self-ref/cycle-broken FK columns) */
  setColumns: string[]
  /** The FK values to set */
  setValues: unknown[]
}

/**
 * Result of generating rows for a single table.
 */
export interface TableGenerationResult {
  /** Qualified table name */
  tableName: string
  /** Generated rows (with NULLs for deferred FK columns) */
  rows: Row[]
  /** PK values extracted from generated rows (array of tuples for composite PKs) */
  generatedPKs: unknown[][]
}

/**
 * Full result of the generation pipeline.
 */
export interface GenerationResult {
  /** Generated rows per table, keyed by qualified table name, insertion-ordered */
  tables: Map<string, TableGenerationResult>
  /** All deferred UPDATEs for self-ref and cycle-broken edges */
  deferredUpdates: DeferredUpdate[]
  /** Warnings collected during generation */
  warnings: string[]
}

/**
 * Existing data queried from the live database for a table.
 */
export interface ExistingData {
  /** Number of existing rows */
  rowCount: number
  /** Sampled existing PK values (tuples for composite PKs) */
  existingPKs: unknown[][]
  /** Column name -> set of existing values for unique columns */
  existingUniqueValues: Map<string, Set<string>>
  /** Sequence name -> current value (for serial/identity columns) */
  sequenceValues: Map<string, number>
}

/**
 * A reference pool for FK lookups.
 */
export interface ReferencePool {
  /** The referenced table */
  tableName: string
  /** The referenced columns (PK or unique columns) */
  columns: string[]
  /** Available tuples to pick from (existing + newly generated) */
  values: unknown[][]
}
