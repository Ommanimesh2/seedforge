// Public API
export { generate } from './generate.js'
export { createGenerationConfig, getRowCount } from './config.js'

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
