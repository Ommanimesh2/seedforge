# seedforge v1 Roadmap

## Phase 1: Project Scaffolding & Core Types
**Goal:** TypeScript project setup, internal schema representation, and CLI skeleton.

### Success Criteria
- [ ] TypeScript project with ESM, vitest, eslint configured
- [ ] Internal schema types defined (DatabaseSchema, TableDef, ColumnDef, NormalizedType, etc.)
- [ ] CLI skeleton with commander: `seedforge` command with `--db`, `--count`, `--seed`, `--dry-run`, `--output` flags
- [ ] Error system with categorized codes (SeedForgeError base class + subtypes)
- [ ] Package.json with `bin` entry, correct exports

### Requirements Covered
REQ-C01, REQ-C05, REQ-C06, REQ-C07, REQ-C08, REQ-C12, REQ-C14

---

## Phase 2: PostgreSQL Schema Introspection
**Goal:** Connect to PostgreSQL and extract complete schema metadata.

### Success Criteria
- [ ] Connect via connection string, handle auth/connection errors gracefully
- [ ] Introspect: tables, columns (types, nullable, defaults, generated), primary keys, foreign keys
- [ ] Introspect: PostgreSQL enum types with values
- [ ] Introspect: CHECK constraints with enum-like value extraction
- [ ] Introspect: composite PKs and FKs
- [ ] Connection string redaction in all error output
- [ ] Production hostname detection + confirmation prompt
- [ ] Integration tests with testcontainers

### Requirements Covered
REQ-E01, REQ-E09, REQ-E10, REQ-C03, REQ-C10, REQ-C16

---

## Phase 3: Dependency Resolution
**Goal:** Build FK dependency graph, topological sort, and circular dependency handling.

### Success Criteria
- [ ] Build directed graph from FK relationships
- [ ] Kahn's algorithm topological sort
- [ ] Cycle detection with clear reporting
- [ ] Cycle resolution: break at nullable FK edges
- [ ] Self-referencing table handling (NULL-then-UPDATE)
- [ ] Deferred constraints fallback for PG
- [ ] Unit tests for all graph topologies (linear, diamond, cycle, self-ref)

### Requirements Covered
REQ-E02, REQ-E03, REQ-E04

---

## Phase 4: Column-to-Faker Mapping
**Goal:** Semantic heuristic engine mapping column names/types to Faker generators.

### Success Criteria
- [ ] 80+ column name patterns across 10 domains (person, contact, internet, location, finance, commerce, text, identifiers, temporal, boolean)
- [ ] 3-tier detection: exact name → pattern/suffix/prefix → type fallback
- [ ] Confidence scoring (HIGH/MEDIUM/LOW) per mapping
- [ ] Enum/CHECK constraint values used when detected
- [ ] Table name prefix stripping (users.user_email → email match)
- [ ] Deterministic output via faker.seed()
- [ ] Unit tests for all mapping categories

### Requirements Covered
REQ-E05, REQ-E06, REQ-G01, REQ-G02, REQ-G03

---

## Phase 5: Data Generation Engine
**Goal:** Generate rows respecting all constraints, relationships, and existing data.

### Success Criteria
- [ ] Generate rows in topological order with FK reference resolution
- [ ] Existing data awareness: row count check, unique value sampling, sequence state
- [ ] FK reference pool merging (existing + new)
- [ ] Unique value generation with counter/suffix strategy
- [ ] RFC 2606 email domains (@example.com)
- [ ] Configurable row counts (global + per-table)
- [ ] Nullable rate control (configurable %)
- [ ] Timestamp ordering (created_at < updated_at)
- [ ] UUID PK generation
- [ ] JSON/JSONB default generation
- [ ] Composite FK tuple selection (not column mixing)
- [ ] Two-phase insert for cyclic/self-ref tables (INSERT NULL → UPDATE)

### Requirements Covered
REQ-E07, REQ-E08, REQ-G04, REQ-G05, REQ-G06, REQ-G07, REQ-G08, REQ-G09, REQ-G10

---

## Phase 6: Output & Insertion
**Goal:** Direct database insertion and SQL file export.

### Success Criteria
- [ ] Batched multi-row INSERT execution with progress bars
- [ ] SQL file export with pg-format safe escaping
- [ ] Dry-run mode (generate + display, no execute)
- [ ] Auto-reset sequences after seeding (setval)
- [ ] Transaction wrapping per table
- [ ] Summary report: rows inserted, tables, time, warnings
- [ ] Proper exit codes

### Requirements Covered
REQ-O01, REQ-O02, REQ-O03, REQ-O04, REQ-O05, REQ-O06, REQ-O07

---

## Phase 7: Configuration System
**Goal:** .seedforge.yml parsing, column overrides, table exclusions.

### Success Criteria
- [ ] YAML config file parsing
- [ ] Column-level generator overrides
- [ ] Value arrays with optional weights
- [ ] Table exclusion patterns (glob support)
- [ ] Virtual FK declarations
- [ ] Environment variable interpolation (${VAR})
- [ ] Config validation with actionable errors
- [ ] CLI flags override config values

### Requirements Covered
REQ-C02, REQ-C11, REQ-C13

---

## Phase 8: CLI Polish & Release
**Goal:** Production-quality CLI experience, verbose/quiet modes, JSON output, npm publish.

### Success Criteria
- [ ] --verbose / --quiet / --debug logging tiers
- [ ] --json flag for machine-readable output
- [ ] NO_COLOR support
- [ ] Help text with examples
- [ ] README with demo GIF, quick start, API docs
- [ ] npm package published as `seedforge`
- [ ] GitHub repo setup (license, contributing, issue templates)
- [ ] End-to-end integration test: empty DB → seedforge → query realistic data

### Requirements Covered
REQ-C04, REQ-C09, REQ-C15

---

## Phase Dependencies

```
Phase 1 (Scaffolding)
   │
   ├──→ Phase 2 (Introspection)
   │       │
   │       ├──→ Phase 3 (Dependency Resolution)
   │       │       │
   │       │       └──→ Phase 5 (Generation Engine) ──→ Phase 6 (Output)
   │       │                                                  │
   │       └──→ Phase 4 (Faker Mapping) ─────────────────────┘
   │                                                          │
   └──→ Phase 7 (Config) ────────────────────────────────────┘
                                                              │
                                                              └──→ Phase 8 (Polish & Release)
```

Phases 3 & 4 can run in parallel after Phase 2.
Phase 7 can start after Phase 1 and integrates with Phase 5/6.
Phase 8 is the final integration phase.
