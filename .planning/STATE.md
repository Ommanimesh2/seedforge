# seedforge — Project State

## Status: v2.3.0 IN PROGRESS

## v1 Phase Status (complete)
| Phase | Status | Tests |
|-------|--------|-------|
| 1. Scaffolding & Core Types | DONE | 32 |
| 2. PG Schema Introspection | DONE | 69 |
| 3. Dependency Resolution | DONE | 56 |
| 4. Column-to-Faker Mapping | DONE | 136 |
| 5. Data Generation Engine | DONE | 102 |
| 6. Output & Insertion | DONE | 79 |
| 7. Configuration System | DONE | 103 |
| 8. CLI Polish & Release | DONE | — |

## v1.x Phase Status (complete)
| Phase | Status |
|-------|--------|
| 1. Stem Scorer | DONE |
| 2. MySQL Support | DONE |
| 3. SQLite Support | DONE |
| 4. Prisma Parser | DONE |
| 5. Drizzle Parser | DONE |
| 6. TypeORM Parser | DONE |
| 7. JPA Parser | DONE |
| 8. Plugin System | DONE |
| 9. Scale & Performance | DONE |
| 10. Advanced Generation | DONE |

## Current Stats
- **Version:** 2.1.0
- **Total tests:** 1249
- **Test files:** 77
- **Build:** clean
- **Lint:** clean

## v2.0.0 Phase Status
| Phase | Status |
|-------|--------|
| 1. Core Pipeline Extraction | DONE |
| 2. seed() One-Liner API | DONE |
| 3. Seeder Class | DONE |
| 4. Fluent Builder | DONE |
| 5. Test Helpers + Exports | DONE |
| 6. CLI Refactor + Version Bump | DONE |

## v2.1.0 Phase Status
| Phase | Status |
|-------|--------|
| 1. Cardinality resolver (cardinality.ts) | DONE |
| 2. GenerationConfig integration | DONE |
| 3. Config types + validation | DONE |
| 4. Generation engine wiring | DONE |
| 5. Programmatic API | DONE |
| 6. CLI + pipeline wiring | DONE |
| 7. Tests (38 new) | DONE |

## v2.2.0 Phase Status
| Phase | Status |
|-------|--------|
| AI provider abstraction (OpenAI, Anthropic, Ollama, Groq) | DONE |
| Prompt builder + JSON array parser | DONE |
| Batch text pool generation | DONE |
| CLI flags (--ai, --ai-provider, --ai-model, --ai-columns) | DONE |
| Config file integration | DONE |

## v2.3.0 Phase Status (GitHub Actions)
| Phase | Status |
|-------|--------|
| 1. seed action (composite, live DB) | DONE |
| 2. export action (composite, schema-only) | DONE |
| 3. report action (composite, PR comment) | DONE |
| 4. Example workflows (PG, MySQL, SQLite, Prisma) | DONE |
| 5. Test workflow (CI validation) | DONE |
| 6. Version bump + release | PENDING |

## Next: v2.x Releases
| Release | Theme | Status |
|---------|-------|--------|
| v2.0.0 | Programmatic TypeScript API | DONE |
| v2.1.0 | Weighted Relationship Cardinality | DONE |
| v2.2.0 | LLM-Enhanced Text Generation | DONE |
| v2.3.0 | GitHub Action + CI/CD | IN PROGRESS |
| v2.4.0 | Production Data Subset + Anonymize | PLANNED |

See `.planning/v2/RELEASES.md` for overview.
See `.planning/v2/v2.x.x-*.md` for detailed plans.
