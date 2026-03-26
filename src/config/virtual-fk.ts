import { ConfigError } from '../errors/index.js'
import { FKAction } from '../types/schema.js'
import type { DatabaseSchema, ForeignKeyDef } from '../types/schema.js'
import type { VirtualForeignKey } from './types.js'

/**
 * Converts virtual FK declarations from config into ForeignKeyDef objects
 * with isVirtual=true, and injects them into the DatabaseSchema.
 *
 * Mutates the schema in place (the schema is a working copy at this
 * point in the pipeline).
 */
export function injectVirtualForeignKeys(
  schema: DatabaseSchema,
  virtualFKs: VirtualForeignKey[],
): DatabaseSchema {
  const availableTables = Array.from(schema.tables.keys())

  for (let i = 0; i < virtualFKs.length; i++) {
    const vfk = virtualFKs[i]

    // Validate source table
    const sourceTable = schema.tables.get(vfk.source.table)
    if (!sourceTable) {
      throw new ConfigError(
        'SF5014',
        `Virtual FK references unknown source table "${vfk.source.table}"`,
        [
          `Check the table name in virtualForeignKeys[${i}].source.table`,
          `Available tables: ${availableTables.join(', ')}`,
        ],
        { index: i, table: vfk.source.table },
      )
    }

    // Validate source column
    if (!sourceTable.columns.has(vfk.source.column)) {
      throw new ConfigError(
        'SF5015',
        `Virtual FK references unknown source column "${vfk.source.table}.${vfk.source.column}"`,
        [
          `Check the column name in virtualForeignKeys[${i}].source.column`,
          `Available columns in ${vfk.source.table}: ${Array.from(sourceTable.columns.keys()).join(', ')}`,
        ],
        { index: i, table: vfk.source.table, column: vfk.source.column },
      )
    }

    // Validate target table
    const targetTable = schema.tables.get(vfk.target.table)
    if (!targetTable) {
      throw new ConfigError(
        'SF5014',
        `Virtual FK references unknown target table "${vfk.target.table}"`,
        [
          `Check the table name in virtualForeignKeys[${i}].target.table`,
          `Available tables: ${availableTables.join(', ')}`,
        ],
        { index: i, table: vfk.target.table },
      )
    }

    // Validate target column
    if (!targetTable.columns.has(vfk.target.column)) {
      throw new ConfigError(
        'SF5015',
        `Virtual FK references unknown target column "${vfk.target.table}.${vfk.target.column}"`,
        [
          `Check the column name in virtualForeignKeys[${i}].target.column`,
          `Available columns in ${vfk.target.table}: ${Array.from(targetTable.columns.keys()).join(', ')}`,
        ],
        { index: i, table: vfk.target.table, column: vfk.target.column },
      )
    }

    // Create the virtual ForeignKeyDef
    const fkDef: ForeignKeyDef = {
      name: `virtual_fk_${vfk.source.table}_${vfk.source.column}`,
      columns: [vfk.source.column],
      referencedTable: vfk.target.table,
      referencedSchema: targetTable.schema,
      referencedColumns: [vfk.target.column],
      onDelete: FKAction.NO_ACTION,
      onUpdate: FKAction.NO_ACTION,
      isDeferrable: false,
      isDeferred: false,
      isVirtual: true,
    }

    // Inject into source table's foreignKeys
    sourceTable.foreignKeys.push(fkDef)
  }

  return schema
}
