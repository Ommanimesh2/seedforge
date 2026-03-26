import type { InsertionSummary } from './types.js'
import { OutputMode } from './types.js'

/**
 * Determine whether color output is enabled.
 * Respects NO_COLOR (https://no-color.org/) and FORCE_COLOR conventions.
 */
export function isColorEnabled(): boolean {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') {
    return true
  }
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false
  }
  return Boolean(process.stderr.isTTY)
}

/**
 * Simple progress reporter that writes to stderr.
 * TTY-aware: uses \\r overwrite when interactive, newlines when piped.
 * Respects NO_COLOR and FORCE_COLOR environment variables.
 */
export class ProgressReporter {
  private readonly quiet: boolean
  private readonly showProgress: boolean
  private readonly isTTY: boolean
  private readonly colorEnabled: boolean
  private lastUpdateTime: Map<string, number> = new Map()
  private static readonly THROTTLE_MS = 100

  constructor(options: { quiet: boolean; showProgress: boolean }) {
    this.quiet = options.quiet
    this.showProgress = options.showProgress
    this.isTTY = Boolean(process.stderr.isTTY)
    this.colorEnabled = isColorEnabled()
  }

  /**
   * Signal the start of inserting rows for a table.
   */
  startTable(tableName: string, totalRows: number): void {
    if (this.quiet || !this.showProgress) return
    this.lastUpdateTime.set(tableName, 0)
    this.writeProgress(`  ${tableName}: 0/${totalRows} rows`)
  }

  /**
   * Update progress for a table. Throttled to avoid flooding stderr.
   */
  updateTable(tableName: string, insertedRows: number, totalRows: number): void {
    if (this.quiet || !this.showProgress) return

    const now = Date.now()
    const lastUpdate = this.lastUpdateTime.get(tableName) ?? 0
    if (now - lastUpdate < ProgressReporter.THROTTLE_MS) {
      return
    }
    this.lastUpdateTime.set(tableName, now)

    const msg = `  ${tableName}: ${insertedRows}/${totalRows} rows`
    if (this.isTTY) {
      process.stderr.write(`\r${msg}`)
    } else {
      process.stderr.write(`${msg}\n`)
    }
  }

  /**
   * Signal that all rows for a table have been inserted.
   */
  finishTable(tableName: string, totalRows: number, elapsedMs: number): void {
    if (this.quiet || !this.showProgress) return
    const msg = `  ${tableName}: ${totalRows}/${totalRows} rows (${elapsedMs}ms)`
    if (this.isTTY) {
      process.stderr.write(`\r${msg}\n`)
    } else {
      process.stderr.write(`${msg}\n`)
    }
  }

  /**
   * Print a warning message.
   */
  printWarning(message: string): void {
    if (this.quiet) return
    process.stderr.write(`  WARN: ${message}\n`)
  }

  /**
   * Print a formatted summary block.
   */
  printSummary(summary: InsertionSummary): void {
    if (this.quiet) return

    const prefix = summary.mode === OutputMode.DRY_RUN ? '[DRY RUN] ' : ''

    const lines: string[] = [
      '',
      `${prefix}Seeding complete:`,
      `  Tables:  ${summary.tablesSeeded}`,
      `  Rows:    ${summary.totalRowsInserted}`,
      `  Time:    ${summary.elapsedMs}ms`,
      `  Mode:    ${summary.mode}`,
    ]

    if (summary.warnings.length > 0) {
      lines.push('')
      lines.push('Warnings:')
      for (const w of summary.warnings) {
        lines.push(`  - ${w}`)
      }
    }

    process.stderr.write(lines.join('\n') + '\n')
  }

  private writeProgress(msg: string): void {
    if (this.isTTY) {
      process.stderr.write(`\r${msg}`)
    } else {
      process.stderr.write(`${msg}\n`)
    }
  }
}
