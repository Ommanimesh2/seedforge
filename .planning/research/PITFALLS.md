# Pitfalls & Edge Cases

## Critical (Must Handle in v1)

| # | Pitfall | Mitigation |
|---|---------|------------|
| 1 | **Generated columns** — INSERT into `GENERATED ALWAYS AS` crashes | Detect via `is_generated` flag, exclude from INSERT column list |
| 2 | **Unique constraint violations at scale** — Faker's finite pool guarantees collisions at >10K rows | Suffix/counter strategy (email → user_123@example.com), not retries |
| 3 | **Circular FK dependencies** — Topo sort fails on cycles | Multi-strategy: detect cycles → break at nullable edges → deferred constraints → CTE |
| 4 | **Sequence desync after seeding** — Explicit ID inserts leave sequences stale, app INSERTs fail | Auto-reset via `SELECT setval(seq, max(id))` after seeding — built into core pipeline |
| 5 | **Connection string exposure** — Credentials leak in logs, errors, shell history, committed config | Redact passwords in all output; env var interpolation in config; warn on plaintext passwords |
| 6 | **Accidental production execution** — Seeding production data is catastrophic | Confirmation prompt + hostname heuristics (warn on cloud hostnames); `--yes` to skip in CI |

## Medium Severity

| # | Pitfall | Mitigation |
|---|---------|------------|
| 7 | Tables with no primary key | Warn (SF2005), generate rows but flag as non-referenceable |
| 8 | Composite primary keys | Support via `columns[]` array in PrimaryKeyDef |
| 9 | Partitioned tables | Introspect parent only, insert into parent (PG routes to partitions) |
| 10 | UUID primary keys | Use `faker.string.uuid()`, no sequence concern |
| 11 | Array columns | Generate arrays of appropriate base type |
| 12 | JSON/JSONB columns | Generate `{}` by default, configurable via config |
| 13 | Timestamp ordering (created_at < updated_at) | Detect `_at` pairs, generate in chronological order |
| 14 | Binary/bytea columns | Skip or generate small random buffers |

## Low Severity (v2+)

| # | Pitfall | Mitigation |
|---|---------|------------|
| 15 | Materialized views | Detect and skip (not insertable) |
| 16 | Custom domains | Resolve to base type |
| 17 | Inherited tables | Insert into leaf tables only |
| 18 | Exclusion constraints | Warn, best-effort |
| 19 | Very large schemas (100+ tables) | Batch introspection queries |

## Performance Recommendations

- Use `pg_catalog` tables directly (faster than `information_schema` views)
- Use single `pg.Client`, not `pg.Pool` (seeding is sequential)
- Batched multi-row INSERTs for v1 (fast enough at 50 rows/table)
- Defer COPY to v2 (load testing scale)
- One transaction per table by default
- Wrapping transaction only when deferred constraints needed

## Security Recommendations

- Use RFC 2606 reserved domains (`@example.com`) for generated emails
- Never generate data matching real PII patterns
- Default to SQL file output (safer than direct insertion)
- Production hostname detection (*.rds.amazonaws.com, *.cloud.google.com, etc.)
