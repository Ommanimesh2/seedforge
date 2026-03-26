import type { ColumnDef, CheckConstraintDef } from '../types/schema.js'
import type { ColumnMapping, GeneratorFn } from './types.js'
import { ConfidenceLevel, MappingSource } from './types.js'

function truncateValues(values: string[], max: number = 5): string {
  if (values.length <= max) {
    return `[${values.map((v) => `'${v}'`).join(', ')}]`
  }
  const shown = values.slice(0, max).map((v) => `'${v}'`).join(', ')
  return `[${shown}, ...+${values.length - max}]`
}

/**
 * Handle columns with enum values.
 * If column.enumValues is non-null and non-empty, returns a mapping
 * that picks from the enum values.
 */
export function handleEnumValues(
  column: ColumnDef,
  tableName: string,
): ColumnMapping | null {
  if (!column.enumValues || column.enumValues.length === 0) {
    return null
  }

  const values = column.enumValues
  const generator: GeneratorFn = (faker) =>
    faker.helpers.arrayElement(values)

  return {
    column: column.name,
    table: tableName,
    generator,
    confidence: ConfidenceLevel.HIGH,
    source: MappingSource.ENUM_VALUES,
    fakerMethod: `faker.helpers.arrayElement(${truncateValues(values)})`,
    domain: 'enum',
  }
}

/**
 * Handle columns with CHECK constraint inferred values.
 * Finds CHECK constraints that reference this column name and have
 * non-empty inferredValues.
 */
export function handleCheckConstraint(
  column: ColumnDef,
  tableName: string,
  checkConstraints: CheckConstraintDef[],
): ColumnMapping | null {
  for (const constraint of checkConstraints) {
    // Check if this constraint references the column
    if (!constraint.expression.includes(column.name)) {
      continue
    }

    if (!constraint.inferredValues || constraint.inferredValues.length === 0) {
      continue
    }

    const values = constraint.inferredValues
    const generator: GeneratorFn = (faker) =>
      faker.helpers.arrayElement(values)

    return {
      column: column.name,
      table: tableName,
      generator,
      confidence: ConfidenceLevel.HIGH,
      source: MappingSource.CHECK_CONSTRAINT,
      fakerMethod: `faker.helpers.arrayElement(${truncateValues(values)})`,
      domain: 'check_constraint',
    }
  }

  return null
}
