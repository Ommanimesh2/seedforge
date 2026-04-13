// Tier 1: One-liner
export { seed } from './seed.js'

// Browser-safe pure generator (also re-exported from '@otg-dev/seedforge/browser')
export { generateFromSchema } from '../generate/generate-from-schema.js'

// Tier 2: Seeder instance
export { createSeeder, Seeder } from './seeder.js'

// Tier 3: Fluent builder
export { TableChain } from './builder.js'

// Tier 4: Test helpers
export { withSeed } from './helpers.js'

// Types (Row is exported from generate/types.js via the main index)
export type {
  SeedOptions,
  SeedConfigOptions,
  SeedResult,
  SeederOptions,
  TableSeedOptions,
  SeedColumnOverride,
  RelationshipSeedOverride,
  WithSeedOptions,
} from './types.js'
