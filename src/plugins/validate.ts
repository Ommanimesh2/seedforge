/**
 * Plugin validation — ensures loaded objects conform to the required
 * SchemaParserPlugin or GeneratorPlugin interfaces before they are
 * registered.
 */

import { PluginError } from '../errors/index.js'
import type { SchemaParserPlugin, GeneratorPlugin, SeedforgePlugin } from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFunction(v: unknown): v is (...args: unknown[]) => unknown {
  return typeof v === 'function'
}

// ---------------------------------------------------------------------------
// Parser validation
// ---------------------------------------------------------------------------

/**
 * Validate that `candidate` implements the SchemaParserPlugin interface.
 *
 * @throws PluginError (SF6001) when validation fails.
 */
export function validateParserPlugin(candidate: unknown): asserts candidate is SchemaParserPlugin {
  if (candidate === null || typeof candidate !== 'object') {
    throw new PluginError(
      'SF6001',
      'Parser plugin must be a non-null object',
      ['Ensure your plugin module exports an object with name, version, detect, parse, and filePatterns'],
    )
  }

  const obj = candidate as Record<string, unknown>

  if (!isNonEmptyString(obj.name)) {
    throw new PluginError(
      'SF6001',
      'Parser plugin is missing a valid "name" string property',
      ['Add a name property to your plugin, e.g. name: "my-parser"'],
    )
  }

  if (!isNonEmptyString(obj.version)) {
    throw new PluginError(
      'SF6001',
      `Parser plugin "${obj.name}" is missing a valid "version" string property`,
      ['Add a version property to your plugin, e.g. version: "1.0.0"'],
    )
  }

  if (!isFunction(obj.detect)) {
    throw new PluginError(
      'SF6001',
      `Parser plugin "${obj.name}" is missing a "detect" function`,
      ['Add an async detect(projectRoot) method that returns a boolean'],
    )
  }

  if (!isFunction(obj.parse)) {
    throw new PluginError(
      'SF6001',
      `Parser plugin "${obj.name}" is missing a "parse" function`,
      ['Add an async parse(projectRoot, options?) method that returns DatabaseSchema'],
    )
  }

  if (!Array.isArray(obj.filePatterns)) {
    throw new PluginError(
      'SF6001',
      `Parser plugin "${obj.name}" is missing a "filePatterns" array`,
      ['Add a filePatterns property, e.g. filePatterns: ["**/*.prisma"]'],
    )
  }
}

// ---------------------------------------------------------------------------
// Generator validation
// ---------------------------------------------------------------------------

/**
 * Validate that `candidate` implements the GeneratorPlugin interface.
 *
 * @throws PluginError (SF6001) when validation fails.
 */
export function validateGeneratorPlugin(candidate: unknown): asserts candidate is GeneratorPlugin {
  if (candidate === null || typeof candidate !== 'object') {
    throw new PluginError(
      'SF6001',
      'Generator plugin must be a non-null object',
      ['Ensure your plugin module exports an object with name, version, columnPatterns, generate, and priority'],
    )
  }

  const obj = candidate as Record<string, unknown>

  if (!isNonEmptyString(obj.name)) {
    throw new PluginError(
      'SF6001',
      'Generator plugin is missing a valid "name" string property',
      ['Add a name property to your plugin, e.g. name: "my-generator"'],
    )
  }

  if (!isNonEmptyString(obj.version)) {
    throw new PluginError(
      'SF6001',
      `Generator plugin "${obj.name}" is missing a valid "version" string property`,
      ['Add a version property to your plugin, e.g. version: "1.0.0"'],
    )
  }

  if (!Array.isArray(obj.columnPatterns)) {
    throw new PluginError(
      'SF6001',
      `Generator plugin "${obj.name}" is missing a "columnPatterns" array`,
      ['Add a columnPatterns array with objects containing names/suffixes/prefixes'],
    )
  }

  if (!isFunction(obj.generate)) {
    throw new PluginError(
      'SF6001',
      `Generator plugin "${obj.name}" is missing a "generate" function`,
      ['Add a generate(column, faker, rowIndex) method that returns a value'],
    )
  }

  if (typeof obj.priority !== 'number' || !Number.isFinite(obj.priority)) {
    throw new PluginError(
      'SF6001',
      `Generator plugin "${obj.name}" is missing a valid numeric "priority" property`,
      ['Add a priority number, e.g. priority: 10 (higher overrides built-in generators)'],
    )
  }
}

// ---------------------------------------------------------------------------
// Wrapper plugin validation
// ---------------------------------------------------------------------------

/**
 * Validate a SeedforgePlugin wrapper object.
 *
 * @throws PluginError (SF6001) when validation fails.
 */
export function validatePlugin(candidate: unknown): asserts candidate is SeedforgePlugin {
  if (candidate === null || typeof candidate !== 'object') {
    throw new PluginError(
      'SF6001',
      'Plugin must be a non-null object with a "type" and "plugin" property',
      ['Export an object like { type: "parser", plugin: { ... } }'],
    )
  }

  const obj = candidate as Record<string, unknown>

  if (obj.type !== 'parser' && obj.type !== 'generator') {
    throw new PluginError(
      'SF6001',
      `Plugin "type" must be "parser" or "generator", got "${String(obj.type)}"`,
      ['Set type to either "parser" or "generator"'],
    )
  }

  if (obj.type === 'parser') {
    validateParserPlugin(obj.plugin)
  } else {
    validateGeneratorPlugin(obj.plugin)
  }
}
