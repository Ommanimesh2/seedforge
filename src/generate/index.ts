// Public API
export { generate } from './generate.js'
export { createGenerationConfig, getRowCount } from './config.js'

// Distributions
export {
  createDistribution,
  isValidDistributionType,
  type DistributionType,
  type DistributionOptions,
  type DistributionFn,
} from './distributions.js'

// Coherence
export {
  detectCoherenceGroups,
  generateCoherentRow,
  type CoherenceType,
  type CoherenceGroup,
} from './coherence.js'

// Scenarios
export {
  loadScenario,
  validateScenarios,
  type ScenarioDef,
  type SeedforgeConfigWithScenarios,
} from './scenarios.js'

// Schema diff
export {
  hashTableSchema,
  computeSchemaHashes,
  saveSchemaState,
  loadSchemaState,
  diffSchema,
  getTablesNeedingRegeneration,
  type SchemaState,
  type SchemaDiff,
} from './diff.js'

// Streaming generation
export { generateTableStream } from './stream-generate.js'
export type {
  StreamTableGenerationContext,
  StreamTableGenerationMeta,
} from './stream-generate.js'

// Types
export type {
  GenerationConfig,
  GenerationResult,
  TableGenerationResult,
  Row,
  DeferredUpdate,
  ExistingData,
  ReferencePool,
} from './types.js'
