/**
 * Browser-safe entry point for @otg-dev/seedforge.
 *
 * This module re-exports only the pure, browser-safe surface of seedforge:
 * the row generation engine, the mapping layer, and the error/type
 * definitions. It deliberately does NOT re-export anything that pulls in
 * `pg`, `mysql2`, `better-sqlite3`, `pg-copy-streams`, `pg-format`,
 * `commander`, or any Node built-in, so it can be bundled with tools like
 * Vite/Webpack/Rolldown for use in the browser (e.g. an interactive docs
 * playground powered by sql.js).
 *
 * If you need the full Node-side API (live DB introspection, CLI helpers,
 * file output, etc.), import from the root `@otg-dev/seedforge` instead.
 */

// ─── Core generator ───────────────────────────────────────────────────────
export { generateFromSchema } from './generate/generate-from-schema.js'

// ─── Mapping helpers (pure — faker only) ─────────────────────────────────
export { mapTable, mapColumn } from './mapping/mapper.js'
export { createSeededFaker } from './mapping/seeded-faker.js'

// ─── Types ───────────────────────────────────────────────────────────────
export {
  NormalizedType,
  FKAction,
  type ColumnDef,
  type PrimaryKeyDef,
  type ForeignKeyDef,
  type UniqueConstraintDef,
  type CheckConstraintDef,
  type IndexDef,
  type TableDef,
  type EnumDef,
  type DatabaseSchema,
} from './types/schema.js'

export type {
  GenerationConfig,
  GenerationResult,
  TableGenerationResult,
  Row,
  DeferredUpdate,
  ExistingData,
  ReferencePool,
} from './generate/types.js'

// ─── Errors (pure classes and factories) ─────────────────────────────────
export {
  SeedForgeError,
  GenerationError,
  ConfigError,
  circularDependency,
  uniqueValueExhaustion,
  fkReferencePoolEmpty,
  generationFailure,
} from './errors/index.js'
