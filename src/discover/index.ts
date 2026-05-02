/**
 * Auto-discovery — walk the project's working directory looking for
 * schema sources seedforge can read, and surface them as concrete
 * suggestions. Discovery never silently chooses between sources of
 * different fidelity (live DB vs. parser); the user always picks.
 *
 * See `.planning/v2/PATHWAY.md` Wave 1.5 for design rules.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type DiscoverySourceKind =
  | 'live-db' // env var or .env DATABASE_URL
  | 'prisma' // prisma/schema.prisma
  | 'drizzle' // package.json drizzle dep + pgTable/mysqlTable/sqliteTable calls
  | 'typeorm' // package.json typeorm dep + @Entity() in *.ts
  | 'jpa' // pom.xml/build.gradle + @Entity in *.java
  | 'docker-compose' // docker-compose service that's likely a target

export interface DiscoveredSource {
  kind: DiscoverySourceKind
  /** Display path or URL. Live-db sources hide the password. */
  display: string
  /** Concrete CLI invocation the user can run. */
  command: string
  /** Raw value (path / URL); not necessarily safe to log. */
  raw: string
  /** Optional notes (e.g. "from .env", "from package.json"). */
  note?: string
}

export interface DiscoveryResult {
  sources: DiscoveredSource[]
  /**
   * Walked-cwd evidence — files seedforge looked at. Useful for the
   * "I don't see what I expected" debugging path.
   */
  scanned: string[]
}

const TS_GLOB_DIRS = ['src', 'app', 'lib']
const MAX_FILES_TO_SCAN = 200

export function discoverSources(cwd: string): DiscoveryResult {
  const sources: DiscoveredSource[] = []
  const scanned: string[] = []

  // 1. Live DB via DATABASE_URL (env or .env*).
  const live = detectDatabaseUrl(cwd, scanned)
  if (live) sources.push(live)

  // 2. Prisma.
  const prisma = detectPrisma(cwd, scanned)
  if (prisma) sources.push(prisma)

  // 3. Drizzle / TypeORM (driven by package.json).
  const pkg = detectPackageJson(cwd, scanned)
  if (pkg) {
    const drizzle = detectDrizzle(cwd, pkg, scanned)
    if (drizzle) sources.push(drizzle)
    const typeorm = detectTypeorm(cwd, pkg, scanned)
    if (typeorm) sources.push(typeorm)
  }

  // 4. JPA (driven by pom.xml or build.gradle).
  const jpa = detectJpa(cwd, scanned)
  if (jpa) sources.push(jpa)

  // 5. docker-compose service hint (informational only).
  const compose = detectDockerCompose(cwd, scanned)
  if (compose) sources.push(compose)

  return { sources, scanned }
}

function detectDatabaseUrl(cwd: string, scanned: string[]): DiscoveredSource | null {
  // Env var wins over .env files.
  const fromEnv = process.env.DATABASE_URL
  if (fromEnv && fromEnv.trim().length > 0) {
    return {
      kind: 'live-db',
      display: redactCredentials(fromEnv),
      command: `seedforge --db "${fromEnv}"`,
      raw: fromEnv,
      note: 'from DATABASE_URL env var',
    }
  }

  for (const file of ['.env', '.env.local', '.env.development']) {
    const p = join(cwd, file)
    if (!existsSync(p)) continue
    scanned.push(p)
    const text = safeRead(p)
    if (!text) continue
    const m = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n\r]+)"?\s*$/m)
    if (m) {
      const url = m[1].replace(/^['"]|['"]$/g, '').trim()
      return {
        kind: 'live-db',
        display: redactCredentials(url),
        command: `seedforge --db "${url}"`,
        raw: url,
        note: `from ${file}`,
      }
    }
  }

  return null
}

function detectPrisma(cwd: string, scanned: string[]): DiscoveredSource | null {
  const p = join(cwd, 'prisma', 'schema.prisma')
  if (!existsSync(p)) return null
  scanned.push(p)
  return {
    kind: 'prisma',
    display: 'prisma/schema.prisma',
    command: `seedforge --prisma prisma/schema.prisma`,
    raw: p,
  }
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function detectPackageJson(cwd: string, scanned: string[]): PackageJson | null {
  const p = join(cwd, 'package.json')
  if (!existsSync(p)) return null
  scanned.push(p)
  const text = safeRead(p)
  if (!text) return null
  try {
    return JSON.parse(text) as PackageJson
  } catch {
    return null
  }
}

function hasDep(pkg: PackageJson, name: string): boolean {
  return Boolean(
    pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name],
  )
}

function detectDrizzle(cwd: string, pkg: PackageJson, scanned: string[]): DiscoveredSource | null {
  if (!hasDep(pkg, 'drizzle-orm')) return null
  // Find the first .ts file under src/app/lib that calls
  // pgTable(/mysqlTable(/sqliteTable(.
  const candidate = findFirstFileMatching(
    cwd,
    TS_GLOB_DIRS,
    /\.(ts|js)$/,
    /\b(pgTable|mysqlTable|sqliteTable)\s*\(/,
    scanned,
  )
  if (!candidate) return null
  return {
    kind: 'drizzle',
    display: candidate.relPath,
    command: `seedforge --drizzle ${candidate.relPath}`,
    raw: candidate.absPath,
    note: 'drizzle-orm in package.json',
  }
}

function detectTypeorm(cwd: string, pkg: PackageJson, scanned: string[]): DiscoveredSource | null {
  if (!hasDep(pkg, 'typeorm')) return null
  // Find a directory that contains @Entity() decorators in .ts files.
  const candidate = findFirstFileMatching(cwd, TS_GLOB_DIRS, /\.ts$/, /@Entity\s*\(/, scanned)
  if (!candidate) return null
  // Suggest the parent dir (TypeORM parser takes a directory).
  const parts = candidate.relPath.split('/')
  parts.pop() // drop filename
  const dir = parts.join('/') || '.'
  return {
    kind: 'typeorm',
    display: dir,
    command: `seedforge --typeorm ${dir}`,
    raw: dir,
    note: 'typeorm in package.json',
  }
}

function detectJpa(cwd: string, scanned: string[]): DiscoveredSource | null {
  // Project marker first.
  const markers = ['pom.xml', 'build.gradle', 'build.gradle.kts']
  let hasMarker = false
  for (const m of markers) {
    const p = join(cwd, m)
    if (existsSync(p)) {
      scanned.push(p)
      hasMarker = true
      break
    }
  }
  if (!hasMarker) return null

  // Find @Entity in a .java file under src/main/java.
  const javaRoot = join(cwd, 'src', 'main', 'java')
  if (!existsSync(javaRoot)) return null
  const candidate = findFirstFileMatching(cwd, ['src/main/java'], /\.java$/, /@Entity\b/, scanned)
  if (!candidate) return null
  // Suggest the directory containing the entity (JPA parser takes a dir).
  const parts = candidate.relPath.split('/')
  parts.pop()
  const dir = parts.join('/') || '.'
  return {
    kind: 'jpa',
    display: dir,
    command: `seedforge --jpa ${dir}`,
    raw: dir,
    note: 'pom.xml/build.gradle present',
  }
}

function detectDockerCompose(cwd: string, scanned: string[]): DiscoveredSource | null {
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml']) {
    const p = join(cwd, f)
    if (!existsSync(p)) continue
    scanned.push(p)
    const text = safeRead(p) ?? ''
    if (!/postgres|mysql/i.test(text)) continue
    // Best-effort: extract the first published port for postgres/mysql.
    const portMatch = text.match(/\b(5432|3306)\b/)
    const port = portMatch ? portMatch[1] : '5432'
    const dialect = port === '3306' ? 'mysql' : 'postgres'
    return {
      kind: 'docker-compose',
      display: `${f} (${dialect} on :${port})`,
      command: `seedforge --db "${dialect}://user:pass@localhost:${port}/dbname"`,
      raw: f,
      note: 'docker-compose service detected — fill in user/pass/db',
    }
  }
  return null
}

// ─── helpers ────────────────────────────────────────────────────────────

function safeRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}

function redactCredentials(url: string): string {
  return url.replace(/(:\/\/[^:@/]+):([^@]+)@/, '$1:***@')
}

function findFirstFileMatching(
  cwd: string,
  searchDirs: string[],
  fileNameRe: RegExp,
  contentRe: RegExp,
  scanned: string[],
): { absPath: string; relPath: string } | null {
  let scanCount = 0
  for (const sd of searchDirs) {
    const start = join(cwd, sd)
    if (!existsSync(start)) continue
    const found = walkAndMatch(start, cwd, fileNameRe, contentRe, scanned, () => {
      scanCount++
      return scanCount > MAX_FILES_TO_SCAN
    })
    if (found) return found
  }
  return null
}

function walkAndMatch(
  dir: string,
  cwd: string,
  fileNameRe: RegExp,
  contentRe: RegExp,
  scanned: string[],
  shouldStop: () => boolean,
): { absPath: string; relPath: string } | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      const found = walkAndMatch(full, cwd, fileNameRe, contentRe, scanned, shouldStop)
      if (found) return found
      if (shouldStop()) return null
      continue
    }
    if (!fileNameRe.test(entry)) continue
    if (shouldStop()) return null
    const text = safeRead(full)
    if (!text) continue
    if (contentRe.test(text)) {
      scanned.push(full)
      return { absPath: full, relPath: full.slice(cwd.length + 1) }
    }
  }
  return null
}

/**
 * Format a `DiscoveryResult` as an actionable user-facing message.
 * Used when no `--db` / parser flag is given AND no `DATABASE_URL`
 * is set — we list options and exit non-zero rather than silently
 * picking one.
 */
export function formatDiscoverySuggestion(result: DiscoveryResult): string {
  const lines: string[] = []
  lines.push('seedforge: no schema source specified.')
  lines.push('')

  if (result.sources.length === 0) {
    lines.push('No schema sources detected in the current directory.')
    lines.push('')
    lines.push('Run one of:')
    lines.push('  seedforge --db postgres://localhost:5432/yourdb')
    lines.push('  seedforge --prisma prisma/schema.prisma')
    lines.push('  seedforge --drizzle src/db/schema.ts')
    lines.push('  seedforge --jpa src/main/java/com/example/entities/')
    lines.push('  seedforge --typeorm src/entities/')
    return lines.join('\n')
  }

  lines.push('Detected schema sources in this project:')
  for (const s of result.sources) {
    const kindLabel = describeKind(s.kind)
    const noteSuffix = s.note ? ` — ${s.note}` : ''
    lines.push(`  • ${kindLabel.padEnd(14)} ${s.display}${noteSuffix}`)
  }
  lines.push('')
  lines.push('Run one of:')
  for (const s of result.sources) {
    lines.push(`  ${s.command}`)
  }
  lines.push('')
  lines.push('Live DB gives insertion fidelity (defaults, triggers, sequences).')
  lines.push('Parser-based runs are portable and reproducible. Pick the one')
  lines.push('that matches your workflow.')
  return lines.join('\n')
}

function describeKind(k: DiscoverySourceKind): string {
  switch (k) {
    case 'live-db':
      return 'Live DB:'
    case 'prisma':
      return 'Prisma:'
    case 'drizzle':
      return 'Drizzle:'
    case 'typeorm':
      return 'TypeORM:'
    case 'jpa':
      return 'JPA:'
    case 'docker-compose':
      return 'Compose:'
  }
}
