/**
 * Plugin system type definitions for SeedForge.
 *
 * These interfaces allow community authors to build parser and generator
 * plugins that extend SeedForge without modifying the core codebase.
 */

import type { Faker } from '@faker-js/faker'
import type { DatabaseSchema, ColumnDef } from '../types/schema.js'

// ---------------------------------------------------------------------------
// Schema Parser Plugin
// ---------------------------------------------------------------------------

/**
 * A plugin that can parse a project's schema files and produce a
 * DatabaseSchema. This is the extension point for adding support for
 * new ORMs, migration tools, or custom schema formats.
 */
export interface SchemaParserPlugin {
  /** Human-readable name, e.g. "seedforge-plugin-sequelize" */
  name: string
  /** SemVer version string */
  version: string
  /**
   * Probe whether this plugin can handle the given project.
   * Typically checks for config files, dependency entries, etc.
   */
  detect(projectRoot: string): Promise<boolean>
  /**
   * Parse schema files rooted at `projectRoot` and return a
   * normalised DatabaseSchema.
   */
  parse(
    projectRoot: string,
    options?: Record<string, unknown>,
  ): Promise<DatabaseSchema>
  /** Glob patterns for files this parser cares about (e.g. ["**\/*.prisma"]) */
  filePatterns: string[]
}

// ---------------------------------------------------------------------------
// Generator Plugin
// ---------------------------------------------------------------------------

/** Column name/suffix/prefix pattern specification for generator plugins. */
export interface GeneratorColumnPattern {
  /** Exact column names to match (case-insensitive) */
  names?: string[]
  /** Column name suffixes to match (case-insensitive) */
  suffixes?: string[]
  /** Column name prefixes to match (case-insensitive) */
  prefixes?: string[]
}

/**
 * A plugin that provides custom value generators for specific column
 * patterns. Generator plugins can override the built-in mapping logic
 * for columns they recognise.
 */
export interface GeneratorPlugin {
  /** Human-readable name */
  name: string
  /** SemVer version string */
  version: string
  /** Column patterns this generator handles */
  columnPatterns: GeneratorColumnPattern[]
  /**
   * Generate a value for the given column.
   * @param column   The column definition from the schema
   * @param faker    A Faker instance (seeded)
   * @param rowIndex 0-based row index within the batch
   */
  generate(column: ColumnDef, faker: Faker, rowIndex: number): unknown
  /**
   * Priority — higher values override lower-priority generators and
   * built-in mappings. Built-in generators have priority 0.
   */
  priority: number
}

// ---------------------------------------------------------------------------
// Wrapper type
// ---------------------------------------------------------------------------

/**
 * Discriminated union that wraps either a parser or a generator plugin
 * so the loader can handle both with a single list.
 */
export type SeedforgePlugin =
  | { type: 'parser'; plugin: SchemaParserPlugin }
  | { type: 'generator'; plugin: GeneratorPlugin }
