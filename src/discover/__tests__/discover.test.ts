/**
 * Unit coverage for src/discover. The auto-discovery e2e exercises
 * this through a spawned CLI process, but that doesn't count toward
 * v8 line coverage. These tests run the module in-process against
 * temp directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSources, formatDiscoverySuggestion } from '../index.js'

let projectDir: string
const previousDatabaseUrl = process.env.DATABASE_URL

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'sf-discover-unit-'))
  delete process.env.DATABASE_URL
})

afterEach(() => {
  if (previousDatabaseUrl !== undefined) {
    process.env.DATABASE_URL = previousDatabaseUrl
  } else {
    delete process.env.DATABASE_URL
  }
  try {
    rmSync(projectDir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('discoverSources', () => {
  it('returns no sources for an empty directory', () => {
    const r = discoverSources(projectDir)
    expect(r.sources).toEqual([])
  })

  it('detects DATABASE_URL from process.env', () => {
    process.env.DATABASE_URL = 'postgres://u:p@host:5432/x'
    const r = discoverSources(projectDir)
    const live = r.sources.find((s) => s.kind === 'live-db')
    expect(live).toBeDefined()
    expect(live!.note).toMatch(/env/)
  })

  it('redacts the password in display string', () => {
    process.env.DATABASE_URL = 'postgres://alice:s3cr3t@host:5432/x'
    const r = discoverSources(projectDir)
    const live = r.sources.find((s) => s.kind === 'live-db')!
    expect(live.display).not.toContain('s3cr3t')
    expect(live.display).toContain('***')
    expect(live.raw).toContain('s3cr3t') // raw stays intact for the user
  })

  it('detects DATABASE_URL from .env when env var is unset', () => {
    writeFileSync(join(projectDir, '.env'), 'DATABASE_URL=postgres://u:p@host/db\n')
    const r = discoverSources(projectDir)
    const live = r.sources.find((s) => s.kind === 'live-db')
    expect(live?.note).toMatch(/from \.env/)
  })

  it('detects Prisma when prisma/schema.prisma exists', () => {
    mkdirSync(join(projectDir, 'prisma'))
    writeFileSync(join(projectDir, 'prisma', 'schema.prisma'), '// schema\n')
    const r = discoverSources(projectDir)
    const prisma = r.sources.find((s) => s.kind === 'prisma')
    expect(prisma).toBeDefined()
    expect(prisma!.command).toContain('--prisma')
  })

  it('detects Drizzle from package.json + pgTable() call site', () => {
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ devDependencies: { 'drizzle-orm': '^0.30.0' } }),
    )
    mkdirSync(join(projectDir, 'src', 'db'), { recursive: true })
    writeFileSync(
      join(projectDir, 'src', 'db', 'schema.ts'),
      'import { pgTable, text } from "drizzle-orm/pg-core";\n' +
        'export const u = pgTable("u", { id: text("id").primaryKey() });\n',
    )
    const r = discoverSources(projectDir)
    const dr = r.sources.find((s) => s.kind === 'drizzle')
    expect(dr).toBeDefined()
    expect(dr!.command).toMatch(/--drizzle src\/db\/schema\.ts/)
  })

  it('does not flag Drizzle if package.json lacks drizzle-orm', () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: {} }))
    mkdirSync(join(projectDir, 'src'))
    writeFileSync(join(projectDir, 'src', 'schema.ts'), 'pgTable("x")')
    const r = discoverSources(projectDir)
    expect(r.sources.find((s) => s.kind === 'drizzle')).toBeUndefined()
  })

  it('detects TypeORM from package.json + @Entity() in .ts', () => {
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { typeorm: '^0.3.0' } }),
    )
    mkdirSync(join(projectDir, 'src', 'entities'), { recursive: true })
    writeFileSync(
      join(projectDir, 'src', 'entities', 'User.ts'),
      '@Entity()\nexport class User {}\n',
    )
    const r = discoverSources(projectDir)
    const t = r.sources.find((s) => s.kind === 'typeorm')
    expect(t).toBeDefined()
    expect(t!.command).toContain('--typeorm src/entities')
  })

  it('detects JPA from pom.xml + @Entity in .java', () => {
    writeFileSync(join(projectDir, 'pom.xml'), '<project></project>\n')
    const dir = join(projectDir, 'src', 'main', 'java', 'a', 'b')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'X.java'),
      'package a.b;\nimport jakarta.persistence.Entity;\n@Entity\npublic class X {}\n',
    )
    const r = discoverSources(projectDir)
    const j = r.sources.find((s) => s.kind === 'jpa')
    expect(j).toBeDefined()
    expect(j!.command).toContain('--jpa src/main/java/a/b')
  })

  it('skips JPA detection if no project marker file exists', () => {
    // src/main/java/foo/Bar.java without pom.xml or build.gradle
    const dir = join(projectDir, 'src', 'main', 'java', 'foo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Bar.java'), '@Entity\npublic class Bar {}')
    const r = discoverSources(projectDir)
    expect(r.sources.find((s) => s.kind === 'jpa')).toBeUndefined()
  })

  it('detects docker-compose with a postgres service (informational)', () => {
    writeFileSync(
      join(projectDir, 'docker-compose.yml'),
      'services:\n  db:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n',
    )
    const r = discoverSources(projectDir)
    const c = r.sources.find((s) => s.kind === 'docker-compose')
    expect(c).toBeDefined()
    expect(c!.display).toContain('postgres')
  })

  it('skips docker-compose if no postgres/mysql service', () => {
    writeFileSync(join(projectDir, 'docker-compose.yml'), 'services:\n  redis:\n    image: redis\n')
    const r = discoverSources(projectDir)
    expect(r.sources.find((s) => s.kind === 'docker-compose')).toBeUndefined()
  })

  it('returns multiple sources when more than one is present', () => {
    mkdirSync(join(projectDir, 'prisma'))
    writeFileSync(join(projectDir, 'prisma', 'schema.prisma'), '// schema')
    writeFileSync(join(projectDir, '.env'), 'DATABASE_URL=postgres://u:p@h/db\n')
    const r = discoverSources(projectDir)
    expect(r.sources.find((s) => s.kind === 'live-db')).toBeDefined()
    expect(r.sources.find((s) => s.kind === 'prisma')).toBeDefined()
  })

  it('handles malformed package.json gracefully', () => {
    writeFileSync(join(projectDir, 'package.json'), '{ this is not JSON')
    const r = discoverSources(projectDir)
    // Should not throw; just produces no Drizzle/TypeORM hits.
    expect(r.sources.find((s) => s.kind === 'drizzle')).toBeUndefined()
  })
})

describe('formatDiscoverySuggestion', () => {
  it('renders the empty-cwd hint when nothing was found', () => {
    const out = formatDiscoverySuggestion({ sources: [], scanned: [] })
    expect(out).toContain('No schema sources detected')
    expect(out).toContain('seedforge --db')
    expect(out).toContain('seedforge --prisma')
  })

  it('lists every detected source with its command', () => {
    const out = formatDiscoverySuggestion({
      sources: [
        {
          kind: 'prisma',
          display: 'prisma/schema.prisma',
          command: 'seedforge --prisma prisma/schema.prisma',
          raw: 'prisma/schema.prisma',
        },
        {
          kind: 'live-db',
          display: 'postgres://***@host/db',
          command: 'seedforge --db "postgres://u:p@host/db"',
          raw: 'postgres://u:p@host/db',
          note: 'from .env',
        },
      ],
      scanned: [],
    })
    expect(out).toContain('Prisma:')
    expect(out).toContain('Live DB:')
    expect(out).toContain('seedforge --prisma prisma/schema.prisma')
    expect(out).toContain('seedforge --db')
    expect(out).toContain('Live DB gives insertion fidelity')
  })
})
