/**
 * E2e coverage for Wave 1.3 — `seedforge inspect` subcommand and the
 * compatibility report. Exercises the actual CLI binary path so the
 * subcommand rewrite, JSON contract, and legacy `--inspect`
 * deprecation hint are all covered.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rewriteInspectSubcommand } from '../../cli.js'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli.ts')
const JPA_FIXTURE = join(here, 'fixtures', 'jpa-real-world', 'domain', 'entity')

function runCli(args: string[]): {
  stdout: string
  stderr: string
  status: number | null
} {
  const result = spawnSync('npx', ['tsx', CLI_PATH, ...args], { encoding: 'utf-8', cwd: REPO_ROOT })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

describe('rewriteInspectSubcommand (unit)', () => {
  it('rewrites `seedforge inspect <args>` to `seedforge --inspect --yes <args>`', () => {
    const out = rewriteInspectSubcommand(['node', 'seedforge', 'inspect', '--jpa', '/path'])
    expect(out).toEqual(['node', 'seedforge', '--inspect', '--yes', '--jpa', '/path'])
  })

  it('leaves non-inspect invocations alone', () => {
    const argv = ['node', 'seedforge', '--db', 'postgres://localhost/x']
    expect(rewriteInspectSubcommand(argv)).toBe(argv)
  })

  it('drops a duplicate --inspect when user typed both forms', () => {
    const out = rewriteInspectSubcommand(['node', 'seedforge', 'inspect', '--inspect', '--db', 'x'])
    expect(out).toEqual(['node', 'seedforge', '--inspect', '--yes', '--db', 'x'])
  })
})

describe('seedforge inspect (subcommand, e2e)', () => {
  it('runs against JPA fixture and emits compatibility report', () => {
    const { stdout, status } = runCli(['inspect', '--jpa', JPA_FIXTURE])
    expect(status).toBe(0)
    expect(stdout).toContain('seedforge schema inspection')
    expect(stdout).toContain('Summary:')
    expect(stdout).toContain('Compatibility:')
  }, 30_000)

  it('emits valid, well-shaped JSON with --json --quiet', () => {
    const { stdout, status } = runCli(['inspect', '--jpa', JPA_FIXTURE, '--json', '--quiet'])
    expect(status).toBe(0)
    const json = JSON.parse(stdout)
    expect(json).toHaveProperty('summary')
    expect(json.summary).toHaveProperty('compatibility')
    expect(json.summary.compatibility).toEqual(
      expect.objectContaining({
        ok: expect.any(Number),
        risky: expect.any(Number),
        blocked: expect.any(Number),
      }),
    )
    expect(json).toHaveProperty('tables')
    expect(Array.isArray(json.tables)).toBe(true)
    for (const t of json.tables) {
      expect(t).toHaveProperty('compatibility')
      expect(['ok', 'risky', 'blocked']).toContain(t.compatibility)
      expect(t).toHaveProperty('compatibilityReasons')
    }
  }, 30_000)

  it("classifies the JPA fixture's tables as ok (all UUID PKs, real enums)", () => {
    const { stdout } = runCli(['inspect', '--jpa', JPA_FIXTURE, '--json', '--quiet'])
    const json = JSON.parse(stdout)
    // The fixture entities all have @MappedSuperclass-inherited UUID
    // PKs, real enum constants, and named columns. None should be
    // blocked; risky may or may not be empty depending on fields.
    expect(json.summary.compatibility.blocked).toBe(0)
    // All 4 tables in fixture are well-formed.
    expect(json.tables).toHaveLength(4)
  }, 30_000)
})

describe('seedforge --inspect (legacy, e2e)', () => {
  it('still works and emits the deprecation hint on stderr', () => {
    const { stdout, stderr, status } = runCli(['--inspect', '--jpa', JPA_FIXTURE, '--yes'])
    expect(status).toBe(0)
    expect(stdout).toContain('seedforge schema inspection')
    expect(stderr).toContain('seedforge inspect')
    expect(stderr).toMatch(/preferred|prefer/)
  }, 30_000)

  it('suppresses the deprecation hint with --quiet', () => {
    const { stderr, status } = runCli(['--inspect', '--jpa', JPA_FIXTURE, '--yes', '--quiet'])
    expect(status).toBe(0)
    expect(stderr).not.toContain('preferred')
  }, 30_000)
})
