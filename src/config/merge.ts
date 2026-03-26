import type { SeedforgeConfig, CliOverrides } from './types.js'

/**
 * Merges CLI overrides into a validated SeedforgeConfig.
 * CLI flags take precedence over config file values.
 * Returns a new config object (does not mutate the input).
 */
export function mergeCliIntoConfig(
  config: SeedforgeConfig,
  cli: CliOverrides,
): SeedforgeConfig {
  const merged: SeedforgeConfig = {
    ...config,
    connection: { ...config.connection },
    tables: { ...config.tables },
    exclude: [...config.exclude],
    virtualForeignKeys: [...config.virtualForeignKeys],
  }

  // connection.url
  if (cli.db !== undefined) {
    merged.connection.url = cli.db
  }

  // connection.schema
  if (cli.schema !== undefined) {
    merged.connection.schema = cli.schema
  }

  // count
  if (cli.count !== undefined) {
    merged.count = cli.count
  }

  // seed
  if (cli.seed !== undefined) {
    merged.seed = cli.seed
  }

  // exclude: append and deduplicate
  if (cli.exclude !== undefined && cli.exclude.length > 0) {
    const existing = new Set(merged.exclude)
    for (const pattern of cli.exclude) {
      if (!existing.has(pattern)) {
        merged.exclude.push(pattern)
        existing.add(pattern)
      }
    }
  }

  return merged
}
