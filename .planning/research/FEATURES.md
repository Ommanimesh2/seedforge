# Features Research

## Competitor Status (2026)

| Tool | Status | Key Weakness |
|------|--------|-------------|
| Supabase/seed (ex-Snaplet) | Maintained, 724 stars | PG-only, docs rot, contributor uncertainty |
| Prisma db seed | Active (part of Prisma) | Not a generator — just runs user scripts |
| @faker-js/faker | Active, 15K stars | No schema/relational awareness |
| Knex seeds | Active | No ordering, no tracking, no generation |
| Mockaroo | Active SaaS | Web-only, no CLI, no introspection, paid |
| Schema-Seed | New competitor | Universal DB support, early stage |
| Seedfast | Active SaaS | Closed source, $8-16/mo, PG-only |
| SYDA (Python) | Active | Python-only, requires LLM API keys |

## Table Stakes (Must-Have for v1)

1. Schema introspection from live database
2. FK dependency resolution (topological sort)
3. Semantic column detection (name → Faker mapping)
4. Deterministic/reproducible output (seed value)
5. Configurable row counts per table
6. Enum/CHECK constraint support
7. NULL handling (respect nullable, configurable rates)
8. CLI-first with zero-config defaults
9. Progress indication
10. Dry-run mode (preview SQL without executing)
11. Actionable error messages
12. Custom column overrides via config

## Key Differentiators

1. **True zero-config pipeline** — connection string → realistic data
2. **Cross-column semantic coherence** — names match gender, dates are chronological
3. **Circular FK auto-resolution** — multi-strategy without user config
4. **Existing data awareness** — augment, don't collide
5. **Offline-first, optional AI** — no API keys for core functionality
6. **ORM-agnostic + multi-DB** (v2) — works with any stack

## Developer Pain Points (Ranked)

1. "Same boilerplate seed script for every project" (#1 complaint)
2. "FK ordering is a nightmare"
3. "Data isn't realistic / columns are independent"
4. "Seed scripts break after schema changes"
5. "No tracking of which seeds have run"
6. "Error messages don't identify which table failed"

## CLI UX Standards (2026)

- Respond within 100ms (show spinner immediately)
- `--json` output for CI/scripting
- `--dry-run` flag
- `--quiet` / `--verbose` / `--debug` tiers
- `NO_COLOR` support
- Proper exit codes (0=success, 1=runtime, 2=user error)
- stdout for data, stderr for status
- Confirm destructive actions (--yes to skip)
