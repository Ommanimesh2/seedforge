import type { SeedforgeConfig, TableConfig } from '../config/types.js'
import { ConfigError } from '../errors/index.js'

/**
 * A scenario definition that overrides row counts per table.
 */
export interface ScenarioDef {
  tables: Record<string, { count: number }>
}

/**
 * Loads a named scenario from the config and returns a merged config
 * with the scenario's table count overrides applied.
 *
 * Scenarios only override the `count` per table — all other config
 * values remain unchanged.
 *
 * @param config - The full seedforge config (with scenarios attached)
 * @param name - The scenario name to load
 * @returns A new SeedforgeConfig with scenario overrides applied
 * @throws ConfigError if the scenario is not found
 */
export function loadScenario(
  config: SeedforgeConfig,
  name: string,
): SeedforgeConfig {
  // Access scenarios from the config (they're added via the extended type)
  const scenarios = (config as SeedforgeConfigWithScenarios).scenarios
  if (!scenarios || !(name in scenarios)) {
    const available = scenarios ? Object.keys(scenarios) : []
    throw new ConfigError(
      'SF5018',
      `Unknown scenario "${name}"`,
      available.length > 0
        ? [`Available scenarios: ${available.join(', ')}`]
        : ['No scenarios defined in config. Add a "scenarios" section to .seedforge.yml'],
      { scenario: name, available },
    )
  }

  const scenario = scenarios[name]

  // Deep-merge the scenario table counts into the config
  const mergedTables: Record<string, TableConfig> = { ...config.tables }

  for (const [tableName, tableOverride] of Object.entries(scenario.tables)) {
    const existingTableConfig = mergedTables[tableName] ?? {}
    mergedTables[tableName] = {
      ...existingTableConfig,
      count: tableOverride.count,
    }
  }

  return {
    ...config,
    tables: mergedTables,
  }
}

/**
 * Extended config type that includes the optional scenarios section.
 */
export interface SeedforgeConfigWithScenarios extends SeedforgeConfig {
  scenarios?: Record<string, ScenarioDef>
}

/**
 * Validates the scenarios section of a raw config object.
 * Returns the validated scenarios record or undefined if not present.
 */
export function validateScenarios(
  raw: Record<string, unknown>,
): Record<string, ScenarioDef> | undefined {
  if (raw.scenarios === undefined) {
    return undefined
  }

  if (raw.scenarios === null || typeof raw.scenarios !== 'object' || Array.isArray(raw.scenarios)) {
    throw new ConfigError(
      'SF5019',
      '"scenarios" must be an object keyed by scenario name',
      ['Example: scenarios: { empty_store: { tables: { users: { count: 5 } } } }'],
    )
  }

  const scenarios: Record<string, ScenarioDef> = {}

  for (const [scenarioName, scenarioRaw] of Object.entries(raw.scenarios as Record<string, unknown>)) {
    if (scenarioRaw === null || typeof scenarioRaw !== 'object' || Array.isArray(scenarioRaw)) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}" must be an object with a "tables" key`,
        [],
        { scenario: scenarioName },
      )
    }

    const scenarioObj = scenarioRaw as Record<string, unknown>

    if (scenarioObj.tables === undefined) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}" must have a "tables" key`,
        ['Example: scenarios: { my_scenario: { tables: { users: { count: 10 } } } }'],
        { scenario: scenarioName },
      )
    }

    if (typeof scenarioObj.tables !== 'object' || scenarioObj.tables === null || Array.isArray(scenarioObj.tables)) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}.tables" must be an object keyed by table name`,
        [],
        { scenario: scenarioName },
      )
    }

    const tables: Record<string, { count: number }> = {}

    for (const [tableName, tableRaw] of Object.entries(scenarioObj.tables as Record<string, unknown>)) {
      if (tableRaw === null || typeof tableRaw !== 'object' || Array.isArray(tableRaw)) {
        throw new ConfigError(
          'SF5019',
          `Scenario "${scenarioName}.tables.${tableName}" must be an object with a "count" key`,
          [],
          { scenario: scenarioName, table: tableName },
        )
      }

      const tableObj = tableRaw as Record<string, unknown>

      if (
        tableObj.count === undefined ||
        typeof tableObj.count !== 'number' ||
        !Number.isInteger(tableObj.count) ||
        tableObj.count < 0
      ) {
        throw new ConfigError(
          'SF5019',
          `Scenario "${scenarioName}.tables.${tableName}.count" must be a non-negative integer`,
          ['Use 0 to generate no rows for this table'],
          { scenario: scenarioName, table: tableName, value: tableObj.count },
        )
      }

      tables[tableName] = { count: tableObj.count }
    }

    scenarios[scenarioName] = { tables }
  }

  return scenarios
}
