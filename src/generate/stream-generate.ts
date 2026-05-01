/**
 * Streaming table row generator.
 *
 * Re-exported from generate-table.ts where the row-building logic is shared
 * between the array-collection and streaming entry points to guarantee parity.
 */
export { generateTableStream } from './generate-table.js'
export type {
  TableGenerationContext as StreamTableGenerationContext,
  TableStreamMeta as StreamTableGenerationMeta,
} from './generate-table.js'
