import { ConfigError } from '../errors/index.js'
import { ExistingDataMode } from './types.js'
import type {
  SeedforgeConfig,
  ColumnOverride,
  TableConfig,
  RelationshipConfig,
  VirtualForeignKey,
  ConnectionConfig,
  ScenarioDef,
  AIConfigYaml,
} from './types.js'
import { createDefaultConfig } from './defaults.js'
import { suggestKey } from './levenshtein.js'
import { isValidDistributionType } from '../generate/distributions.js'

const VALID_TOP_LEVEL_KEYS = [
  'connection',
  'seed',
  'count',
  'locale',
  'existingData',
  'tables',
  'exclude',
  'virtualForeignKeys',
  'scenarios',
  'ai',
]

const VALID_AI_KEYS = [
  'enabled',
  'provider',
  'model',
  'baseUrl',
  'apiKey',
  'columns',
  'temperature',
  'maxTokensPerField',
  'batchSize',
  'cache',
  'prompt',
]

const VALID_AI_PROVIDERS = ['openai', 'anthropic', 'ollama', 'groq']

const VALID_CONNECTION_KEYS = ['url', 'schema']
const VALID_TABLE_CONFIG_KEYS = ['count', 'columns', 'relationships']
const VALID_RELATIONSHIP_KEYS = ['cardinality', 'distribution', 'weights']
const VALID_CARDINALITY_DISTRIBUTIONS = ['uniform', 'zipf', 'normal']
const VALID_COLUMN_OVERRIDE_KEYS = [
  'generator',
  'unique',
  'nullable',
  'values',
  'weights',
  'distribution',
]
const VALID_EXISTING_DATA_KEYS = ['mode']

function throwUnknownKey(
  key: string,
  validKeys: string[],
  path: string,
): never {
  const suggestion = suggestKey(key, validKeys)
  const hints = [
    `Valid keys: ${validKeys.join(', ')}`,
  ]
  if (suggestion) {
    hints.push(`Did you mean "${suggestion}"?`)
  }
  throw new ConfigError(
    'SF5003',
    `Unknown config key "${path}${key}"`,
    hints,
    { key, path },
  )
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  validKeys: string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!validKeys.includes(key)) {
      throwUnknownKey(key, validKeys, path)
    }
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function validateConnection(raw: unknown): ConnectionConfig {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5003',
      '"connection" must be an object',
      ['Expected an object with url and/or schema fields'],
    )
  }

  checkUnknownKeys(raw, VALID_CONNECTION_KEYS, 'connection.')

  const result: ConnectionConfig = {}

  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string') {
      throw new ConfigError(
        'SF5003',
        '"connection.url" must be a string',
        ['Provide a PostgreSQL connection string'],
      )
    }
    result.url = raw.url
  }

  if (raw.schema !== undefined) {
    if (typeof raw.schema !== 'string') {
      throw new ConfigError(
        'SF5003',
        '"connection.schema" must be a string',
        ['Provide a schema name like "public"'],
      )
    }
    result.schema = raw.schema
  }

  return result
}

function validateColumnOverride(
  raw: unknown,
  table: string,
  column: string,
): ColumnOverride {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5003',
      `Column override for ${table}.${column} must be an object`,
      [],
    )
  }

  checkUnknownKeys(raw, VALID_COLUMN_OVERRIDE_KEYS, `tables.${table}.columns.${column}.`)

  const override: ColumnOverride = {}

  if (raw.generator !== undefined) {
    if (typeof raw.generator !== 'string' || !raw.generator.startsWith('faker.')) {
      throw new ConfigError(
        'SF5007',
        `Invalid generator "${raw.generator}" for ${table}.${column}. Must be a faker method path like "faker.person.firstName"`,
        ['Generator must start with "faker." followed by the method path'],
        { table, column, generator: raw.generator },
      )
    }
    override.generator = raw.generator
  }

  if (raw.unique !== undefined) {
    if (typeof raw.unique !== 'boolean') {
      throw new ConfigError(
        'SF5003',
        `"unique" for ${table}.${column} must be a boolean`,
        [],
      )
    }
    override.unique = raw.unique
  }

  if (raw.nullable !== undefined) {
    if (typeof raw.nullable !== 'number' || raw.nullable < 0 || raw.nullable > 1) {
      throw new ConfigError(
        'SF5008',
        `"nullable" for ${table}.${column} must be between 0 and 1, got ${raw.nullable}`,
        ['Provide a decimal between 0.0 and 1.0 representing the probability of NULL'],
        { table, column, value: raw.nullable },
      )
    }
    override.nullable = raw.nullable
  }

  if (raw.values !== undefined) {
    if (!Array.isArray(raw.values)) {
      throw new ConfigError(
        'SF5003',
        `"values" for ${table}.${column} must be an array`,
        [],
      )
    }
    override.values = raw.values
  }

  if (raw.weights !== undefined) {
    if (!Array.isArray(raw.weights)) {
      throw new ConfigError(
        'SF5009',
        `"weights" for ${table}.${column} must be an array of numbers`,
        [],
      )
    }

    if (override.values === undefined) {
      throw new ConfigError(
        'SF5009',
        `"weights" requires "values" to be defined for ${table}.${column}`,
        ['Add a "values" array alongside "weights"'],
        { table, column },
      )
    }

    for (const w of raw.weights) {
      if (typeof w !== 'number' || w < 0) {
        throw new ConfigError(
          'SF5009',
          `"weights" for ${table}.${column} must contain non-negative numbers`,
          [],
          { table, column },
        )
      }
    }

    if ((raw.weights as unknown[]).length !== override.values.length) {
      throw new ConfigError(
        'SF5009',
        `"weights" length (${(raw.weights as unknown[]).length}) must match "values" length (${override.values.length}) for ${table}.${column}`,
        ['Ensure weights and values arrays have the same number of elements'],
        { table, column },
      )
    }

    override.weights = raw.weights as number[]
  }

  if (raw.distribution !== undefined) {
    if (typeof raw.distribution !== 'string' || !isValidDistributionType(raw.distribution)) {
      throw new ConfigError(
        'SF5020',
        `Invalid distribution "${raw.distribution}" for ${table}.${column}. Must be one of: uniform, zipf, normal, exponential`,
        ['Valid distribution types: uniform, zipf, normal, exponential'],
        { table, column, distribution: raw.distribution },
      )
    }
    override.distribution = raw.distribution
  }

  // Mutual exclusion check
  if (override.generator !== undefined && override.values !== undefined) {
    throw new ConfigError(
      'SF5011',
      `Cannot specify both "generator" and "values" for ${table}.${column}`,
      ['Use either "generator" for a faker method or "values" for an explicit list, not both'],
      { table, column },
    )
  }

  return override
}

function validateRelationshipConfig(
  raw: unknown,
  tableName: string,
  columnName: string,
): RelationshipConfig {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5021',
      `Relationship config for ${tableName}.${columnName} must be an object`,
      [],
    )
  }

  checkUnknownKeys(raw, VALID_RELATIONSHIP_KEYS, `tables.${tableName}.relationships.${columnName}.`)

  if (raw.cardinality === undefined) {
    throw new ConfigError(
      'SF5021',
      `"cardinality" is required in relationships config for ${tableName}.${columnName}`,
      ['Provide a range string like "1..10" or an array like [1, 3, 5]'],
      { table: tableName, column: columnName },
    )
  }

  const config: RelationshipConfig = { cardinality: '' }

  if (typeof raw.cardinality === 'string') {
    const match = /^(\d+)\.\.(\d+)$/.exec(raw.cardinality)
    if (!match) {
      throw new ConfigError(
        'SF5022',
        `Invalid cardinality range "${raw.cardinality}" for ${tableName}.${columnName}. Use format "min..max" (e.g., "1..10")`,
        ['Examples: "1..10", "0..3", "2..5"'],
        { table: tableName, column: columnName, value: raw.cardinality },
      )
    }
    const min = parseInt(match[1], 10)
    const max = parseInt(match[2], 10)
    if (min > max) {
      throw new ConfigError(
        'SF5022',
        `Cardinality min (${min}) must be <= max (${max}) for ${tableName}.${columnName}`,
        [],
        { table: tableName, column: columnName },
      )
    }
    config.cardinality = raw.cardinality
  } else if (Array.isArray(raw.cardinality)) {
    for (const v of raw.cardinality) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new ConfigError(
          'SF5023',
          `Discrete cardinality values must be non-negative integers for ${tableName}.${columnName}`,
          ['Example: [1, 3, 5]'],
          { table: tableName, column: columnName },
        )
      }
    }
    if (raw.cardinality.length === 0) {
      throw new ConfigError(
        'SF5023',
        `Cardinality array must not be empty for ${tableName}.${columnName}`,
        [],
        { table: tableName, column: columnName },
      )
    }
    config.cardinality = raw.cardinality as number[]
  } else {
    throw new ConfigError(
      'SF5022',
      `"cardinality" must be a range string or array for ${tableName}.${columnName}, got ${typeof raw.cardinality}`,
      ['Use a range string like "1..10" or an array like [1, 3, 5]'],
      { table: tableName, column: columnName },
    )
  }

  if (raw.distribution !== undefined) {
    if (
      typeof raw.distribution !== 'string' ||
      !VALID_CARDINALITY_DISTRIBUTIONS.includes(raw.distribution)
    ) {
      throw new ConfigError(
        'SF5024',
        `Invalid distribution "${raw.distribution}" for relationship ${tableName}.${columnName}. Must be one of: ${VALID_CARDINALITY_DISTRIBUTIONS.join(', ')}`,
        [],
        { table: tableName, column: columnName, distribution: raw.distribution },
      )
    }
    config.distribution = raw.distribution as 'uniform' | 'zipf' | 'normal'
  }

  if (raw.weights !== undefined) {
    if (!Array.isArray(raw.cardinality)) {
      throw new ConfigError(
        'SF5025',
        `"weights" can only be used with array cardinality for ${tableName}.${columnName}`,
        ['Remove "weights" or change "cardinality" to an array'],
        { table: tableName, column: columnName },
      )
    }
    if (!Array.isArray(raw.weights)) {
      throw new ConfigError(
        'SF5025',
        `"weights" must be an array of numbers for ${tableName}.${columnName}`,
        [],
        { table: tableName, column: columnName },
      )
    }
    if ((raw.weights as unknown[]).length !== (raw.cardinality as unknown[]).length) {
      throw new ConfigError(
        'SF5025',
        `"weights" length (${(raw.weights as unknown[]).length}) must match "cardinality" length (${(raw.cardinality as unknown[]).length}) for ${tableName}.${columnName}`,
        [],
        { table: tableName, column: columnName },
      )
    }
    for (const w of raw.weights as unknown[]) {
      if (typeof w !== 'number' || w < 0) {
        throw new ConfigError(
          'SF5025',
          `"weights" must contain non-negative numbers for ${tableName}.${columnName}`,
          [],
          { table: tableName, column: columnName },
        )
      }
    }
    config.weights = raw.weights as number[]
  }

  return config
}

function validateTableConfig(
  raw: unknown,
  tableName: string,
): TableConfig {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5003',
      `Table config for "${tableName}" must be an object`,
      [],
    )
  }

  checkUnknownKeys(raw, VALID_TABLE_CONFIG_KEYS, `tables.${tableName}.`)

  const config: TableConfig = {}

  if (raw.count !== undefined) {
    if (
      typeof raw.count !== 'number' ||
      !Number.isInteger(raw.count) ||
      raw.count < 1
    ) {
      throw new ConfigError(
        'SF5005',
        `"count" must be a positive integer, got ${raw.count}`,
        ['Provide a whole number greater than 0'],
        { table: tableName, value: raw.count },
      )
    }
    config.count = raw.count
  }

  if (raw.columns !== undefined) {
    if (!isPlainObject(raw.columns)) {
      throw new ConfigError(
        'SF5003',
        `"columns" in table "${tableName}" must be an object`,
        [],
      )
    }

    config.columns = {}
    for (const [colName, colRaw] of Object.entries(raw.columns)) {
      config.columns[colName] = validateColumnOverride(
        colRaw,
        tableName,
        colName,
      )
    }
  }

  if (raw.relationships !== undefined) {
    if (!isPlainObject(raw.relationships)) {
      throw new ConfigError(
        'SF5003',
        `"relationships" in table "${tableName}" must be an object`,
        [],
      )
    }

    config.relationships = {}
    for (const [colName, relRaw] of Object.entries(raw.relationships)) {
      config.relationships[colName] = validateRelationshipConfig(
        relRaw,
        tableName,
        colName,
      )
    }
  }

  return config
}

function validateVirtualFK(
  raw: unknown,
  index: number,
): VirtualForeignKey {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5013',
      `Invalid virtualForeignKey at index ${index}: must be an object`,
      [],
    )
  }

  const source = raw.source
  const target = raw.target

  if (
    !isPlainObject(source) ||
    typeof source.table !== 'string' ||
    typeof source.column !== 'string' ||
    !isPlainObject(target) ||
    typeof target.table !== 'string' ||
    typeof target.column !== 'string'
  ) {
    throw new ConfigError(
      'SF5013',
      `Invalid virtualForeignKey at index ${index}: must have source.table, source.column, target.table, and target.column`,
      ['Each virtualForeignKey must specify source: {table, column} and target: {table, column}'],
      { index },
    )
  }

  return {
    source: { table: source.table, column: source.column },
    target: { table: target.table, column: target.column },
  }
}

/**
 * Validates a raw parsed YAML object and produces a typed SeedforgeConfig.
 * Throws ConfigError with SF5xxx codes for validation failures.
 */
export function validateConfig(
  raw: Record<string, unknown>,
): SeedforgeConfig {
  const defaults = createDefaultConfig()

  // Check for unknown top-level keys
  checkUnknownKeys(raw, VALID_TOP_LEVEL_KEYS, '')

  const config: SeedforgeConfig = { ...defaults }

  // connection
  if (raw.connection !== undefined) {
    const conn = validateConnection(raw.connection)
    config.connection = { ...defaults.connection, ...conn }
  }

  // seed
  if (raw.seed !== undefined) {
    if (
      typeof raw.seed !== 'number' ||
      !Number.isInteger(raw.seed) ||
      raw.seed < 0
    ) {
      throw new ConfigError(
        'SF5004',
        `"seed" must be a non-negative integer, got ${typeof raw.seed}: ${raw.seed}`,
        ['Provide a whole number >= 0 for deterministic generation'],
        { value: raw.seed },
      )
    }
    config.seed = raw.seed
  }

  // count
  if (raw.count !== undefined) {
    if (
      typeof raw.count !== 'number' ||
      !Number.isInteger(raw.count) ||
      raw.count < 1
    ) {
      throw new ConfigError(
        'SF5005',
        `"count" must be a positive integer, got ${raw.count}`,
        ['Provide a whole number greater than 0'],
        { value: raw.count },
      )
    }
    config.count = raw.count
  }

  // locale
  if (raw.locale !== undefined) {
    if (typeof raw.locale !== 'string' || raw.locale.length === 0) {
      throw new ConfigError(
        'SF5003',
        '"locale" must be a non-empty string',
        ['Example: "en", "de", "ja"'],
        { value: raw.locale },
      )
    }
    config.locale = raw.locale
  }

  // existingData
  if (raw.existingData !== undefined) {
    if (!isPlainObject(raw.existingData)) {
      throw new ConfigError(
        'SF5006',
        '"existingData" must be an object with a "mode" field',
        ['Example: existingData: { mode: "augment" }'],
      )
    }

    checkUnknownKeys(raw.existingData, VALID_EXISTING_DATA_KEYS, 'existingData.')

    if (raw.existingData.mode !== undefined) {
      const modeStr = String(raw.existingData.mode).toUpperCase()
      if (
        modeStr !== 'AUGMENT' &&
        modeStr !== 'TRUNCATE' &&
        modeStr !== 'ERROR'
      ) {
        throw new ConfigError(
          'SF5006',
          `Invalid existingData.mode: "${raw.existingData.mode}". Must be one of: augment, truncate, error`,
          ['Valid modes: augment (default), truncate, error'],
          { value: raw.existingData.mode },
        )
      }
      config.existingData = ExistingDataMode[modeStr as keyof typeof ExistingDataMode]
    }
  }

  // tables
  if (raw.tables !== undefined) {
    if (!isPlainObject(raw.tables)) {
      throw new ConfigError(
        'SF5003',
        '"tables" must be an object keyed by table name',
        [],
      )
    }

    config.tables = {}
    for (const [tableName, tableRaw] of Object.entries(raw.tables)) {
      config.tables[tableName] = validateTableConfig(tableRaw, tableName)
    }
  }

  // exclude
  if (raw.exclude !== undefined) {
    if (!Array.isArray(raw.exclude)) {
      throw new ConfigError(
        'SF5012',
        '"exclude" must be an array of strings',
        ['Example: exclude: ["schema_migrations", "pg_*"]'],
      )
    }

    for (const item of raw.exclude) {
      if (typeof item !== 'string') {
        throw new ConfigError(
          'SF5012',
          '"exclude" must be an array of strings',
          ['Each element must be a string table name or glob pattern'],
          { invalidElement: item },
        )
      }
    }

    config.exclude = raw.exclude as string[]
  }

  // virtualForeignKeys
  if (raw.virtualForeignKeys !== undefined) {
    if (!Array.isArray(raw.virtualForeignKeys)) {
      throw new ConfigError(
        'SF5013',
        '"virtualForeignKeys" must be an array',
        [],
      )
    }

    config.virtualForeignKeys = raw.virtualForeignKeys.map(
      (entry: unknown, i: number) => validateVirtualFK(entry, i),
    )
  }

  // scenarios
  if (raw.scenarios !== undefined) {
    config.scenarios = validateScenariosSection(raw.scenarios)
  }

  // ai
  if (raw.ai !== undefined) {
    config.ai = validateAIConfig(raw.ai)
  }

  return config
}

/**
 * Validates the AI configuration section.
 */
function validateAIConfig(raw: unknown): AIConfigYaml {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5030',
      '"ai" must be an object',
      ['Example: ai: { enabled: true, provider: "ollama" }'],
    )
  }

  checkUnknownKeys(raw, VALID_AI_KEYS, 'ai.')

  const config: AIConfigYaml = {}

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      throw new ConfigError('SF5030', '"ai.enabled" must be a boolean', [])
    }
    config.enabled = raw.enabled
  }

  if (raw.provider !== undefined) {
    if (typeof raw.provider !== 'string' || !VALID_AI_PROVIDERS.includes(raw.provider)) {
      throw new ConfigError(
        'SF5031',
        `Invalid AI provider "${raw.provider}". Must be one of: ${VALID_AI_PROVIDERS.join(', ')}`,
        ['Use "ollama" for local inference with no API key'],
        { provider: raw.provider },
      )
    }
    config.provider = raw.provider as AIConfigYaml['provider']
  }

  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || raw.model.length === 0) {
      throw new ConfigError('SF5030', '"ai.model" must be a non-empty string', [])
    }
    config.model = raw.model
  }

  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string' || raw.baseUrl.length === 0) {
      throw new ConfigError('SF5030', '"ai.baseUrl" must be a non-empty string', [])
    }
    config.baseUrl = raw.baseUrl
  }

  if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== 'string') {
      throw new ConfigError('SF5030', '"ai.apiKey" must be a string', [])
    }
    config.apiKey = raw.apiKey
  }

  if (raw.columns !== undefined) {
    if (!Array.isArray(raw.columns) || !raw.columns.every((c: unknown) => typeof c === 'string')) {
      throw new ConfigError(
        'SF5030',
        '"ai.columns" must be an array of strings',
        ['Example: ["products.description", "users.bio"]'],
      )
    }
    config.columns = raw.columns as string[]
  }

  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== 'number' || raw.temperature < 0 || raw.temperature > 2) {
      throw new ConfigError(
        'SF5032',
        `"ai.temperature" must be a number between 0 and 2, got ${raw.temperature}`,
        ['Lower values (0.1-0.5) produce more focused text, higher values (0.7-1.2) produce more creative text'],
        { value: raw.temperature },
      )
    }
    config.temperature = raw.temperature
  }

  if (raw.maxTokensPerField !== undefined) {
    if (typeof raw.maxTokensPerField !== 'number' || !Number.isInteger(raw.maxTokensPerField) || raw.maxTokensPerField < 1) {
      throw new ConfigError('SF5030', '"ai.maxTokensPerField" must be a positive integer', [])
    }
    config.maxTokensPerField = raw.maxTokensPerField
  }

  if (raw.batchSize !== undefined) {
    if (typeof raw.batchSize !== 'number' || !Number.isInteger(raw.batchSize) || raw.batchSize < 1) {
      throw new ConfigError('SF5030', '"ai.batchSize" must be a positive integer', [])
    }
    config.batchSize = raw.batchSize
  }

  if (raw.cache !== undefined) {
    if (typeof raw.cache !== 'boolean') {
      throw new ConfigError('SF5030', '"ai.cache" must be a boolean', [])
    }
    config.cache = raw.cache
  }

  if (raw.prompt !== undefined) {
    if (typeof raw.prompt !== 'string') {
      throw new ConfigError('SF5030', '"ai.prompt" must be a string', [])
    }
    config.prompt = raw.prompt
  }

  return config
}

/**
 * Validates the scenarios section of the config.
 */
function validateScenariosSection(
  raw: unknown,
): Record<string, ScenarioDef> {
  if (!isPlainObject(raw)) {
    throw new ConfigError(
      'SF5019',
      '"scenarios" must be an object keyed by scenario name',
      ['Example: scenarios: { empty_store: { tables: { users: { count: 5 } } } }'],
    )
  }

  const scenarios: Record<string, ScenarioDef> = {}

  for (const [scenarioName, scenarioRaw] of Object.entries(raw)) {
    if (!isPlainObject(scenarioRaw)) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}" must be an object with a "tables" key`,
        [],
        { scenario: scenarioName },
      )
    }

    if (scenarioRaw.tables === undefined) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}" must have a "tables" key`,
        ['Example: scenarios: { my_scenario: { tables: { users: { count: 10 } } } }'],
        { scenario: scenarioName },
      )
    }

    if (!isPlainObject(scenarioRaw.tables)) {
      throw new ConfigError(
        'SF5019',
        `Scenario "${scenarioName}.tables" must be an object keyed by table name`,
        [],
        { scenario: scenarioName },
      )
    }

    const tables: Record<string, { count: number }> = {}

    for (const [tableName, tableRaw] of Object.entries(scenarioRaw.tables as Record<string, unknown>)) {
      if (!isPlainObject(tableRaw)) {
        throw new ConfigError(
          'SF5019',
          `Scenario "${scenarioName}.tables.${tableName}" must be an object with a "count" key`,
          [],
          { scenario: scenarioName, table: tableName },
        )
      }

      if (
        (tableRaw as Record<string, unknown>).count === undefined ||
        typeof (tableRaw as Record<string, unknown>).count !== 'number' ||
        !Number.isInteger((tableRaw as Record<string, unknown>).count) ||
        ((tableRaw as Record<string, unknown>).count as number) < 0
      ) {
        throw new ConfigError(
          'SF5019',
          `Scenario "${scenarioName}.tables.${tableName}.count" must be a non-negative integer`,
          ['Use 0 to generate no rows for this table'],
          { scenario: scenarioName, table: tableName, value: (tableRaw as Record<string, unknown>).count },
        )
      }

      tables[tableName] = { count: (tableRaw as Record<string, unknown>).count as number }
    }

    scenarios[scenarioName] = { tables }
  }

  return scenarios
}
