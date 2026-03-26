import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'yaml'
import { ConfigError } from '../errors/index.js'
import { interpolateDeep } from './env.js'
import { validateConfig } from './validate.js'
import { createDefaultConfig } from './defaults.js'
import { mergeCliIntoConfig } from './merge.js'
import type { SeedforgeConfig, CliOverrides, LoadConfigOptions } from './types.js'

const CONFIG_FILENAMES = ['.seedforge.yml', '.seedforge.yaml']

/**
 * Discovers a .seedforge.yml or .seedforge.yaml config file by walking
 * up from startDir to the filesystem root.
 * Returns the absolute path if found, or null.
 */
export function findConfigFile(startDir?: string): string | null {
  let dir = path.resolve(startDir ?? process.cwd())

  for (;;) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      // Reached filesystem root
      return null
    }
    dir = parent
  }
}

/**
 * Loads and parses a YAML config file, applying env var interpolation.
 * Returns the raw parsed object (not yet validated).
 */
export function loadConfigFile(
  filePath: string,
): Record<string, unknown> {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new ConfigError(
      'SF5001',
      `Cannot read config file: ${filePath}`,
      ['Check that the file exists and is readable'],
      { filePath, error: (err as Error).message },
    )
  }

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (err) {
    const yamlErr = err as Error & { linePos?: Array<{ line: number }> }
    throw new ConfigError(
      'SF5001',
      `Invalid YAML syntax in ${filePath}: ${yamlErr.message}`,
      [
        'Check YAML syntax — common issues: incorrect indentation, tabs instead of spaces',
      ],
      { filePath, line: yamlErr.linePos?.[0]?.line },
    )
  }

  // Empty file or null/undefined YAML
  if (parsed == null) {
    return {}
  }

  // Root must be a plain object
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(
      'SF5002',
      'Config file must contain a YAML mapping (object) at the top level',
      [
        'The config file should start with key-value pairs, not a list or scalar',
      ],
      { filePath },
    )
  }

  // Apply env var interpolation
  const interpolated = interpolateDeep(parsed) as Record<string, unknown>

  return interpolated
}

/**
 * Loads a config file (discovered or explicit), validates it, and returns
 * a typed SeedforgeConfig.
 */
export function loadConfig(options?: LoadConfigOptions): SeedforgeConfig {
  const filePath = options?.configPath
    ? path.resolve(options.configPath)
    : findConfigFile(options?.cwd)

  if (!filePath) {
    return createDefaultConfig()
  }

  const raw = loadConfigFile(filePath)
  return validateConfig(raw)
}

/**
 * Full config pipeline: load config file, validate, then merge CLI overrides.
 */
export function loadAndMergeConfig(
  cliOptions: CliOverrides,
  loadOptions?: LoadConfigOptions,
): SeedforgeConfig {
  const config = loadConfig(loadOptions)
  return mergeCliIntoConfig(config, cliOptions)
}
