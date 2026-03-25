# Stack Research

## Recommended Stack

| Area | Choice | Key Reason |
|------|--------|------------|
| PG Introspection | `pg` + raw catalog queries | Maximum control over schema info extraction |
| Fake Data | `@faker-js/faker` v10 | 7.9M weekly downloads, deterministic seeding, 80+ locales |
| CLI Framework | `commander` v14 | Zero deps, mature, handles subcommands |
| SQL Generation | `pg-format` + `pg-copy-streams` | Safe escaping for INSERT; streaming for COPY |
| Topological Sort | Roll our own (~30 lines) | Zero deps, custom error messages for cycles |
| Config Parsing | `yaml` v2 | YAML 1.2, built-in types, actively maintained |
| Testing | `@testcontainers/postgresql` + vitest | Real PG for introspection tests; fast unit tests |

## Runtime Dependencies (Total: ~3-4 transitive)

- `pg`: 1 dep (pg-protocol)
- `@faker-js/faker`: 0
- `commander`: 0
- `pg-format`: 0
- `yaml`: 0

## Testing Strategy

1. **Unit tests** (no DB): Faker mapping, topo sort, SQL generation, config parsing
2. **Integration tests** (testcontainers): Full introspection pipeline
3. **Snapshot tests**: Deterministic seeded output for known schemas

## Alternatives Considered

- `pg-introspection` (Graphile): Good but uses raw pg_catalog naming, less ergonomic
- `pg-structure`: Stale maintenance, 9 runtime deps
- `@ngneat/falso`: Smaller community, fewer generators
- `oclif`: Overkill for seedforge's command structure
- `dependency-graph`: Viable alternative to rolling our own topo sort
