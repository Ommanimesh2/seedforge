# seedforge — Project State

## Current Phase
Phase 5: Data Generation Engine (NEXT)

## Phase Status
| Phase | Status | Notes |
|-------|--------|-------|
| 1. Scaffolding & Core Types | DONE | 32 tests |
| 2. PG Schema Introspection | DONE | 69 tests, 16 source files |
| 3. Dependency Resolution | DONE | 56 tests, 8 source files |
| 4. Column-to-Faker Mapping | DONE | 136 tests, 190 column patterns |
| 5. Data Generation Engine | NEXT | |
| 6. Output & Insertion | NOT STARTED | |
| 7. Configuration System | NOT STARTED | |
| 8. CLI Polish & Release | NOT STARTED | |

## Stats
- **Total tests:** 293
- **Total source files:** ~60
- **Build:** clean
- **Lint:** clean

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
Plan and execute Phase 5 (Data Generation Engine).
Phases 5+6 are sequential (generation before output).
Phase 7 (Config) can run in parallel with 5/6.
