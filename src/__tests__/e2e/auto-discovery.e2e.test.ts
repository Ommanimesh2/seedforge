/**
 * E2e coverage for Wave 1.5 — Auto-discovery (suggest, don't choose).
 *
 * Builds six throwaway project fixtures in temp directories and runs
 * the seedforge CLI from inside each. Asserts that discovery follows
 * the explicit precedence rules from PATHWAY.md:
 *
 *   1. --db / parser flag wins (covered by other tests).
 *   2. DATABASE_URL in env → use it (rule 1: live DB is high-fidelity).
 *   3. No source: list every detected option, exit non-zero.
 *   4. --no-auto: bypass discovery, fall through to SF5017.
 *
 * Each test uses a fresh tmpdir so cwd-walking discovery is deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli.ts')

interface ProcResult {
  stdout: string
  stderr: string
  status: number | null
}

function runCli(cwd: string, args: string[], env?: Record<string, string>): ProcResult {
  // Wipe out test runner's DATABASE_URL so each fixture is hermetic.
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env }
  delete cleanEnv.DATABASE_URL
  delete cleanEnv.PG_URL
  delete cleanEnv.POSTGRES_URL

  const result = spawnSync('npx', ['tsx', CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...cleanEnv, ...(env ?? {}) },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

const TEMP_PROJECTS: string[] = []

function mkProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `sf-discover-${name}-`))
  TEMP_PROJECTS.push(root)
  return root
}

beforeAll(() => {
  // Nothing to do — each test scaffolds its own project.
})

afterAll(() => {
  for (const p of TEMP_PROJECTS) {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

describe('auto-discovery (e2e)', () => {
  it('DATABASE_URL in env → auto-used; would attempt connection', () => {
    const root = mkProject('envdb')
    // Bogus URL on purpose: the test asserts seedforge *tries* to use
    // it (rule 1), not that the connection succeeds.
    const { stdout, stderr, status } = runCli(root, ['--inspect', '--yes', '--quiet'], {
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/test',
    })
    // The discovery suggestion is bypassed because env DATABASE_URL is
    // present. The connect call will fail, but the failure mode proves
    // we routed through the live-DB path, not the discovery exit.
    expect(stderr + stdout).not.toMatch(/no schema source specified/i)
    expect(stderr + stdout).not.toMatch(/Detected schema sources/i)
    // Connection failure exits with non-zero.
    expect(status).not.toBe(0)
  }, 60_000)

  it('B: Prisma only, no DATABASE_URL → suggestion list with --prisma', () => {
    const root = mkProject('B')
    mkdirSync(join(root, 'prisma'))
    writeFileSync(
      join(root, 'prisma', 'schema.prisma'),
      'generator client {\n  provider = "prisma-client-js"\n}\n',
    )

    const { stderr, status } = runCli(root, [])
    expect(status).toBe(64)
    expect(stderr).toContain('no schema source specified')
    expect(stderr).toMatch(/Prisma:/)
    expect(stderr).toContain('--prisma prisma/schema.prisma')
  }, 60_000)

  it('C: Prisma + Drizzle, no DATABASE_URL → both listed', () => {
    const root = mkProject('C')
    // Prisma
    mkdirSync(join(root, 'prisma'))
    writeFileSync(
      join(root, 'prisma', 'schema.prisma'),
      'generator client {\n  provider = "prisma-client-js"\n}\n',
    )
    // Drizzle
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'drizzle-orm': '^0.30.0' } }, null, 2),
    )
    mkdirSync(join(root, 'src', 'db'), { recursive: true })
    writeFileSync(
      join(root, 'src', 'db', 'schema.ts'),
      'import { pgTable, text } from "drizzle-orm/pg-core";\n' +
        'export const users = pgTable("users", { id: text("id").primaryKey() });\n',
    )

    const { stderr, status } = runCli(root, [])
    expect(status).toBe(64)
    expect(stderr).toContain('no schema source specified')
    expect(stderr).toMatch(/Prisma:/)
    expect(stderr).toMatch(/Drizzle:/)
    expect(stderr).toContain('--prisma')
    expect(stderr).toContain('--drizzle')
  }, 60_000)

  it('D: empty directory → clean exit with help, non-zero', () => {
    const root = mkProject('D')
    const { stderr, status } = runCli(root, [])
    expect(status).toBe(64)
    expect(stderr).toContain('No schema sources detected')
    expect(stderr).toContain('seedforge --db')
  }, 60_000)

  it('E: pom.xml + JPA entity → suggestion lists --jpa', () => {
    const root = mkProject('E')
    writeFileSync(join(root, 'pom.xml'), '<project></project>\n')
    const entityDir = join(root, 'src', 'main', 'java', 'com', 'demo', 'entity')
    mkdirSync(entityDir, { recursive: true })
    writeFileSync(
      join(entityDir, 'User.java'),
      'package com.demo.entity;\n' +
        'import jakarta.persistence.Entity;\n' +
        '@Entity\n' +
        'public class User { }\n',
    )

    const { stderr, status } = runCli(root, [])
    expect(status).toBe(64)
    expect(stderr).toContain('JPA:')
    expect(stderr).toContain('--jpa src/main/java/com/demo/entity')
  }, 60_000)

  it('redacts the password in the env-var DATABASE_URL banner', () => {
    const root = mkProject('redact')
    const { stdout } = runCli(root, ['--inspect', '--yes'], {
      DATABASE_URL: 'postgres://alice:s3cr3t@127.0.0.1:1/db',
    })
    // We don't care that the connection failed (it will). We care that
    // the banner doesn't print "s3cr3t".
    expect(stdout).not.toContain('s3cr3t')
  }, 60_000)

  it('--no-auto in an empty dir: skips discovery, surfaces SF5017', () => {
    // Empty dir is the cleanest control: --no-auto means "I expect to
    // pass an explicit flag, fail loudly if I forgot." No Prisma file
    // here so we're not testing the inline Prisma auto-detect path.
    const root = mkProject('noauto-empty')
    const { stdout, stderr, status } = runCli(root, ['--no-auto'])
    expect(status).not.toBe(0)
    expect(stderr + stdout).toContain('SF5017')
  }, 60_000)
})
