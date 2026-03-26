import { faker as globalFaker } from '@faker-js/faker'
import { ConfigError } from '../errors/index.js'
import { ConfidenceLevel, MappingSource } from '../mapping/types.js'
import type { GeneratorFn, ColumnMapping } from '../mapping/types.js'
import type { TableConfig } from './types.js'

/**
 * Resolves a faker method path string (e.g., "faker.person.firstName") into a
 * GeneratorFn. Validates the path against the global faker at config load time,
 * but the returned GeneratorFn resolves against the seeded faker at call time.
 */
export function resolveGenerator(generatorPath: string): GeneratorFn {
  const segments = generatorPath.split('.')

  if (segments[0] !== 'faker' || segments.length < 2) {
    throw new ConfigError(
      'SF5016',
      `Unknown faker method: "${generatorPath}"`,
      [
        'Check the @faker-js/faker documentation for available methods',
        'Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word',
      ],
      { generatorPath },
    )
  }

  // Remove the "faker" prefix for traversal
  const pathSegments = segments.slice(1)

  // Validate against global faker at load time
  let obj: unknown = globalFaker
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const seg = pathSegments[i]
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      throw new ConfigError(
        'SF5016',
        `Unknown faker method: "${generatorPath}"`,
        [
          'Check the @faker-js/faker documentation for available methods',
          'Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word',
        ],
        { generatorPath },
      )
    }
    obj = (obj as Record<string, unknown>)[seg]
    if (obj === undefined) {
      throw new ConfigError(
        'SF5016',
        `Unknown faker method: "${generatorPath}"`,
        [
          'Check the @faker-js/faker documentation for available methods',
          'Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word',
        ],
        { generatorPath },
      )
    }
  }

  const methodName = pathSegments[pathSegments.length - 1]
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    throw new ConfigError(
      'SF5016',
      `Unknown faker method: "${generatorPath}"`,
      [
        'Check the @faker-js/faker documentation for available methods',
        'Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word',
      ],
      { generatorPath },
    )
  }

  const method = (obj as Record<string, unknown>)[methodName]
  if (typeof method !== 'function') {
    throw new ConfigError(
      'SF5016',
      `"${generatorPath}" is not a callable faker method`,
      [
        'Check the @faker-js/faker documentation for available methods',
        'Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word',
      ],
      { generatorPath },
    )
  }

  // Return a GeneratorFn that resolves against the seeded faker at call time
  return (seededFaker) => {
    let target: unknown = seededFaker
    for (const seg of pathSegments.slice(0, -1)) {
      target = (target as Record<string, unknown>)[seg]
    }
    return (target as Record<string, CallableFunction>)[methodName]()
  }
}

/**
 * Creates a GeneratorFn that selects from an explicit values array,
 * using optional weights for weighted random selection.
 */
function createValuesGenerator(
  values: unknown[],
  weights?: number[],
): GeneratorFn {
  if (weights) {
    // Use faker.helpers.weightedArrayElement for weighted selection
    const options = values.map((value, i) => ({
      value,
      weight: weights[i],
    }))
    return (seededFaker) => {
      return seededFaker.helpers.weightedArrayElement(options)
    }
  }

  // Uniform distribution
  return (seededFaker) => {
    return seededFaker.helpers.arrayElement(values as string[])
  }
}

/**
 * Resolves column overrides from a TableConfig into a Map of ColumnMappings.
 * The returned mappings replace heuristic mappings for those columns.
 */
export function resolveColumnOverrides(
  tableConfig: TableConfig,
): Map<string, ColumnMapping> {
  const mappings = new Map<string, ColumnMapping>()

  if (!tableConfig.columns) {
    return mappings
  }

  for (const [columnName, override] of Object.entries(tableConfig.columns)) {
    let generator: GeneratorFn | null = null
    let fakerMethod = 'config_override'

    if (override.generator) {
      generator = resolveGenerator(override.generator)
      fakerMethod = override.generator
    } else if (override.values) {
      generator = createValuesGenerator(override.values, override.weights)
      fakerMethod = 'values_list'
    }

    if (generator) {
      mappings.set(columnName, {
        column: columnName,
        table: '',
        generator,
        confidence: ConfidenceLevel.HIGH,
        source: MappingSource.EXACT_NAME,
        fakerMethod,
        domain: 'config_override',
      })
    }
  }

  return mappings
}
