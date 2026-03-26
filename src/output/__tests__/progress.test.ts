import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProgressReporter } from '../progress.js'
import { OutputMode } from '../types.js'
import type { InsertionSummary } from '../types.js'

describe('ProgressReporter', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('startTable writes to stderr', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: true })
    reporter.startTable('users', 100)
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('users')
    expect(output).toContain('0/100')
  })

  it('finishTable prints final count and elapsed time', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: true })
    reporter.finishTable('users', 100, 250)
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('users')
    expect(output).toContain('100/100')
    expect(output).toContain('250ms')
  })

  it('quiet mode suppresses all output', () => {
    const reporter = new ProgressReporter({ quiet: true, showProgress: true })
    reporter.startTable('users', 100)
    reporter.updateTable('users', 50, 100)
    reporter.finishTable('users', 100, 250)
    reporter.printWarning('test warning')
    reporter.printSummary({
      tablesSeeded: 1,
      totalRowsInserted: 100,
      rowsPerTable: new Map([['users', 100]]),
      deferredUpdatesApplied: 0,
      sequencesReset: 0,
      elapsedMs: 250,
      warnings: [],
      mode: OutputMode.DIRECT,
    })
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('showProgress false suppresses per-table progress but not summary', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: false })
    reporter.startTable('users', 100)
    reporter.updateTable('users', 50, 100)
    reporter.finishTable('users', 100, 250)
    // Per-table calls should not have produced output
    const beforeSummaryCallCount = stderrSpy.mock.calls.length
    expect(beforeSummaryCallCount).toBe(0)

    // Summary should still appear
    reporter.printSummary({
      tablesSeeded: 1,
      totalRowsInserted: 100,
      rowsPerTable: new Map([['users', 100]]),
      deferredUpdatesApplied: 0,
      sequencesReset: 0,
      elapsedMs: 250,
      warnings: [],
      mode: OutputMode.DIRECT,
    })
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('printSummary formats summary correctly', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: true })
    const summary: InsertionSummary = {
      tablesSeeded: 3,
      totalRowsInserted: 150,
      rowsPerTable: new Map([
        ['users', 50],
        ['posts', 75],
        ['comments', 25],
      ]),
      deferredUpdatesApplied: 2,
      sequencesReset: 3,
      elapsedMs: 500,
      warnings: ['some warning'],
      mode: OutputMode.DIRECT,
    }
    reporter.printSummary(summary)
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Seeding complete')
    expect(output).toContain('Tables:  3')
    expect(output).toContain('Rows:    150')
    expect(output).toContain('Time:    500ms')
    expect(output).toContain('Mode:    DIRECT')
    expect(output).toContain('some warning')
  })

  it('DRY_RUN mode prefixes summary', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: true })
    const summary: InsertionSummary = {
      tablesSeeded: 1,
      totalRowsInserted: 50,
      rowsPerTable: new Map([['users', 50]]),
      deferredUpdatesApplied: 0,
      sequencesReset: 0,
      elapsedMs: 100,
      warnings: [],
      mode: OutputMode.DRY_RUN,
    }
    reporter.printSummary(summary)
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('[DRY RUN]')
  })

  it('printWarning writes to stderr', () => {
    const reporter = new ProgressReporter({ quiet: false, showProgress: true })
    reporter.printWarning('test warning message')
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('WARN: test warning message')
  })
})
