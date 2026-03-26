import type { GenerationConfig } from './types.js'

/**
 * Creates a GenerationConfig with defaults, merging any provided overrides.
 */
export function createGenerationConfig(
  overrides?: Partial<GenerationConfig>,
): GenerationConfig {
  const config: GenerationConfig = {
    globalRowCount: 50,
    tableRowCounts: new Map<string, number>(),
    nullableRate: 0.1,
    seed: undefined,
  }

  if (overrides) {
    if (overrides.globalRowCount !== undefined) {
      config.globalRowCount = overrides.globalRowCount
    }
    if (overrides.tableRowCounts !== undefined) {
      // Merge: copy overrides into the new map
      for (const [key, value] of overrides.tableRowCounts) {
        config.tableRowCounts.set(key, value)
      }
    }
    if (overrides.nullableRate !== undefined) {
      config.nullableRate = overrides.nullableRate
    }
    if (overrides.seed !== undefined) {
      config.seed = overrides.seed
    }
  }

  return config
}

/**
 * Returns the row count for a given table, using per-table override if present,
 * otherwise the global default.
 */
export function getRowCount(
  config: GenerationConfig,
  tableName: string,
): number {
  const perTable = config.tableRowCounts.get(tableName)
  const count = perTable !== undefined ? perTable : config.globalRowCount

  if (!Number.isInteger(count) || count < 1) {
    return 1
  }

  return count
}
