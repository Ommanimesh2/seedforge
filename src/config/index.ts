// Types
export {
  ExistingDataMode,
  type ColumnOverride,
  type TableConfig,
  type VirtualForeignKey,
  type ConnectionConfig,
  type SeedforgeConfig,
  type CliOverrides,
  type LoadConfigOptions,
} from './types.js'

// Defaults
export { createDefaultConfig } from './defaults.js'

// Env interpolation
export { interpolateEnvVars, interpolateDeep } from './env.js'

// Table exclusion
export { isTableExcluded, filterExcludedTables } from './exclude.js'

// Loader
export {
  findConfigFile,
  loadConfigFile,
  loadConfig,
  loadAndMergeConfig,
} from './loader.js'

// Validation
export { validateConfig } from './validate.js'

// Merge
export { mergeCliIntoConfig } from './merge.js'

// Virtual FKs
export { injectVirtualForeignKeys } from './virtual-fk.js'

// Generator resolution
export { resolveGenerator, resolveColumnOverrides } from './generator-resolver.js'

// Levenshtein (internal, but exported for testing)
export { levenshtein, suggestKey } from './levenshtein.js'
