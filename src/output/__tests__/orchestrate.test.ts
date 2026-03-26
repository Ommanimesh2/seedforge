import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeOutput, resolveOutputMode } from '../orchestrate.js'
import { OutputMode } from '../types.js'
import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import type { InsertPlan } from '../../graph/types.js'
import { InsertionError } from '../../errors/index.js'
import { NormalizedType } from '../../types/schema.js'

function makeColumn(name: string, overrides?: Partial<ColumnDef>): ColumnDef {
  return {
    name,
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
    isNullable: true,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
    ...overrides,
  }
}

function makeTable(name: string, schemaName: string, columnNames: string[]): TableDef {
  const columns = new Map<string, ColumnDef>()
  for (const col of columnNames) {
    columns.set(col, makeColumn(col))
  }
  return {
    name,
    schema: schemaName,
    columns,
    primaryKey: { columns: ['id'], name: `${name}_pkey` },
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const t of tables) {
    tableMap.set(`${t.schema}.${t.name}`, t)
  }
  return {
    name: 'testdb',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('resolveOutputMode', () => {
  it('returns DRY_RUN for --dry-run', () => {
    expect(resolveOutputMode({ dryRun: true })).toBe(OutputMode.DRY_RUN)
  })

  it('returns FILE for --output', () => {
    expect(resolveOutputMode({ dryRun: false, output: 'file.sql' })).toBe(OutputMode.FILE)
  })

  it('returns DIRECT when neither flag is set', () => {
    expect(resolveOutputMode({ dryRun: false })).toBe(OutputMode.DIRECT)
  })

  it('DRY_RUN takes precedence over --output', () => {
    expect(resolveOutputMode({ dryRun: true, output: 'file.sql' })).toBe(OutputMode.DRY_RUN)
  })
})

describe('executeOutput', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('throws SF4006 for DIRECT mode without client', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const plan: InsertPlan = {
      ordered: ['public.users'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }
    const genResult: GenerationResult = {
      tables: new Map(),
      deferredUpdates: [],
      warnings: [],
    }

    try {
      await executeOutput(genResult, schema, plan, {
        mode: OutputMode.DIRECT,
        batchSize: 500,
        showProgress: false,
        quiet: true,
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4006')
    }
  })

  it('throws SF4007 for FILE mode without filePath', async () => {
    const schema = makeSchema([])
    const plan: InsertPlan = {
      ordered: [],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }
    const genResult: GenerationResult = {
      tables: new Map(),
      deferredUpdates: [],
      warnings: [],
    }

    try {
      await executeOutput(genResult, schema, plan, {
        mode: OutputMode.FILE,
        batchSize: 500,
        showProgress: false,
        quiet: true,
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionError)
      expect((err as InsertionError).code).toBe('SF4007')
    }
  })

  it('clamps batch size below 1 to 1', async () => {
    const schema = makeSchema([])
    const plan: InsertPlan = {
      ordered: [],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }
    const genResult: GenerationResult = {
      tables: new Map(),
      deferredUpdates: [],
      warnings: [],
    }

    const summary = await executeOutput(genResult, schema, plan, {
      mode: OutputMode.DRY_RUN,
      batchSize: 0,
      showProgress: false,
      quiet: false,
    })

    expect(summary.warnings).toContain('Batch size clamped to minimum of 1')
  })

  it('clamps batch size above 10000 to 10000', async () => {
    const schema = makeSchema([])
    const plan: InsertPlan = {
      ordered: [],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }
    const genResult: GenerationResult = {
      tables: new Map(),
      deferredUpdates: [],
      warnings: [],
    }

    const summary = await executeOutput(genResult, schema, plan, {
      mode: OutputMode.DRY_RUN,
      batchSize: 99999,
      showProgress: false,
      quiet: false,
    })

    expect(summary.warnings).toContain('Batch size clamped to maximum of 10000')
  })

  it('dispatches DRY_RUN mode and returns summary', async () => {
    const usersTable = makeTable('users', 'public', ['id', 'name'])
    const schema = makeSchema([usersTable])
    const plan: InsertPlan = {
      ordered: ['public.users'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }

    const genResult: GenerationResult = {
      tables: new Map([
        ['public.users', {
          tableName: 'public.users',
          rows: [{ id: 1, name: 'Alice' }],
          generatedPKs: [[1]],
        }],
      ]),
      deferredUpdates: [],
      warnings: [],
    }

    const summary = await executeOutput(genResult, schema, plan, {
      mode: OutputMode.DRY_RUN,
      batchSize: 500,
      showProgress: false,
      quiet: false,
    })

    expect(summary.mode).toBe(OutputMode.DRY_RUN)
    expect(summary.tablesSeeded).toBe(1)
    expect(summary.totalRowsInserted).toBe(1)
  })
})
