# seedforge — Project State

## Current Phase
Phase 1: Project Scaffolding & Core Types (NOT STARTED)

## Phase Status
| Phase | Status | Notes |
|-------|--------|-------|
| 1. Scaffolding & Core Types | PLANNED | Phase plan created |
| 2. PG Schema Introspection | NOT STARTED | |
| 3. Dependency Resolution | NOT STARTED | |
| 4. Column-to-Faker Mapping | NOT STARTED | |
| 5. Data Generation Engine | NOT STARTED | |
| 6. Output & Insertion | NOT STARTED | |
| 7. Configuration System | NOT STARTED | |
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
Run `/gsd:execute-phase 1` to start building Phase 1.
