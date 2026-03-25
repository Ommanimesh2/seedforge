# Phase 1: Project Scaffolding & Core Types

**Goal:** TypeScript project setup, internal schema representation, CLI skeleton, and error system.

**Requirements:** REQ-C01, REQ-C05, REQ-C06, REQ-C07, REQ-C08, REQ-C12, REQ-C14

---

## Wave 1: Project Initialization
*All tasks are independent — run in parallel.*

### Task 1.1.1: Initialize npm project
- Create `package.json` with:
  - name: `seedforge`
  - type: `module` (ESM)
  - version: `0.1.0`
  - bin: `{ "seedforge": "./dist/cli.js" }`
  - scripts: build, test, lint, dev
  - engines: `{ "node": ">=18" }`
  - license: MIT
  - description, keywords, repository fields
- Install runtime deps: `pg`, `@faker-js/faker`, `commander`, `pg-format`, `yaml`
- Install dev deps: `typescript`, `vitest`, `eslint`, `@types/pg`, `@types/pg-format`, `tsx`

### Task 1.1.2: TypeScript configuration
- Create `tsconfig.json`:
  - target: ES2022
  - module: NodeNext / moduleResolution: NodeNext
  - outDir: `./dist`
  - rootDir: `./src`
  - strict: true
  - declaration: true
  - sourceMap: true
  - esModuleInterop: true

### Task 1.1.3: ESLint configuration
- Create `eslint.config.js` (flat config)
- TypeScript plugin + recommended rules
- No semicolons, single quotes (or defer to Prettier defaults)

### Task 1.1.4: Vitest configuration
- Create `vitest.config.ts`
- Include `src/**/*.test.ts`
- Coverage provider: v8
- Globals: true

### Task 1.1.5: Project structure & .gitignore
- Create directory structure:
  ```
  src/
    cli.ts            (CLI entry point)
    index.ts          (library entry point)
    types/            (schema types)
    errors/           (error system)
    introspect/       (Phase 2)
    graph/            (Phase 3)
    mapping/          (Phase 4)
    generate/         (Phase 5)
    output/           (Phase 6)
    config/           (Phase 7)
  ```
- Create `.gitignore` (node_modules, dist, coverage, .env, *.tgz)

---

## Wave 2: Core Types & Error System
*Tasks 2.1 and 2.2 are independent — run in parallel. Task 2.3 depends on 2.2.*

### Task 1.2.1: Internal schema types
File: `src/types/schema.ts`

Define all types from architecture research:
- `NormalizedType` enum (TEXT, VARCHAR, INTEGER, BIGINT, BOOLEAN, DATE, TIMESTAMP, TIMESTAMPTZ, UUID, JSON, JSONB, ENUM, ARRAY, BYTEA, INET, REAL, DOUBLE, DECIMAL, INTERVAL, POINT, UNKNOWN)
- `ColumnDef` interface (name, dataType, nativeType, isNullable, hasDefault, defaultValue, isAutoIncrement, isGenerated, maxLength, numericPrecision, numericScale, enumValues, comment)
- `PrimaryKeyDef` interface (columns[], name)
- `ForeignKeyDef` interface (name, columns[], referencedTable, referencedSchema, referencedColumns[], onDelete, onUpdate, isDeferrable, isDeferred, isVirtual)
- `FKAction` enum (CASCADE, SET_NULL, SET_DEFAULT, RESTRICT, NO_ACTION)
- `UniqueConstraintDef` interface (columns[], name)
- `CheckConstraintDef` interface (expression, name, inferredValues)
- `IndexDef` interface (columns[], name, isUnique)
- `TableDef` interface (name, schema, columns, primaryKey, foreignKeys, uniqueConstraints, checkConstraints, indexes, comment)
- `DatabaseSchema` interface (name, tables, enums, schemas)

Export all types from `src/types/index.ts`

### Task 1.2.2: Error system
File: `src/errors/index.ts`

- `SeedForgeError` base class extending Error:
  - `code: string` (e.g., "SF1001")
  - `hints: string[]`
  - `context: Record<string, unknown>`
  - `render(): string` method for formatted CLI output
- Subtypes:
  - `ConnectionError` (SF1xxx)
  - `IntrospectError` (SF2xxx)
  - `GenerationError` (SF3xxx)
  - `InsertionError` (SF4xxx)
  - `ConfigError` (SF5xxx)
  - `PluginError` (SF6xxx)
- Factory functions for common errors (e.g., `connectionFailed(host, port)`)

File: `src/errors/redact.ts`
- `redactConnectionString(url: string): string` — replaces password with `***`
- Used everywhere connection strings appear in logs/errors

### Task 1.2.3: Error system tests
File: `src/errors/__tests__/errors.test.ts`

- Test each error subtype creates correct code prefix
- Test `render()` output format includes code, message, hints
- Test `redactConnectionString()` with various URL formats:
  - `postgres://user:password@host:5432/db` → `postgres://user:***@host:5432/db`
  - `postgres://user@host/db` (no password) → unchanged
  - `postgres://user:p%40ss@host/db` (URL-encoded) → redacted

---

## Wave 3: CLI Skeleton
*Depends on Wave 1 (project setup) and Wave 2 (types/errors).*

### Task 1.3.1: CLI entry point
File: `src/cli.ts`

- Shebang: `#!/usr/bin/env node`
- Commander program setup:
  - name: `seedforge`
  - description: "Generate realistic seed data from your database schema"
  - version: from package.json
- Flags:
  - `--db <url>` (required) — PostgreSQL connection string
  - `--count <number>` (default: 50) — rows per table
  - `--seed <number>` — PRNG seed for deterministic output
  - `--dry-run` — preview without executing
  - `--output <file>` — SQL file export path
  - `--schema <name>` (default: "public") — database schema
  - `--exclude <tables...>` — tables to skip
  - `--verbose` / `--quiet` / `--debug` — logging tiers
  - `--json` — machine-readable output
  - `--yes` — skip confirmation prompts
- Action handler: stub that prints parsed options (filled in Phase 2+)
- Exit code handling: 0/1/2

### Task 1.3.2: CLI tests
File: `src/cli.test.ts`

- Test `--help` output includes all flags
- Test `--version` outputs correct version
- Test flag parsing (count parsed as number, exclude as array)
- Test missing --db shows error with hint

### Task 1.3.3: Build & bin verification
- Verify `npm run build` produces `dist/cli.js` with shebang
- Verify `node dist/cli.js --help` works
- Verify `node dist/cli.js --version` works
- Add `prepublishOnly` script that runs build

---

## Completion Checklist

- [ ] `npm install` succeeds
- [ ] `npm run build` produces dist/ with correct ESM output
- [ ] `npm test` runs all tests green
- [ ] `npm run lint` passes
- [ ] `node dist/cli.js --help` shows all flags
- [ ] `node dist/cli.js --version` shows 0.1.0
- [ ] All schema types compile correctly
- [ ] Error system renders formatted output with codes and hints
- [ ] Connection string redaction works
- [ ] Package.json has correct bin, exports, and metadata

---

## Files Created

```
package.json
tsconfig.json
eslint.config.js
vitest.config.ts
.gitignore
src/
  cli.ts
  index.ts
  types/
    schema.ts
    index.ts
  errors/
    index.ts
    redact.ts
    __tests__/
      errors.test.ts
```
