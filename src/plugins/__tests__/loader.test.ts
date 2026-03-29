import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadSinglePlugin, discoverPluginPackages, loadPlugins } from '../loader.js'
import { PluginError } from '../../errors/index.js'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
  tempDir = join(tmpdir(), `seedforge-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// discoverPluginPackages
// ---------------------------------------------------------------------------

describe('discoverPluginPackages', () => {
  it('returns empty array when node_modules does not exist', () => {
    const result = discoverPluginPackages('/nonexistent/path')
    expect(result).toEqual([])
  })

  it('discovers seedforge-plugin-* packages', () => {
    const nmDir = join(tempDir, 'node_modules')
    mkdirSync(join(nmDir, 'seedforge-plugin-foo'), { recursive: true })
    mkdirSync(join(nmDir, 'seedforge-plugin-bar'), { recursive: true })
    mkdirSync(join(nmDir, 'some-other-package'), { recursive: true })

    const result = discoverPluginPackages(tempDir)
    expect(result.sort()).toEqual([
      'seedforge-plugin-bar',
      'seedforge-plugin-foo',
    ])
  })

  it('discovers scoped seedforge-plugin-* packages', () => {
    const nmDir = join(tempDir, 'node_modules')
    mkdirSync(join(nmDir, '@myorg', 'seedforge-plugin-custom'), { recursive: true })
    mkdirSync(join(nmDir, '@myorg', 'unrelated'), { recursive: true })

    const result = discoverPluginPackages(tempDir)
    expect(result).toEqual(['@myorg/seedforge-plugin-custom'])
  })

  it('ignores non-plugin packages', () => {
    const nmDir = join(tempDir, 'node_modules')
    mkdirSync(join(nmDir, 'lodash'), { recursive: true })
    mkdirSync(join(nmDir, 'express'), { recursive: true })

    const result = discoverPluginPackages(tempDir)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// loadSinglePlugin — file path
// ---------------------------------------------------------------------------

describe('loadSinglePlugin', () => {
  it('loads a valid plugin from a JS file with default export', async () => {
    const pluginFile = join(tempDir, 'my-plugin.mjs')
    writeFileSync(
      pluginFile,
      `
export default {
  type: 'parser',
  plugin: {
    name: 'file-parser',
    version: '1.0.0',
    detect: async () => false,
    parse: async () => ({ name: 'test', tables: new Map(), enums: new Map(), schemas: ['public'] }),
    filePatterns: ['**/*.custom'],
  },
}
`,
    )

    const result = await loadSinglePlugin(pluginFile, tempDir)
    expect(result.type).toBe('parser')
    expect(result.plugin.name).toBe('file-parser')
  })

  it('loads a valid plugin from a JS file with named "plugin" export', async () => {
    const pluginFile = join(tempDir, 'named-plugin.mjs')
    writeFileSync(
      pluginFile,
      `
export const plugin = {
  type: 'generator',
  plugin: {
    name: 'named-gen',
    version: '0.1.0',
    columnPatterns: [{ names: ['tax_id'] }],
    generate: () => '12345',
    priority: 5,
  },
}
`,
    )

    const result = await loadSinglePlugin(pluginFile, tempDir)
    expect(result.type).toBe('generator')
    expect(result.plugin.name).toBe('named-gen')
  })

  it('loads a valid plugin exported directly (module-level)', async () => {
    const pluginFile = join(tempDir, 'direct-plugin.mjs')
    writeFileSync(
      pluginFile,
      `
export const type = 'parser'
export const plugin = {
  name: 'direct-parser',
  version: '3.0.0',
  detect: async () => false,
  parse: async () => ({ name: 'test', tables: new Map(), enums: new Map(), schemas: ['public'] }),
  filePatterns: [],
}
`,
    )

    const result = await loadSinglePlugin(pluginFile, tempDir)
    expect(result.type).toBe('parser')
    expect(result.plugin.name).toBe('direct-parser')
  })

  it('throws PluginError for non-existent file', async () => {
    await expect(
      loadSinglePlugin('./nonexistent.js', tempDir),
    ).rejects.toThrow(PluginError)
  })

  it('throws PluginError for invalid plugin content', async () => {
    const pluginFile = join(tempDir, 'invalid.mjs')
    writeFileSync(pluginFile, `export default { hello: 'world' }`)

    await expect(loadSinglePlugin(pluginFile, tempDir)).rejects.toThrow(
      PluginError,
    )
  })

  it('throws PluginError for plugin missing required fields', async () => {
    const pluginFile = join(tempDir, 'incomplete.mjs')
    writeFileSync(
      pluginFile,
      `
export default {
  type: 'parser',
  plugin: {
    name: 'incomplete',
    // Missing version, detect, parse, filePatterns
  },
}
`,
    )

    await expect(loadSinglePlugin(pluginFile, tempDir)).rejects.toThrow(
      PluginError,
    )
  })

  it('resolves relative paths from projectRoot', async () => {
    const subdir = join(tempDir, 'plugins')
    mkdirSync(subdir, { recursive: true })
    const pluginFile = join(subdir, 'rel-plugin.mjs')
    writeFileSync(
      pluginFile,
      `
export default {
  type: 'generator',
  plugin: {
    name: 'rel-gen',
    version: '1.0.0',
    columnPatterns: [],
    generate: () => null,
    priority: 0,
  },
}
`,
    )

    const result = await loadSinglePlugin('./plugins/rel-plugin.mjs', tempDir)
    expect(result.plugin.name).toBe('rel-gen')
  })
})

// ---------------------------------------------------------------------------
// loadPlugins (integration)
// ---------------------------------------------------------------------------

describe('loadPlugins', () => {
  it('returns empty array with no plugins configured and no auto-detect matches', async () => {
    const result = await loadPlugins({
      projectRoot: tempDir,
      autoDetect: false,
    })
    expect(result).toEqual([])
  })

  it('loads explicitly specified plugin files', async () => {
    const pluginFile = join(tempDir, 'explicit.mjs')
    writeFileSync(
      pluginFile,
      `
export default {
  type: 'parser',
  plugin: {
    name: 'explicit-parser',
    version: '1.0.0',
    detect: async () => false,
    parse: async () => ({ name: 'test', tables: new Map(), enums: new Map(), schemas: ['public'] }),
    filePatterns: [],
  },
}
`,
    )

    const result = await loadPlugins({
      plugins: [pluginFile],
      projectRoot: tempDir,
      autoDetect: false,
    })

    expect(result).toHaveLength(1)
    expect(result[0].plugin.name).toBe('explicit-parser')
  })

  it('auto-detect is on by default but handles no node_modules gracefully', async () => {
    const result = await loadPlugins({
      projectRoot: tempDir,
    })
    expect(result).toEqual([])
  })
})
