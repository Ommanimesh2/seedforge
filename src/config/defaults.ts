import { ExistingDataMode } from './types.js'
import type { SeedforgeConfig } from './types.js'

/**
 * Creates a SeedforgeConfig with all defaults populated.
 * This is the single source of truth for default values.
 */
export function createDefaultConfig(): SeedforgeConfig {
  return {
    connection: { url: undefined, schema: 'public' },
    seed: undefined,
    count: 50,
    locale: 'en',
    existingData: ExistingDataMode.AUGMENT,
    tables: {},
    exclude: [],
    virtualForeignKeys: [],
  }
}
