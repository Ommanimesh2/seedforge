/**
 * Plugin Loader — discovers and loads plugins from multiple sources:
 *
 * 1. Explicit paths/package names in config
 * 2. Auto-detect npm packages matching `seedforge-plugin-*` in node_modules
 * 3. Local file paths relative to project root
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginError } from '../errors/index.js'
import { validatePlugin } from './validate.js'
import type { SeedforgePlugin } from './types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadPluginsOptions {
  /** Explicit plugin specifiers from config or CLI (package names or file paths) */
  plugins?: string[]
  /** Project root directory (for resolving relative paths and scanning node_modules) */
  projectRoot?: string
  /** Whether to auto-detect seedforge-plugin-* packages in node_modules */
  autoDetect?: boolean
}

/**
 * Discover, load, and validate all plugins.
 *
 * @returns Array of validated SeedforgePlugin objects
 */
export async function loadPlugins(
  options: LoadPluginsOptions = {},
): Promise<SeedforgePlugin[]> {
  const projectRoot = options.projectRoot ?? process.cwd()
  const autoDetect = options.autoDetect ?? true
  const results: SeedforgePlugin[] = []

  // 1. Load explicit plugins from config/CLI
  if (options.plugins && options.plugins.length > 0) {
    for (const specifier of options.plugins) {
      const plugin = await loadSinglePlugin(specifier, projectRoot)
      results.push(plugin)
    }
  }

  // 2. Auto-detect npm packages matching seedforge-plugin-*
  if (autoDetect) {
    const autoDetected = discoverPluginPackages(projectRoot)
    for (const pkgName of autoDetected) {
      // Skip if already loaded explicitly
      const alreadyLoaded = results.some((r) => {
        return r.plugin.name === pkgName
      })
      if (alreadyLoaded) continue

      try {
        const plugin = await loadSinglePlugin(pkgName, projectRoot)
        results.push(plugin)
      } catch {
        // Auto-detected packages that fail to load are silently ignored
        // (they may be unrelated packages that happen to match the naming convention)
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Single-plugin loading
// ---------------------------------------------------------------------------

/**
 * Load a single plugin from a specifier (npm package name or file path).
 *
 * @throws PluginError on load or validation failure
 */
export async function loadSinglePlugin(
  specifier: string,
  projectRoot: string,
): Promise<SeedforgePlugin> {
  let mod: unknown

  // Determine if specifier is a relative/absolute file path or a package name
  const isPath = specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.endsWith('.ts') ||
    specifier.endsWith('.js')

  if (isPath) {
    const absolutePath = isAbsolute(specifier)
      ? specifier
      : resolve(projectRoot, specifier)

    if (!existsSync(absolutePath)) {
      throw new PluginError(
        'SF6001',
        `Plugin file not found: ${absolutePath}`,
        [
          'Check the file path in your .seedforge.yml plugins array',
          `Resolved from project root: ${projectRoot}`,
        ],
        { specifier, absolutePath },
      )
    }

    try {
      const fileUrl = pathToFileURL(absolutePath).href
      mod = await import(fileUrl)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new PluginError(
        'SF6001',
        `Failed to import plugin file: ${absolutePath}`,
        [
          'Ensure the file is a valid ES module',
          'Check for syntax errors in the plugin',
        ],
        { specifier, absolutePath, detail },
      )
    }
  } else {
    // Treat as npm package name
    try {
      mod = await import(specifier)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new PluginError(
        'SF6001',
        `Failed to import plugin package: ${specifier}`,
        [
          `Run: npm install ${specifier}`,
          'Check the package name is correct',
        ],
        { specifier, detail },
      )
    }
  }

  // Extract the plugin object from the module
  const pluginObj = extractPluginExport(mod, specifier)
  validatePlugin(pluginObj)
  return pluginObj as SeedforgePlugin
}

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

/**
 * Scan node_modules for packages matching `seedforge-plugin-*`.
 * Returns an array of package names.
 */
export function discoverPluginPackages(projectRoot: string): string[] {
  const nodeModulesDir = join(projectRoot, 'node_modules')
  if (!existsSync(nodeModulesDir)) return []

  const results: string[] = []

  try {
    const entries = readdirSync(nodeModulesDir)

    for (const entry of entries) {
      if (entry.startsWith('seedforge-plugin-')) {
        results.push(entry)
      }

      // Also check scoped packages: @scope/seedforge-plugin-*
      if (entry.startsWith('@')) {
        const scopeDir = join(nodeModulesDir, entry)
        try {
          const scopeEntries = readdirSync(scopeDir)
          for (const scopeEntry of scopeEntries) {
            if (scopeEntry.startsWith('seedforge-plugin-')) {
              results.push(`${entry}/${scopeEntry}`)
            }
          }
        } catch {
          // Ignore unreadable scope directories
        }
      }
    }
  } catch {
    // node_modules unreadable — no auto-detection
  }

  return results
}

// ---------------------------------------------------------------------------
// Module export extraction
// ---------------------------------------------------------------------------

/**
 * Try to extract a SeedforgePlugin from a module's exports.
 * Looks for:
 * 1. Default export that is a SeedforgePlugin
 * 2. Named export `plugin`
 * 3. The module itself if it looks like a SeedforgePlugin
 */
function extractPluginExport(mod: unknown, specifier: string): unknown {
  if (mod === null || typeof mod !== 'object') {
    throw new PluginError(
      'SF6001',
      `Plugin "${specifier}" did not export an object`,
      ['Plugin modules must export a SeedforgePlugin object'],
    )
  }

  const moduleObj = mod as Record<string, unknown>

  // 1. Default export
  if (moduleObj.default !== undefined && typeof moduleObj.default === 'object' && moduleObj.default !== null) {
    const defaultExport = moduleObj.default as Record<string, unknown>
    if (defaultExport.type === 'parser' || defaultExport.type === 'generator') {
      return defaultExport
    }
  }

  // 2. Named export `plugin`
  if (moduleObj.plugin !== undefined && typeof moduleObj.plugin === 'object' && moduleObj.plugin !== null) {
    const pluginExport = moduleObj.plugin as Record<string, unknown>
    if (pluginExport.type === 'parser' || pluginExport.type === 'generator') {
      return pluginExport
    }
  }

  // 3. Module itself
  if (moduleObj.type === 'parser' || moduleObj.type === 'generator') {
    return moduleObj
  }

  throw new PluginError(
    'SF6001',
    `Plugin "${specifier}" does not export a valid SeedforgePlugin`,
    [
      'Export a default or named "plugin" export with { type: "parser" | "generator", plugin: { ... } }',
      'Or export the SeedforgePlugin object directly',
    ],
    { specifier },
  )
}
