import type { TableSeedOptions, Row } from './types.js'
import type { Seeder } from './seeder.js'

interface TableEntry {
  tableName: string
  count: number
  options?: TableSeedOptions
}

/**
 * A fluent builder for chaining multi-table seed operations.
 *
 * Tables are seeded in the order they are chained. For automatic
 * FK resolution, chain parent tables before child tables.
 *
 * @example
 * const result = await seeder
 *   .table('users', 5)
 *   .table('categories', 3)
 *   .table('posts', 20)
 *   .table('comments', 50)
 *   .execute()
 *
 * // result.users = [{ id: 1, ... }, ...]
 * // result.posts = [{ id: 1, author_id: 1, ... }, ...]
 */
export class TableChain {
  private _seeder: Seeder
  private _entries: TableEntry[] = []

  constructor(seeder: Seeder) {
    this._seeder = seeder
  }

  /**
   * Add a table to the seed chain.
   *
   * @param tableName - The table to seed
   * @param count - Number of rows to generate
   * @param options - Per-table column overrides
   */
  table(tableName: string, count: number, options?: TableSeedOptions): this {
    this._entries.push({ tableName, count, options })
    return this
  }

  /**
   * Execute all chained table seeds and return the results.
   *
   * Tables are seeded in chain order. Each table's generated rows
   * are inserted before the next table is generated, so FK references
   * to earlier tables are automatically resolved.
   *
   * @returns An object keyed by table name containing the generated rows
   */
  async execute(): Promise<Record<string, Row[]>> {
    const results: Record<string, Row[]> = {}

    for (const entry of this._entries) {
      const rows = await this._seeder.seed(
        entry.tableName,
        entry.count,
        entry.options,
      )
      results[entry.tableName] = rows
    }

    return results
  }
}
