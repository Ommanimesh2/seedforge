import type { Connection } from 'mysql2/promise'
import type { DatabaseSchema, CheckConstraintDef } from '../../types/index.js'
import { IntrospectError } from '../../errors/index.js'
import {
  queryMysqlTables,
  queryMysqlPrimaryKeys,
  queryMysqlForeignKeys,
  queryMysqlUniqueConstraints,
  queryMysqlCheckConstraints,
  queryMysqlIndexes,
  collectMysqlEnums,
} from './queries.js'

/**
 * Introspect a MySQL database schema, returning the same DatabaseSchema shape as PG.
 *
 * @param connection - mysql2 Connection
 * @param database - The database (schema) name to introspect
 * @returns DatabaseSchema with tables, enums, etc.
 */
export async function introspectMysql(
  connection: Connection,
  database: string,
): Promise<DatabaseSchema> {
  try {
    // Step 1: Fetch tables + columns (including inline enum extraction)
    const tables = await queryMysqlTables(connection, database)

    // Step 2: Fetch constraints in parallel
    const [primaryKeys, foreignKeys, uniqueConstraints, checkConstraints, indexes] =
      await Promise.all([
        queryMysqlPrimaryKeys(connection, database),
        queryMysqlForeignKeys(connection, database),
        queryMysqlUniqueConstraints(connection, database),
        queryMysqlCheckConstraints(connection, database),
        queryMysqlIndexes(connection, database),
      ])

    // Step 3: Merge results into tables
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

    // Step 4: Collect inline enum definitions
    const enums = collectMysqlEnums(tables)

    return {
      name: database,
      tables,
      enums,
      schemas: [database],
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

    for (const [colName, col] of columns) {
      if (col.enumValues) continue

      if (check.expression.includes(colName)) {
        col.enumValues = check.inferredValues
        break
      }
    }
  }
}
