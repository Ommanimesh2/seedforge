import type { Faker } from '@faker-js/faker'
import type { ReferencePool } from './types.js'

/**
 * Manages FK reference pools per table.
 * Tracks available PK values that can be referenced by FK columns in dependent tables.
 * Seeds from existing data and grows as tables are generated.
 */
export class ReferencePoolManager {
  private pools: Map<string, ReferencePool> = new Map()

  /**
   * Initialize a pool from existing data (called before generation starts for each table).
   * If the pool already exists, merges new values.
   */
  initFromExisting(
    tableName: string,
    columns: string[],
    existingPKs: unknown[][],
  ): void {
    const existing = this.pools.get(tableName)
    if (existing) {
      existing.values.push(...existingPKs)
    } else {
      this.pools.set(tableName, {
        tableName,
        columns,
        values: [...existingPKs],
      })
    }
  }

  /**
   * Add newly generated PK values to the pool (called after each table's rows are generated).
   * If no pool exists, creates one with empty columns metadata.
   */
  addGenerated(tableName: string, newPKs: unknown[][]): void {
    const existing = this.pools.get(tableName)
    if (existing) {
      existing.values.push(...newPKs)
    } else {
      this.pools.set(tableName, {
        tableName,
        columns: [],
        values: [...newPKs],
      })
    }
  }

  /**
   * Pick a random FK reference tuple from the pool for a given referenced table.
   * Uses the provided faker instance for deterministic random selection.
   * Returns null if pool is empty.
   */
  pickReference(referencedTable: string, faker: Faker): unknown[] | null {
    const pool = this.pools.get(referencedTable)
    if (!pool || pool.values.length === 0) {
      return null
    }
    return faker.helpers.arrayElement(pool.values)
  }

  /**
   * Get the full pool for a table (for composite FK selection).
   */
  getPool(referencedTable: string): ReferencePool | null {
    return this.pools.get(referencedTable) ?? null
  }

  /**
   * Check if a pool exists and has values.
   */
  hasReferences(referencedTable: string): boolean {
    const pool = this.pools.get(referencedTable)
    return pool !== undefined && pool.values.length > 0
  }

  /**
   * Get pool size (for diagnostics).
   */
  poolSize(referencedTable: string): number {
    const pool = this.pools.get(referencedTable)
    return pool ? pool.values.length : 0
  }
}
