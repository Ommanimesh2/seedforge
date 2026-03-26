import type pg from 'pg'
import type { DatabaseSchema, CheckConstraintDef } from '../types/index.js'
import { IntrospectError } from '../errors/index.js'
import { queryEnums } from './queries/enums.js'
import { queryTables } from './queries/tables.js'
import { queryPrimaryKeys } from './queries/primary-keys.js'
import { queryForeignKeys } from './queries/foreign-keys.js'
import { queryUniqueConstraints, queryIndexes } from './queries/unique-indexes.js'
import { queryCheckConstraints } from './queries/check-constraints.js'

export async function introspect(
  client: pg.Client,
  schema: string,
): Promise<DatabaseSchema> {
  try {
    // Step 1: Fetch enums first (needed for column type resolution)
    const enums = await queryEnums(client, schema)

    // Step 2: Fetch tables + columns (needs enum map)
    const tables = await queryTables(client, schema, enums)

    // Step 3: Fetch constraints in parallel
    const [primaryKeys, foreignKeys, uniqueConstraints, indexes, checkConstraints] =
      await Promise.all([
        queryPrimaryKeys(client, schema),
        queryForeignKeys(client, schema),
        queryUniqueConstraints(client, schema),
        queryIndexes(client, schema),
        queryCheckConstraints(client, schema),
      ])

    // Step 4: Merge results into tables
    for (const [tableName, table] of tables) {
      // Primary keys
      const pk = primaryKeys.get(tableName)
      if (pk) {
        table.primaryKey = pk
      } else {
        console.error(`WARNING [SF2005]: Table "${tableName}" has no primary key`)
      }

      // Foreign keys
      table.foreignKeys = foreignKeys.get(tableName) ?? []

      // Unique constraints
      table.uniqueConstraints = uniqueConstraints.get(tableName) ?? []

      // Indexes
      table.indexes = indexes.get(tableName) ?? []

      // CHECK constraints
      const checks = checkConstraints.get(tableName) ?? []
      table.checkConstraints = checks

      // Propagate CHECK-inferred enum values to columns
      propagateCheckValues(table.columns, checks)
    }

    // Step 5: Get database name
    const dbNameResult = await client.query<{ current_database: string }>(
      'SELECT current_database()',
    )

    return {
      name: dbNameResult.rows[0].current_database,
      tables,
      enums,
      schemas: [schema],
    }
  } catch (err) {
    if (err instanceof IntrospectError) throw err
    if (err instanceof Error && 'code' in err) throw err // SeedForgeError subtype
    throw new IntrospectError(
      'SF2004',
      `Schema introspection failed: ${err instanceof Error ? err.message : String(err)}`,
      ['Check database permissions and connectivity'],
    )
  }
}

function propagateCheckValues(
  columns: Map<string, { enumValues: string[] | null }>,
  checks: CheckConstraintDef[],
): void {
  for (const check of checks) {
    if (!check.inferredValues || check.inferredValues.length === 0) continue

    // Try to find which column this CHECK applies to
    for (const [colName, col] of columns) {
      // Skip columns that already have enum values from PG enum types
      if (col.enumValues) continue

      // Check if the constraint expression references this column
      if (check.expression.includes(colName)) {
        col.enumValues = check.inferredValues
        break // Each CHECK maps to one column
      }
    }
  }
}
