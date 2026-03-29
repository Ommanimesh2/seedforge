/**
 * Plugin Registry — holds loaded plugins and provides lookup methods.
 */

import type { ColumnDef } from '../types/schema.js'
import type {
  SchemaParserPlugin,
  GeneratorPlugin,
  SeedforgePlugin,
} from './types.js'
import { validateParserPlugin, validateGeneratorPlugin } from './validate.js'

export class PluginRegistry {
  private readonly parsers = new Map<string, SchemaParserPlugin>()
  /** Generators stored in priority-descending order */
  private generators: GeneratorPlugin[] = []

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a single plugin (parser or generator).
   * Validates the plugin before registering.
   */
  register(entry: SeedforgePlugin): void {
    if (entry.type === 'parser') {
      validateParserPlugin(entry.plugin)
      this.parsers.set(entry.plugin.name, entry.plugin)
    } else {
      validateGeneratorPlugin(entry.plugin)
      this.generators.push(entry.plugin)
      // Re-sort by priority descending so highest-priority generators come first
      this.generators.sort((a, b) => b.priority - a.priority)
    }
  }

  /**
   * Register a batch of plugins.
   */
  registerAll(entries: SeedforgePlugin[]): void {
    for (const entry of entries) {
      this.register(entry)
    }
  }

  // -------------------------------------------------------------------------
  // Parser lookups
  // -------------------------------------------------------------------------

  /**
   * Get a specific parser plugin by name.
   */
  getParser(name: string): SchemaParserPlugin | undefined {
    return this.parsers.get(name)
  }

  /**
   * Get all registered parser plugins.
   */
  getAllParsers(): SchemaParserPlugin[] {
    return Array.from(this.parsers.values())
  }

  /**
   * Auto-detect which parser plugin can handle the given project root.
   * Calls `detect()` on each registered parser and returns the first
   * one that responds `true`.
   *
   * Returns `undefined` if no parser matches.
   */
  async detectParser(projectRoot: string): Promise<SchemaParserPlugin | undefined> {
    for (const parser of this.parsers.values()) {
      const canHandle = await parser.detect(projectRoot)
      if (canHandle) {
        return parser
      }
    }
    return undefined
  }

  // -------------------------------------------------------------------------
  // Generator lookups
  // -------------------------------------------------------------------------

  /**
   * Get all generator plugins, sorted by priority (highest first).
   */
  getGenerators(): GeneratorPlugin[] {
    return [...this.generators]
  }

  /**
   * Check if any generator plugin wants to handle the given column.
   * If a matching generator is found, returns a partial ColumnMapping
   * override; otherwise returns `undefined`.
   *
   * Generators are checked in priority order (highest first).
   */
  applyGeneratorPlugins(
    column: ColumnDef,
  ): GeneratorPlugin | undefined {
    const colNameLower = column.name.toLowerCase()

    for (const gen of this.generators) {
      if (matchesColumnPatterns(colNameLower, gen.columnPatterns)) {
        return gen
      }
    }

    return undefined
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Number of registered parser plugins. */
  get parserCount(): number {
    return this.parsers.size
  }

  /** Number of registered generator plugins. */
  get generatorCount(): number {
    return this.generators.length
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

import type { GeneratorColumnPattern } from './types.js'

function matchesColumnPatterns(
  colNameLower: string,
  patterns: GeneratorColumnPattern[],
): boolean {
  for (const pattern of patterns) {
    // Check exact names
    if (pattern.names) {
      for (const name of pattern.names) {
        if (colNameLower === name.toLowerCase()) return true
      }
    }

    // Check suffixes
    if (pattern.suffixes) {
      for (const suffix of pattern.suffixes) {
        if (colNameLower.endsWith(suffix.toLowerCase())) return true
      }
    }

    // Check prefixes
    if (pattern.prefixes) {
      for (const prefix of pattern.prefixes) {
        if (colNameLower.startsWith(prefix.toLowerCase())) return true
      }
    }
  }

  return false
}
