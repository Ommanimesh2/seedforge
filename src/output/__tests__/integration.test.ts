import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeOutput } from '../orchestrate.js'
import { OutputMode } from '../types.js'
import type { InsertPlan } from '../../graph/types.js'
import type { GenerationResult } from '../../generate/types.js'
import type { DatabaseSchema, ColumnDef, TableDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'
import { InsertionError } from '../../errors/index.js'

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

describe('Output module integration', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('constructs mock GenerationResult and runs DRY_RUN without database', async () => {
    // Build schema with real type constructors
    const usersTable = makeTable('users', 'public', ['id', 'name', 'email'])
    const postsTable = makeTable('posts', 'public', ['id', 'title', 'user_id'])

    const schema: DatabaseSchema = {
      name: 'integration_test',
      tables: new Map([
        ['public.users', usersTable],
        ['public.posts', postsTable],
      ]),
      enums: new Map(),
      schemas: ['public'],
    }

    const plan: InsertPlan = {
      ordered: ['public.users', 'public.posts'],
      deferredEdges: [],
      selfRefTables: [],
      warnings: [],
    }

    const generationResult: GenerationResult = {
      tables: new Map([
        ['public.users', {
          tableName: 'public.users',
          rows: [
            { id: 1, name: 'Alice', email: 'alice@test.com' },
            { id: 2, name: 'Bob', email: 'bob@test.com' },
          ],
          generatedPKs: [[1], [2]],
        }],
        ['public.posts', {
          tableName: 'public.posts',
          rows: [
            { id: 1, title: 'Hello', user_id: 1 },
          ],
          generatedPKs: [[1]],
        }],
      ]),
      deferredUpdates: [],
      warnings: ['Test warning from generation'],
    }

    const summary = await executeOutput(generationResult, schema, plan, {
      mode: OutputMode.DRY_RUN,
      batchSize: 500,
      showProgress: true,
      quiet: false,
    })

    // Verify InsertionSummary interface
    expect(summary.tablesSeeded).toBe(2)
    expect(summary.totalRowsInserted).toBe(3)
    expect(summary.rowsPerTable).toBeInstanceOf(Map)
    expect(summary.rowsPerTable.get('public.users')).toBe(2)
    expect(summary.rowsPerTable.get('public.posts')).toBe(1)
    expect(summary.deferredUpdatesApplied).toBe(0)
    expect(summary.sequencesReset).toBe(0)
    expect(typeof summary.elapsedMs).toBe('number')
    expect(summary.mode).toBe(OutputMode.DRY_RUN)
    expect(summary.warnings).toContain('Test warning from generation')
  })

  it('throws InsertionError SF4006 for DIRECT mode without client', async () => {
    const schema: DatabaseSchema = {
      name: 'test',
      tables: new Map(),
      enums: new Map(),
      schemas: ['public'],
    }

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

  it('exports are available from the output index', async () => {
    const mod = await import('../index.js')
    expect(typeof mod.executeOutput).toBe('function')
    expect(typeof mod.resolveOutputMode).toBe('function')
    expect(mod.OutputMode.DIRECT).toBe('DIRECT')
    expect(mod.OutputMode.FILE).toBe('FILE')
    expect(mod.OutputMode.DRY_RUN).toBe('DRY_RUN')
    expect(typeof mod.ProgressReporter).toBe('function')
    expect(typeof mod.buildInsertSQL).toBe('function')
    expect(typeof mod.buildUpdateSQL).toBe('function')
    expect(typeof mod.buildSequenceResetSQL).toBe('function')
    expect(typeof mod.buildTransactionWrapper).toBe('function')
  })
})
