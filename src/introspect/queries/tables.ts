import type pg from 'pg'
import type { TableDef, ColumnDef, EnumDef } from '../../types/index.js'
import { NormalizedType } from '../../types/index.js'
import { noTablesFound } from '../../errors/index.js'
import { mapNativeType, isSerialType, isGeneratedColumn } from '../type-map.js'

interface TableRow {
  table_name: string
  table_comment: string | null
}

interface ColumnRow {
  table_name: string
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
  is_identity: string
  identity_generation: string | null
  is_generated: string
  generation_expression: string | null
  column_comment: string | null
}

export async function queryTables(
  client: pg.Client,
  schema: string,
  enumMap: Map<string, EnumDef>,
): Promise<Map<string, TableDef>> {
  // Step 1: Fetch tables
  const tablesResult = await client.query<TableRow>(
    `SELECT
      c.relname AS table_name,
      obj_description(c.oid) AS table_comment
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`,
    [schema],
  )

  if (tablesResult.rows.length === 0) {
    throw noTablesFound(schema)
  }

  // Step 2: Fetch columns
  const columnsResult = await client.query<ColumnRow>(
    `SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.is_identity,
      c.identity_generation,
      c.is_generated,
      c.generation_expression,
      col_description(
        (SELECT oid FROM pg_class WHERE relname = c.table_name
         AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)),
        c.ordinal_position
      ) AS column_comment
    FROM information_schema.columns c
    WHERE c.table_schema = $1
    ORDER BY c.table_name, c.ordinal_position`,
    [schema],
  )

  // Group columns by table
  const columnsByTable = new Map<string, ColumnDef[]>()
  for (const row of columnsResult.rows) {
    const dataType = mapNativeType(row.data_type, row.udt_name)
    const isAutoIncrement = isSerialType(row.column_default)
    const isGenerated = isGeneratedColumn(
      row.generation_expression,
      row.identity_generation,
    )

    // Resolve enum values
    let enumValues: string[] | null = null
    if (dataType === NormalizedType.ENUM && enumMap.has(row.udt_name)) {
      enumValues = enumMap.get(row.udt_name)!.values
    }

    const col: ColumnDef = {
      name: row.column_name,
      dataType,
      nativeType: row.udt_name,
      isNullable: row.is_nullable === 'YES',
      hasDefault: row.column_default !== null || isAutoIncrement || isGenerated,
      defaultValue: row.column_default,
      isAutoIncrement,
      isGenerated,
      maxLength: row.character_maximum_length,
      numericPrecision: row.numeric_precision,
      numericScale: row.numeric_scale,
      enumValues,
      comment: row.column_comment,
    }

    if (!columnsByTable.has(row.table_name)) {
      columnsByTable.set(row.table_name, [])
    }
    columnsByTable.get(row.table_name)!.push(col)
  }

  // Build table map
  const tables = new Map<string, TableDef>()
  for (const row of tablesResult.rows) {
    const columns = new Map<string, ColumnDef>()
    const tableCols = columnsByTable.get(row.table_name) ?? []
    for (const col of tableCols) {
      columns.set(col.name, col)
    }

    tables.set(row.table_name, {
      name: row.table_name,
      schema,
      columns,
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: row.table_comment,
    })
  }

  return tables
}
