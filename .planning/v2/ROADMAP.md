# seedforge v2 Roadmap

## Overview

v2 expands seedforge from a PostgreSQL-only CLI to a multi-database, multi-input tool with smarter column detection, scale performance, and a plugin system for community parsers.

---

## Phase 1: Semantic Column Matching (Stem Scorer)
**Goal:** Improve column-to-Faker mapping accuracy from ~85-92% to ~93-96% using token stemming.

- Porter stemmer (~100 lines, zero deps)
- Token decomposition + noise word filtering
- Weighted stem → domain dictionary (~400 stems, 15 domains)
- Fallback layer: only activates when existing exact/suffix/prefix matching fails
- Type guardrails: structured types (JSON, JSONB, ARRAY) always use type generator regardless of name match
- Domain-aware generators: stem match picks the best generator *within* the column's actual type
- Unit tests for stemmer, scorer, and expanded domain dictionary

**Success Criteria:**
- [ ] `financial_data_set TEXT` → finance domain text
- [ ] `financial_data_set JSONB` → valid JSON (type wins)
- [ ] `patient_diagnosis VARCHAR` → medical domain text
- [ ] `vehicle_registration TEXT` → transport domain text
- [ ] Zero new dependencies
- [ ] <0.5ms per column
- [ ] Existing 577 unit tests still pass

---

## Phase 2: MySQL Support
**Goal:** Full MySQL schema introspection and data insertion.

- MySQL database adapter (connection, introspect, insert)
- `information_schema` queries for MySQL (tables, columns, FKs, indexes, constraints)
- MySQL type mapping to NormalizedType (VARCHAR, INT, BIGINT, TINYINT, ENUM, JSON, etc.)
- MySQL-specific: `AUTO_INCREMENT` detection, `ENUM('a','b','c')` inline enum parsing
- Multi-row INSERT with MySQL escaping
- `--db mysql://` connection string detection
- Sequence alternative: `ALTER TABLE t AUTO_INCREMENT = N` after seeding
- Integration tests with `@testcontainers/mysql`
- E2e tests covering MySQL-specific types

**Success Criteria:**
- [ ] `seedforge --db mysql://localhost/mydb` works
- [ ] All 10 schema fixture equivalents pass on MySQL
- [ ] MySQL ENUM columns detected and used

---

## Phase 3: SQLite Support
**Goal:** Full SQLite schema introspection and data insertion.

- SQLite database adapter using `better-sqlite3` (synchronous API, fast)
- PRAGMA-based introspection (table_info, foreign_key_list, index_list)
- SQLite type mapping (TEXT, INTEGER, REAL, BLOB, affinity-based)
- `PRAGMA foreign_keys = ON` enforcement
- No sequences in SQLite — ROWID-based auto-increment
- `--db sqlite:///path/to/db.sqlite` or `--db file:./db.sqlite`
- E2e tests

**Success Criteria:**
- [ ] `seedforge --db sqlite:./test.db` works
- [ ] FK integrity enforced
- [ ] Works without a running database server

---

## Phase 4: Code Parsing — Prisma
**Goal:** Read `schema.prisma` files and generate seed data without a live database.

- Prisma schema parser (parse `.prisma` file into DatabaseSchema)
- Model → TableDef mapping
- Field types → NormalizedType mapping (String, Int, Boolean, DateTime, Json, etc.)
- Relations → ForeignKeyDef mapping (@relation directive)
- Enums → EnumDef mapping
- `@id`, `@unique`, `@default`, `@updatedAt` directive handling
- `seedforge --prisma ./prisma/schema.prisma` flag
- Auto-detection: if `prisma/schema.prisma` exists and no `--db` provided, use it
- Output: SQL file only (no live DB connection needed)

**Success Criteria:**
- [ ] Parse real-world Prisma schemas (e.g., from popular open source projects)
- [ ] Generate correct INSERT order from Prisma relations
- [ ] Handle implicit many-to-many (Prisma creates join tables)

---

## Phase 5: Code Parsing — Drizzle
**Goal:** Read Drizzle ORM schema files and generate seed data.

- TypeScript AST parsing of Drizzle schema files (using `ts-morph` or regex patterns)
- `pgTable()`, `mysqlTable()`, `sqliteTable()` detection
- Column type mapping: `text()`, `integer()`, `boolean()`, `timestamp()`, etc.
- Relations: `references(() => table.column)` parsing
- `seedforge --drizzle ./src/db/schema.ts` flag
- Handle multiple schema files (barrel export detection)

**Success Criteria:**
- [ ] Parse Drizzle PG, MySQL, and SQLite schema definitions
- [ ] Generate correct FK relationships from `references()`

---

## Phase 6: Code Parsing — TypeORM
**Goal:** Read TypeORM entity classes and generate seed data.

- TypeScript AST parsing of TypeORM decorators
- `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, `@ManyToOne()`, `@OneToMany()`, etc.
- Type mapping from decorator options and TypeScript types
- `seedforge --typeorm ./src/entities/` flag

**Success Criteria:**
- [ ] Parse decorated TypeScript entity classes
- [ ] Handle `@JoinColumn()`, `@JoinTable()` for relations

---

## Phase 7: Code Parsing — JPA/Hibernate (Java)
**Goal:** Read Java JPA entity classes and generate seed data.

- Java source parsing (regex-based, not full AST — annotations are structured enough)
- `@Entity`, `@Table`, `@Column`, `@Id`, `@GeneratedValue`, `@ManyToOne`, `@OneToMany`, etc.
- Java type mapping: String, Integer, Long, BigDecimal, LocalDateTime, UUID, etc.
- `seedforge --jpa ./src/main/java/com/example/entities/` flag

**Success Criteria:**
- [ ] Parse standard JPA-annotated Java classes
- [ ] Handle `@JoinColumn`, `@Enumerated` annotations

---

## Phase 8: Plugin System
**Goal:** Community-contributed parsers and generators via npm packages.

- Plugin interface contracts: SchemaParserPlugin, GeneratorPlugin
- Discovery: `seedforge-plugin-*` npm naming convention + explicit config
- Plugin loading and validation at runtime
- Plugin registry with priority ordering
- `seedforge --plugin ./my-parser` flag
- Documentation for plugin authors
- Example plugin: `seedforge-plugin-mongoose` (MongoDB schemas)

**Success Criteria:**
- [ ] Third-party parser plugin can be installed and used
- [ ] Plugin validation catches missing interface methods
- [ ] Plugin generators override built-in generators when specified

---

## Phase 9: Scale & Performance
**Goal:** Support 100K+ rows with COPY-based bulk insertion and performance optimizations.

- PostgreSQL COPY FROM STDIN via `pg-copy-streams`
- MySQL LOAD DATA LOCAL INFILE equivalent
- Streaming row generation (don't hold all rows in memory)
- Batch size auto-tuning based on row width
- Progress bars with ETA
- `--fast` flag to enable COPY mode (default stays as batched INSERT for safety)
- Benchmark suite: 10K, 100K, 1M rows across various schema sizes

**Success Criteria:**
- [ ] 100K rows inserted in <5 seconds (PostgreSQL COPY)
- [ ] Memory usage stays flat regardless of row count (streaming)
- [ ] 1M rows feasible on standard hardware

---

## Phase 10: Advanced Generation Features
**Goal:** Smarter, more realistic data generation.

- **Cross-column semantic coherence:** first_name matches gender, city/state/zip are consistent, birth_date < hire_date
- **Realistic distribution controls:** Zipf, normal, uniform distributions via config
  ```yaml
  tables:
    orders:
      columns:
        total:
          distribution: zipf  # most orders are small, few are large
  ```
- **Scenario-based seeding:** named presets composing reusable templates
  ```yaml
  scenarios:
    empty_store:
      users: 5
      products: 0
      orders: 0
    busy_store:
      users: 100
      products: 500
      orders: 2000
  ```
  `seedforge --scenario busy_store`
- **Schema-diff-aware regeneration:** detect schema changes since last run, only regenerate affected tables
- **seedforge.config.ts:** TypeScript config file support with full type inference

**Success Criteria:**
- [ ] Generated names match specified gender distributions
- [ ] City/state/zip combinations are geographically valid
- [ ] Scenario presets work end-to-end
- [ ] Config autocomplete works in VS Code via TypeScript config

---

## Phase Dependencies

```
Phase 1 (Stem Scorer)
   │
   ├──→ Phase 2 (MySQL) ──────────────┐
   │                                   │
   ├──→ Phase 3 (SQLite) ─────────────┤
   │                                   │
   ├──→ Phase 4 (Prisma) ─────────────┤
   │                                   ├──→ Phase 8 (Plugin System)
   ├──→ Phase 5 (Drizzle) ────────────┤         │
   │                                   │         │
   ├──→ Phase 6 (TypeORM) ────────────┤         │
   │                                   │         │
   └──→ Phase 7 (JPA/Hibernate) ──────┘         │
                                                  │
   Phase 9 (Scale) ──────────────────────────────┤
                                                  │
   Phase 10 (Advanced Generation) ───────────────┘
```

- Phase 1 is independent and should ship first
- Phases 2-7 are independent of each other (can be parallelized)
- Phase 8 (plugins) benefits from having 2-3 parsers done first (validates the interface)
- Phase 9 (scale) is independent
- Phase 10 (advanced generation) is independent but best done last
