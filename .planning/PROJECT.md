# seedforge

> One command, perfect seed data — no matter your database.

## Vision

A CLI tool that introspects your database schema and generates realistic, relationally-correct seed data. No config, no seed scripts, no manual FK wiring. Run one command, get data that looks like a real app.

## Core Value

The zero-config first experience must be magical. A developer runs `npx seedforge --db postgres://localhost/myapp` and sees perfectly structured, realistic, relationally-correct seed data appear in their tables within seconds. When they query the result, it's indistinguishable from production data.

## What It Does

1. **Connects to a live database** and introspects the schema (tables, columns, types, FKs, constraints, enums)
2. **Resolves insert order** via topological sort of FK dependency graph
3. **Maps columns to Faker generators** using semantic heuristics (column name + type → appropriate fake data)
4. **Detects enums and CHECK constraints** — uses actual enum values, not random strings
5. **Respects existing data** — checks what's already in the DB, avoids unique violations, links to existing rows
6. **Generates and inserts** realistic data with correct relationships
7. **Outputs SQL files** or inserts directly into the database

## Target Users

- Backend developers seeding dev/test databases
- CI/CD pipelines generating deterministic test fixtures
- Anyone tired of writing and maintaining seed scripts

## Technical Decisions

- **Language:** TypeScript
- **v1 Database:** PostgreSQL only (MySQL, SQLite in v2)
- **v1 Ingestion:** Direct database introspection only (ORM/code parsing in v2)
- **Output:** Both SQL file export and direct database insertion
- **Column detection:** Heuristics-first (column name + type mapping). Optional LLM flag for edge cases.
- **Default row count:** 50 per table
- **Deterministic mode:** Same seed value = identical output across runs
- **Config file:** `.seedforge.yml` for team-shared generation rules
- **Package:** `seedforge` on npm, invoked via `npx seedforge`

## What It Is NOT

- Not a SaaS or hosted service
- Not a data anonymization tool
- Not a production data copier/snapshot tool
- Not locked to any ORM
- No web UI or dashboard
- No LLM dependency for core functionality

## Success Criteria

The wow moment: query the generated data and it looks like a real app.

```sql
SELECT u.name, u.email, COUNT(o.id) as orders
FROM users u JOIN orders o ON o.user_id = u.id
GROUP BY u.id LIMIT 5;

-- Sarah Chen    | sarah.chen@outlook.com    | 7
-- Marcus Rivera | m.rivera@gmail.com        | 3
-- Aisha Patel   | aisha.p@company.io        | 12
```

Not `test1@test.com`. Not `John Doe #47`. Real data, correct relationships.

## Goals

- Open source, MIT licensed
- Optimize for GitHub stars and developer reputation
- 1000+ stars within 6 months
- Community-contributed parsers welcome in v2+

## Phasing

### v1 — Database Introspection (MVP)
- PostgreSQL schema introspection
- Topological sort for FK dependencies
- Semantic column detection (heuristics)
- Enum/CHECK constraint detection
- Existing data awareness
- SQL file output + direct insertion
- Deterministic mode
- CLI with zero-config defaults
- `.seedforge.yml` config file

### v2 — Multi-DB + Code Parsing
- MySQL and SQLite support
- Prisma schema parsing
- Drizzle schema parsing
- TypeORM entity parsing
- JPA/Hibernate entity parsing (Java)
- Community parser plugin system
- Load testing scale (100K+ rows)
- COPY-based bulk insertion
- Realistic distribution controls
