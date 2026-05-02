/**
 * E2e coverage for Wave 1.2 — README rewrite.
 *
 * Prevents documentation rot: every code block in the README tagged
 * with the `seedforge-test` info string is extracted and executed
 * against a temp SQLite database. If a copy-paste from the README
 * doesn't run, this test fails before the regression ships.
 *
 * Tagging convention:
 *
 *     ```bash seedforge-test
 *     seedforge --db "$DATABASE_URL" --count 5 ...
 *     ```
 *
 * Untagged blocks (`bash`, `typescript`, etc.) are not executed.
 *
 * Substitutions:
 *   - `$DATABASE_URL` is replaced with a fresh SQLite tempfile per
 *     snippet so blocks remain hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')
const README_PATH = join(REPO_ROOT, 'README.md')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli.ts')

interface ExtractedBlock {
  index: number
  code: string
}

/**
 * Walk the README looking for fenced code blocks tagged
 * `seedforge-test` (anywhere in the info string), and return their
 * code bodies in document order.
 */
export function extractTaggedBlocks(markdown: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = []
  const lines = markdown.split('\n')
  let inBlock = false
  let isTagged = false
  let buf: string[] = []
  let blockIdx = 0
  for (const line of lines) {
    const fence = line.match(/^```(.*)$/)
    if (fence) {
      if (!inBlock) {
        inBlock = true
        const info = fence[1].trim()
        isTagged = /\bseedforge-test\b/.test(info)
        buf = []
      } else {
        if (isTagged) {
          blocks.push({ index: blockIdx++, code: buf.join('\n') })
        }
        inBlock = false
        isTagged = false
      }
      continue
    }
    if (inBlock && isTagged) buf.push(line)
  }
  return blocks
}

let workdir: string

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'sf-readme-'))
})

afterAll(() => {
  try {
    rmSync(workdir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('README snippets (e2e)', () => {
  it('finds at least one runnable block tagged `seedforge-test`', () => {
    const md = readFileSync(README_PATH, 'utf-8')
    const blocks = extractTaggedBlocks(md)
    // The README should always have at least one tagged block — if
    // someone removes the convention, this fails so they can decide
    // explicitly whether to drop the test or re-tag.
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('executes every tagged block against a fresh SQLite DB', () => {
    const md = readFileSync(README_PATH, 'utf-8')
    const blocks = extractTaggedBlocks(md)

    for (const block of blocks) {
      // Each snippet gets its own DB so they're independent.
      const dbPath = join(workdir, `snippet-${block.index}.db`)
      // Seed a tiny but realistic schema so the snippet has something
      // to inspect/seed.
      const db = new Database(dbPath)
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id)
        );
      `)
      db.close()

      // Translate the snippet:
      //   - replace `$DATABASE_URL` with the SQLite URL
      //   - rewrite `seedforge ...` as `npx tsx <CLI_PATH> ...` so we
      //     run the in-tree CLI (the published binary may be older)
      const sqliteUrl = `sqlite://${dbPath}`
      const rewrittenLines = block.code
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .map((l) => {
          let out = l.replace(/\$DATABASE_URL/g, sqliteUrl)
          out = out.replace(/\bnpx\s+@otg-dev\/seedforge\b/, '')
          out = out.replace(/^seedforge\b/, '')
          return out.trim()
        })
        .filter((l) => l.length > 0)

      // Each line is one CLI invocation.
      for (const argline of rewrittenLines) {
        const args = parseArgs(argline)
        const result = spawnSync('npx', ['tsx', CLI_PATH, ...args], {
          cwd: workdir,
          encoding: 'utf-8',
          env: { ...process.env, DATABASE_URL: sqliteUrl },
        })
        if (result.status !== 0) {
          // Surface a useful failure: which block, what command, what
          // came back on stderr.
          throw new Error(
            `README snippet #${block.index} failed (${args.join(' ')}):\n` +
              `${result.stderr}\n${result.stdout}`,
          )
        }
      }
    }
  }, 120_000)

  it('does not execute untagged blocks (regression guard)', () => {
    // Synthesize a markdown sample to keep the assertion local.
    const md = [
      '```bash',
      'echo this should NOT run',
      '```',
      '```bash seedforge-test',
      'echo this SHOULD run',
      '```',
    ].join('\n')
    const blocks = extractTaggedBlocks(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].code.trim()).toBe('echo this SHOULD run')
  })
})

/**
 * Split a CLI invocation into argv. Handles double-quoted spans
 * (which is what the README uses around "$DATABASE_URL") but not
 * full POSIX shell quoting — keep snippet inputs simple.
 */
function parseArgs(line: string): string[] {
  const args: string[] = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (ch === ' ' && !inQuote) {
      if (buf.length > 0) {
        args.push(buf)
        buf = ''
      }
      continue
    }
    buf += ch
  }
  if (buf.length > 0) args.push(buf)
  return args
}
