import type { GenerationResult } from '../generate/types.js'
import type { DatabaseSchema } from '../types/schema.js'
import type { InsertPlan } from '../graph/types.js'
import type { OutputOptions, InsertionSummary } from './types.js'
import { OutputMode } from './types.js'
import { ProgressReporter } from './progress.js'
import { executeDirect } from './executors/direct.js'
import { executeFile } from './executors/file.js'
import { executeDryRun } from './executors/dry-run.js'
import { InsertionError } from '../errors/index.js'

/**
 * Main entry point for the output layer.
 *
 * Validates options, dispatches to the appropriate executor, and prints the summary.
 *
 * @param generationResult - Output from the data generation engine
 * @param schema - The database schema
 * @param plan - The insert plan with table ordering
 * @param options - Output configuration
 * @param version - Package version for file header
 * @returns Insertion summary
 */
export async function executeOutput(
  generationResult: GenerationResult,
  schema: DatabaseSchema,
  plan: InsertPlan,
  options: OutputOptions,
  version: string = '0.0.0',
): Promise<InsertionSummary> {
  // 1. Validate options
  if (options.mode === OutputMode.DIRECT && !options.client) {
    throw new InsertionError(
      'SF4006',
      'Direct insertion mode requires a database connection',
      [
        'Provide a connection string with --db <url>',
        'Or use --output <file> to write SQL to a file instead',
      ],
    )
  }

  if (options.mode === OutputMode.FILE && !options.filePath) {
    throw new InsertionError(
      'SF4007',
      'File output mode requires an output path',
      ['Specify output path with --output <file.sql>'],
    )
  }

  // Clamp batch size
  const warnings: string[] = []
  let batchSize = options.batchSize
  if (batchSize < 1) {
    batchSize = 1
    warnings.push('Batch size clamped to minimum of 1')
  } else if (batchSize > 10000) {
    batchSize = 10000
    warnings.push('Batch size clamped to maximum of 10000')
  }
  const clampedOptions = { ...options, batchSize }

  // 2. Create progress reporter
  const progress = new ProgressReporter({
    quiet: options.quiet,
    showProgress: options.showProgress,
  })

  // Print clamping warnings
  for (const w of warnings) {
    progress.printWarning(w)
  }

  // 3. Dispatch to executor
  let summary: InsertionSummary

  switch (options.mode) {
    case OutputMode.DIRECT:
      summary = await executeDirect(
        generationResult,
        schema,
        plan.ordered,
        clampedOptions,
        progress,
      )
      break
    case OutputMode.FILE:
      summary = await executeFile(
        generationResult,
        schema,
        plan.ordered,
        clampedOptions,
        progress,
        version,
      )
      break
    case OutputMode.DRY_RUN:
      summary = await executeDryRun(
        generationResult,
        schema,
        plan.ordered,
        clampedOptions,
        progress,
      )
      break
  }

  // Merge any clamping warnings
  summary.warnings.push(...warnings)

  // 4. Print summary (for non-dry-run modes; dry-run prints its own)
  if (options.mode !== OutputMode.DRY_RUN) {
    progress.printSummary(summary)
  }

  return summary
}

/**
 * Determine the output mode from CLI flags.
 *
 * Priority: --dry-run > --output > direct (default)
 */
export function resolveOutputMode(cliOptions: {
  dryRun: boolean
  output?: string
}): OutputMode {
  if (cliOptions.dryRun) {
    return OutputMode.DRY_RUN
  }
  if (cliOptions.output) {
    return OutputMode.FILE
  }
  return OutputMode.DIRECT
}
