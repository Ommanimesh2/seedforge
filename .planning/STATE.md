# seedforge — Project State

## Current Phase
Phase 2: PG Schema Introspection (NEXT)

## Phase Status
| Phase | Status | Notes |
|-------|--------|-------|
| 1. Scaffolding & Core Types | DONE | 32 tests, lint clean, build verified |
| 2. PG Schema Introspection | NEXT | |
| 3. Dependency Resolution | NOT STARTED | Can run parallel with Phase 4 |
| 4. Column-to-Faker Mapping | NOT STARTED | Can run parallel with Phase 3 |
| 5. Data Generation Engine | NOT STARTED | |
| 6. Output & Insertion | NOT STARTED | |
| 7. Configuration System | NOT STARTED | Can start after Phase 1 |
| 8. CLI Polish & Release | NOT STARTED | |

## Key Decisions
- **Name:** seedforge
- **Package:** `seedforge` (unscoped) on npm
- **v1 Scope:** PostgreSQL introspection only, no code parsing
- **Stack:** pg + @faker-js/faker + commander + pg-format + yaml + vitest
- **Mode:** YOLO, comprehensive depth, parallel execution
- **Output:** Both SQL file export and direct DB insertion
- **AI:** Heuristics-first, optional LLM enhancement (not in v1 core)
- **Target:** Backend devs + CI/CD pipelines
- **Goal:** GitHub stars and developer reputation

## Next Action
Run `/gsd:plan-phase 2` to plan PG Schema Introspection, or execute phases 2-4 in parallel.
