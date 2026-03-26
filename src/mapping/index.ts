// Types
export {
  ConfidenceLevel,
  MappingSource,
  type GeneratorFn,
  type ColumnMapping,
  type MappingResult,
  type PatternEntry,
} from './types.js'

// Normalizer
export { normalizeColumnName, singularize } from './normalize.js'

// Registry
export { buildRegistry } from './registry.js'

// Mapper (core API)
export { mapColumn, mapTable } from './mapper.js'

// Seeded faker
export { createSeededFaker } from './seeded-faker.js'

// Safe email
export { createSafeEmailGenerator } from './safe-email.js'

// Constraint handlers
export { handleEnumValues, handleCheckConstraint } from './constraint-handlers.js'

// Type fallback
export { getTypeFallback } from './type-fallback.js'
