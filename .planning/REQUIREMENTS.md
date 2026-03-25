# seedforge v1 Requirements

## Core Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-E01 | Connect to PostgreSQL via connection string and introspect schema (tables, columns, types, FKs, enums, CHECK constraints, defaults, generated columns) | P0 |
| REQ-E02 | Build FK dependency graph and resolve insert order via topological sort (Kahn's algorithm) | P0 |
| REQ-E03 | Auto-detect and resolve circular FK dependencies (break at nullable edges, deferred constraints fallback) | P0 |
| REQ-E04 | Handle self-referencing tables (insert with NULL, then UPDATE) | P0 |
| REQ-E05 | Map column names to Faker generators using 3-tier heuristic (exact name → pattern/suffix → type fallback) with 80+ patterns | P0 |
| REQ-E06 | Report confidence level (HIGH/MEDIUM/LOW) for each column mapping in verbose mode | P1 |
| REQ-E07 | Check existing data before generation: row counts, sequence state, unique value sampling | P0 |
| REQ-E08 | Merge FK reference pools (existing IDs + newly generated IDs) | P0 |
| REQ-E09 | Detect and exclude generated columns (GENERATED ALWAYS AS) from INSERT statements | P0 |
| REQ-E10 | Support composite primary keys and composite foreign keys | P1 |

## Data Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-G01 | Deterministic output: same seed value produces identical data across runs | P0 |
| REQ-G02 | Auto-detect PostgreSQL enum types and use actual enum values | P0 |
| REQ-G03 | Parse CHECK constraints for enum-like expressions (e.g., `status IN ('a','b','c')`) | P0 |
| REQ-G04 | Configurable row count: global default (50) + per-table overrides | P0 |
| REQ-G05 | Configurable nullable rate for nullable columns (default 10-15%) | P1 |
| REQ-G06 | Unique value generation with counter/suffix strategy to avoid collisions | P0 |
| REQ-G07 | Use RFC 2606 reserved domains (@example.com) for generated emails | P0 |
| REQ-G08 | Timestamp ordering: detect `created_at`/`updated_at` pairs, generate chronologically | P1 |
| REQ-G09 | UUID primary key support via faker.string.uuid() | P0 |
| REQ-G10 | JSON/JSONB columns: generate empty object by default, configurable via config | P1 |

## Output

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-O01 | Direct database insertion with batched multi-row INSERTs | P0 |
| REQ-O02 | Progress bars showing per-table generation status | P0 |
| REQ-O03 | SQL file export with safe escaping (pg-format) | P0 |
| REQ-O04 | Dry-run mode: preview generated data/SQL without executing | P0 |
| REQ-O05 | Auto-reset PostgreSQL sequences after seeding (setval to max ID) | P0 |
| REQ-O06 | Transaction wrapping: one transaction per table by default | P1 |
| REQ-O07 | Report summary: rows inserted, tables seeded, time elapsed, warnings | P0 |

## CLI & Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-C01 | Zero-config: `npx seedforge --db <connection_string>` just works | P0 |
| REQ-C02 | `.seedforge.yml` config file with column overrides, value weights, table exclusions | P0 |
| REQ-C03 | Production safety: hostname heuristic detection (*.rds.amazonaws.com, etc.) + confirmation prompt | P0 |
| REQ-C04 | `--json` flag for machine-readable output (CI/CD) | P1 |
| REQ-C05 | `--seed <number>` flag for deterministic mode | P0 |
| REQ-C06 | `--count <number>` flag for global row count | P0 |
| REQ-C07 | `--dry-run` flag | P0 |
| REQ-C08 | `--output <file.sql>` flag for SQL file export | P0 |
| REQ-C09 | `--verbose` / `--quiet` / `--debug` logging tiers | P1 |
| REQ-C10 | `--schema <name>` flag for non-public schemas | P1 |
| REQ-C11 | `--exclude <tables>` flag for skipping tables | P1 |
| REQ-C12 | Categorized error codes (SF1xxx-SF6xxx) with actionable hints | P0 |
| REQ-C13 | Environment variable interpolation in config (${VAR}) | P1 |
| REQ-C14 | Proper exit codes: 0=success, 1=runtime error, 2=user error | P0 |
| REQ-C15 | `NO_COLOR` support | P1 |
| REQ-C16 | Connection string redaction in all logs/errors | P0 |

## v2 (Deferred)

| ID | Feature | Reason |
|----|---------|--------|
| DEF-01 | MySQL support | Multi-DB after PG is solid |
| DEF-02 | SQLite support | Multi-DB after PG is solid |
| DEF-03 | Prisma schema parsing | Code parsing deferred to v2 |
| DEF-04 | Drizzle schema parsing | Code parsing deferred to v2 |
| DEF-05 | TypeORM entity parsing | Code parsing deferred to v2 |
| DEF-06 | JPA/Hibernate entity parsing | Code parsing deferred to v2 |
| DEF-07 | Community parser plugin system | Needs stable core first |
| DEF-08 | COPY-based bulk insertion | Load testing scale |
| DEF-09 | Load testing (100K+ rows) | Scale features after core |
| DEF-10 | Realistic distribution controls | Zipf, normal distributions |
| DEF-11 | Cross-column semantic coherence | Name-gender, city-state-zip matching |
| DEF-12 | Schema-diff-aware regeneration | Only regen changed tables |
| DEF-13 | Scenario-based seeding | Named presets |
| DEF-14 | seedforge.config.ts (TypeScript config) | Start with YAML, add TS later |

## Out of Scope

- SaaS/hosted version
- Web UI or dashboard
- Data anonymization
- Production data copying/snapshotting
- LLM dependency for core functionality (optional enhancement only)
- ORM lock-in
