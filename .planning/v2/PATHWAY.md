# seedforge pathway — synthesized from two reviews

This document supersedes the phase-based ordering in `ROADMAP.md` for
near-term planning. The roadmap remains the canonical list of all
phases; this is the *order in which they ship* and the *bar each one
has to clear*.

## Position

> **The zero-config npx seed tool for developers who need realistic,
> relational test data from their actual schema.**

That sentence is the wedge. Everything else in the README, in the
release notes, in the demos, supports it. Feature breadth (six input
formats, AI providers, plugin system) moves below the fold — kept in
the codebase, demoted in the marketing.

**Primary user:** backend / full-stack developers writing local dev
seed scripts and integration tests against Postgres + Prisma/Drizzle.
Other inputs (MySQL, SQLite, JPA, TypeORM) are supported, not
featured.

**Anti-positioning:** not a synthetic data platform, not a
privacy/compliance tool, not an ML training data tool. We compete with
hand-rolled seed scripts and `@faker-js/faker`, not with Tonic / Gretel
/ SDV.

## Non-negotiable: every wave ships with e2e tests

No item below is "done" until it has an e2e test in
`src/__tests__/e2e/` that exercises the feature against a real
database where that feature is claimed to work and asserts the
user-facing behavior. For database-specific work, that means real
testcontainers for PG 16 and MySQL 8, plus SQLite against a real local
database file. For docs, snippets, and parser-only flows, use the
smallest real fixture that proves the documented command works.
"Unit tests pass" is not the bar. The bar is: a developer running the
documented command on a fresh DB observes the documented outcome.

Every wave's success criteria below explicitly names the e2e test file
that has to land alongside the feature.

---

## Wave 1 — Trust (weeks 1–2)

**Theme:** make the 60-second demo not break. Right now it does, on
any real-world schema with `CHECK ... IN (...)` constraints, and that
single failure churns the user.

### 1.1 CHECK-constraint-aware enum picking hardening

**Problem:** Today seedforge generates `order_type = "Fresh Bamboo Ball"`
on a column constrained to `IN ('PURCHASE','REDEMPTION','IR',...)`.
Trust killer.

**Current state:** the codebase already has CHECK-inferred enum plumbing
for the main introspection paths: CHECK constraints are parsed,
`inferredValues` are propagated into `ColumnDef.enumValues`, and the
mapper prefers enum/CHECK values before falling back to faker. This wave
is therefore a hardening and proof milestone, not a greenfield feature.

**Scope:**

- Audit Postgres parsing of `pg_get_constraintdef` for `IN`-list patterns
  including `(col)::text = ANY(ARRAY[...])`, `col IN (...)`,
  `col IS NULL OR col IN (...)` (nullable columns).
- Audit MySQL parsing of `information_schema.CHECK_CONSTRAINTS` for the same
  shapes.
- Audit SQLite parsing of `sqlite_master.sql` for the same shapes (regex over
  the stored DDL is acceptable).
- Add regression fixtures for real-world dialect output, not just
  hand-written idealized SQL.
- Keep the behavior simple: when `enumValues` is populated, the picker
  uses deterministic uniform selection over those values instead of
  falling through to faker.

**Out of scope:** range checks (`amount > 0`), regex checks, multi-column
checks. Those are real but rarer and belong in a follow-up wave.

**E2e test:** `src/__tests__/e2e/check-constraints.e2e.test.ts`

- Fixture schema with one `CHECK (status IN ('A','B','C'))` column.
- Fixture schema with one `CHECK (col IS NULL OR col IN ('X','Y'))`
  column (nullable variant).
- Apply against PG 16, MySQL 8, SQLite.
- Generate 100 rows with `--seed 42`.
- Assert: every generated value is in the allowed set; nullable
  variant produces both nulls and allowed values; same `--seed`
  produces identical output across runs.
- Regression fixtures for dialect-specific forms already seen in the
  wild, including Postgres `ANY(ARRAY[...])` and MySQL's stored
  `CHECK_CLAUSE` representation.

### 1.2 README rewrite

**Scope:**

- Lead sentence: the wedge above.
- Hero block: 4-line `npx` demo against `$DATABASE_URL`, output of
  generated rows, `--seed` for determinism.
- "Why" section: 3 bullets (schema-aware, zero-config, deterministic).
  No feature matrix, no roadmap, no architecture diagram on the
  landing page.
- "Inputs" section moves below the demo: Postgres / Prisma / Drizzle
  featured first; MySQL / SQLite / JPA / TypeORM listed as also-supported.
- Comparison table near the bottom: vs. faker (field-level, not
  schema-aware), vs. Mockaroo (UI-first, manual schema), vs. hand-rolled
  scripts (brittle, drift with migrations).
- AI / plugin system / advanced config link to a separate `docs/` page,
  not the README.

**E2e test:** `src/__tests__/e2e/readme-snippets.e2e.test.ts`

- README code blocks that are intentionally runnable are tagged with a
  dedicated info string, for example `bash seedforge-test`.
- The test extracts only those tagged blocks, substitutes fixture
  variables like `$DATABASE_URL`, and executes them against a
  testcontainer or temp SQLite database.
- Assert: each tagged snippet exits 0 and produces the documented
  number of rows / output structure.
- Untagged shell blocks are linted for obvious stale package names and
  command spelling, but are not executed.
- This is the regression net for documentation rot — the #1 thing that
  kills OSS adoption is a copy-paste from the README that doesn't
  actually run.

### 1.3 `seedforge inspect` as a subcommand

**Today:** `seedforge --inspect` exists (v2.5.0). It prints a schema
describer.

**Reframe as:** `seedforge inspect [--db ...]` — a subcommand, marketed
as a **schema compatibility report**.

**Scope:**

- Promote the flag to a subcommand. `seedforge --inspect` keeps working
  (backwards compat), gets a deprecation note in the help text.
- Add a "compatibility" section with deterministic reason codes:
  - `ok`: table is seedable with current defaults.
  - `risky`: table is seedable but has columns that may be low fidelity
    (unknown/custom types, unconstrained free text, unparseable defaults).
  - `blocked`: table cannot be generated safely (missing PK, unsupported
    identity strategy, unresolved cycle, or required column with no
    generator).
- Print the FK/cycle summary, inferred enum/CHECK mappings, and skipped
  columns in the report.
- `--json` flag for CI consumption. JSON output is the contract; text
  formatting can evolve.
- Defer estimated rows/sec until it is backed by benchmark data for the
  current executor and schema shape.

**E2e test:** `src/__tests__/e2e/inspect-subcommand.e2e.test.ts`

- Run `seedforge inspect` against a real PG schema (the Curie
  transactions-service migrations are a good fixture — 25 tables,
  38 FKs, real CHECK constraints).
- Assert: all 25 tables appear, FK graph is correct, reason-code
  assignments match a snapshot file, and CHECK-inferred enums are
  visible.
- Run with `--json`; assert structure matches `inspect-output.schema.json`.
- Run `seedforge --inspect` (legacy form); assert identical output +
  deprecation note on stderr.

### 1.4 JPA real-world hardening

**Problem:** `seedforge --jpa` works on textbook entities with
`@ManyToOne` / `@OneToMany` relationships, but breaks on real-world
DDD codebases. Validated against Curie's transactions-service (10
`@Entity` files):

- **FK graph empty.** Modern DDD stores references as raw `UUID
  folio_id` fields, not `@ManyToOne` relationships. The parser only
  follows the relationship-annotation path, so on this codebase it
  reports 0 FKs against a schema that actually has 38.
- **Enum values are placeholders.** Parser detects `enum SchemeType`
  but emits `(TYPE_A, TYPE_B, TYPE_C)` instead of reading the actual
  constants (`EQUITY`, `DEBT`, `HYBRID`, etc.) from the enum's `.java`
  file.
- **Silent entity drops.** 10 `@Entity` files produced 8 tables;
  `OutboxEntry` and one other got silently skipped without explanation.

**Scope:**

- ID-based FK inference: when an entity has `@Column UUID <name>_id`
  *and* there exists another entity whose table name matches `<name>`,
  infer an FK. Configurable off via `--no-id-fk-inference` for users
  who explicitly model relationships.
- Read enum constants by following the type reference to the enum's
  source file. The parser already discovers field types; this is the
  same lookup logic for enum bodies.
- Replace silent skips with structured warnings: every dropped entity
  surfaces in `seedforge inspect` output with a reason code.

**Out of scope:** Hibernate-specific extensions, `@Inheritance`
strategies beyond `@MappedSuperclass`, custom `@Converter`
implementations. Defer until a real codebase exposes the gap.

**E2e test:** `src/__tests__/e2e/jpa-real-world.e2e.test.ts`

- Fixture: a vendored copy of Curie's `domain/entity/` directory
  (10 `@Entity` files + their referenced enums), checked into
  `src/__tests__/e2e/fixtures/jpa-real-world/`.
- Run `seedforge --jpa <fixture-dir> --inspect`.
- Assert: all 10 entities accounted for (9 tables + 1
  `@MappedSuperclass` correctly skipped); FK graph matches expected
  topology (snapshot file); every enum's constants match the
  corresponding `.java` file.
- Run `--jpa <fixture-dir> --dry-run --count 5`.
- Assert: generated SQL would satisfy the inferred FK graph; every
  enum column uses a real constant from source.
- Negative test: a deliberately broken entity (e.g. duplicate `@Id`).
  Assert structured warning surfaced, parser doesn't crash, other
  entities still process.

### 1.5 Auto-discovery (zero-config bootstrap)

**Problem:** the wedge sentence is "zero-config npx seed tool" but the
current UX requires the user to point at the right schema source:

```
seedforge --jpa /Users/.../src/main/java/money/curie/.../domain/entity/
```

That's not zero-config. The aspiration matches `prisma migrate` /
`drizzle-kit generate`: walk the project, find the schema, just work.

**Scope:**

**Design rule (per third reviewer):** auto-discovery does **not**
silently fall back between schema sources of different fidelity. Live
DB and DDL/parser-based sources have different execution semantics
(sequences, defaults, triggers, generated columns), and silent
fallback hides that from the user. Discovery's job is to *suggest*,
not to *choose*. The user always picks.

**Resolution order (explicit > implicit):**

1. If `--db` is provided → use live DB. Done.
2. If `--prisma` / `--drizzle` / `--typeorm` / `--jpa` is provided →
   use that parser. Done.
3. If neither, but `DATABASE_URL` is in `.env` or environment → use
   live DB after confirmation prompt. (This is the high-fidelity
   default.)
4. If still no source → walk the cwd, list every detected source,
   exit non-zero with explicit options:

```
$ npx seedforge
seedforge v2.7.0
  no --db or schema source specified, and no DATABASE_URL set.

  Detected schema sources in this project:
    • Prisma:  ./prisma/schema.prisma
    • Drizzle: ./src/db/schema.ts (pgTable × 7)

  Run one of:
    seedforge --db postgres://localhost:5432/yourdb
    seedforge --prisma  prisma/schema.prisma  --output seed.sql
    seedforge --drizzle src/db/schema.ts      --output seed.sql

  Live DB gives insertion fidelity (defaults, triggers, sequences).
  Parser-based runs are portable and reproducible. Pick the one
  that matches your workflow.
```

**Detection signals (used to populate the suggestion list):**

| Signal | Suggests |
|---|---|
| `prisma/schema.prisma` exists | `--prisma` |
| `package.json` deps include `drizzle-orm` + `pgTable(`/`mysqlTable(`/`sqliteTable(` calls in `src/**/*.ts` | `--drizzle` |
| `package.json` deps include `typeorm` + `@Entity()` in `src/**/*.ts` | `--typeorm` |
| `pom.xml` or `build.gradle` + `@Entity` in `src/main/java/**` | `--jpa` |
| `.env*` contains `DATABASE_URL` | `--db $DATABASE_URL` (and is the *default* if exactly one `DATABASE_URL` is set) |
| `docker-compose.yml` has a `postgres`/`mysql` service | Hint at `--db` against that service |

**Out of scope:**

- DDL/migration directory detection (Flyway, Liquibase, Sqitch). The
  DDL fallback feature itself is deferred (see 1.6).
- Monorepo discovery (multiple schemas in subdirs). Defer until
  requested.
- Auto-running parser dump commands (Tier B/C in the original
  proposal). Deferred indefinitely; users dump DDL manually if they
  need that workflow.

**E2e test:** `src/__tests__/e2e/auto-discovery.e2e.test.ts`

- Fixture project A: `prisma/schema.prisma` + `.env` with one
  `DATABASE_URL`. Run `seedforge --yes`. Assert: discovery picks
  live DB (per rule 3), runs successfully.
- Fixture project B: `prisma/schema.prisma` only, no `DATABASE_URL`.
  Run `seedforge`. Assert: exits non-zero with the suggestion list,
  exit code is documented (e.g. `64` = usage / no source).
- Fixture project C: both a Prisma schema and a Drizzle schema, no
  `DATABASE_URL`. Run `seedforge`. Assert: lists both in the
  suggestion output; exit non-zero.
- Fixture project D: empty directory. Run `seedforge`. Assert: clean
  exit with help message and non-zero status.
- Fixture project E: pom.xml + Java entity dir (the JPA fixture from
  1.4). Run `seedforge`. Assert: suggestion lists `--jpa`.
- Fixture project F: `DATABASE_URL` set + Prisma schema present.
  Run `seedforge --yes`. Assert: live DB wins by rule 3; Prisma
  suggestion *not* taken silently.

### 1.6 Parser strategy lock-in (docs only — no code)

**Theme:** lock in a written decision on what parsers seedforge will
and won't ship natively, so the README rewrite (1.2) and the roadmap
stop drifting.

**Per third reviewer:** the DDL fallback is **deferred out of
v2.7.0**. Its earlier promotion to a v2.7.0 sub-wave was wrong:

> seedforge's core promise is "point this at your real schema and get
> valid relational data that inserts cleanly." That promise depends on
> runtime truth — sequences, generated columns, defaults, extensions,
> triggers, current migrated state. Live DB introspection is much
> closer to the user's actual pain. DDL parsing is valuable, but as a
> portable / offline / preflight path, not the main path. It is not
> the adoption wedge.

DDL fallback moves to a future wave (post Wave 4) and ships only when
real users ask for offline / PR-preview / CI-artifact workflows.

**Decision (this wave is just locking the decision into docs):**

- **Layer 1 — Native parsers.** Today's set is the set: Prisma,
  Drizzle, TypeORM, JPA. No new native parsers until all four are
  bulletproof on real-world codebases (1.4 covers JPA).
- **Layer 2 — DDL fallback (deferred).** Tracked as a future feature.
  See "Deferred features" section. Will ship as `seedforge --ddl
  <path>` when prioritized, but explicitly *not* as the auto-discovered
  default — users opt into it for portability/CI workflows.
- **Layer 3 — Plugin system (post-v3).** Community ships
  `seedforge-plugin-gorm`, `seedforge-plugin-sqlalchemy`, etc. as npm
  packages. Core defines the contract; community owns the parsers.

**Reframe the README's "supported inputs" section:**

> seedforge reads PostgreSQL, MySQL, and SQLite databases directly
> (`--db`), and parses Prisma / Drizzle / TypeORM / JPA schemas
> (`--prisma`, `--drizzle`, `--typeorm`, `--jpa`).
>
> Use `--db` when you want **insertion fidelity** — sequences, defaults,
> triggers, extensions all behave like production.
>
> Use a parser flag when you want **portability and reproducibility** —
> generate seed SQL once, replay forever, no live DB needed.
>
> For other ORMs (GORM, SQLAlchemy, Django, ActiveRecord, EF Core,
> Sequelize, …), connect to a live DB via `--db` after running your
> migrations. Native parsers for these ecosystems are not on the
> roadmap; community plugins (post-v3) are the planned path.

**No code work in 1.6.** This is a docs/positioning decision: the
README rewrite (1.2) reflects the tiers above; the auto-discovery
output (1.5) suggests live DB first; the rest is editorial.

**E2e test:** none for this sub-wave directly. The discovery test
(1.5) and README snippets test (1.2) cover the user-facing behavior
that flows from this decision.

**Wave 1 ships as v2.7.0.** It contains:

| Sub-wave | Theme | E2e test |
|---|---|---|
| 1.1 | CHECK-constraint enum picking hardening | `check-constraints.e2e.test.ts` |
| 1.2 | README rewrite | `readme-snippets.e2e.test.ts` |
| 1.3 | `seedforge inspect` subcommand | `inspect-subcommand.e2e.test.ts` |
| 1.4 | JPA real-world hardening | `jpa-real-world.e2e.test.ts` |
| 1.5 | Auto-discovery (suggest, don't silently choose) | `auto-discovery.e2e.test.ts` |
| 1.6 | Parser strategy lock-in (docs only) | covered by 1.2 + 1.5 |

This is a chunky release on purpose. Wave 1 is the *trust release*:
once it ships, the README's claims match what the tool does on real
codebases, the live-DB workflow is the unambiguous hero, and the
positioning is clean. Everything after Wave 1 is incremental delight.

---

## Wave 2 — Loop (weeks 3–4)

**Theme:** make the tool safe to run repeatedly. Without `--clean`,
every developer's second invocation is "okay how do I undo this," and
the answers today (TRUNCATE, drop DB) are wrong for shared dev DBs.

### 2.1 `seedforge clean` MVP (Phase 11)

Spec already drafted at `.planning/v2/v2.7.0-clean.md`. Treat that spec
as the full design, but do not ship all of it in one release. The MVP is
the smallest reversible-seeding loop that works reliably for local dev
and CI.

**v2.8.0 scope:**

- In-DB tracking table `__seedforge_runs` + `__seedforge_rows`,
  auto-created in a `seedforge_meta` schema.
- `seedforge clean` (subcommand), `seedforge clean <run_id>`,
  `seedforge clean --all`, `seedforge clean --dry-run`.
- `seedforge runs` to list prior runs.
- Recorder hook in both batched and `--fast` streaming paths.
- New error codes `SF6001` / `SF6002` / `SF6003`.
- Default behavior on external FK collisions: abort with `SF6001` and
  list the blocking tables/keys. No cascade deletion in the MVP.

**Deferred from the full spec:**

- `--manifest <path>` sidecar mode ships in v2.8.1 after the in-DB
  recorder is stable.
- `seedforge clean --cascade` ships in v2.8.2 after collision reporting
  has real-world coverage.
- Process-kill failure injection is part of the hardening release, not
  the MVP gate.

**E2e test:** `src/__tests__/e2e/clean.e2e.test.ts`

- Snapshot the DB row counts pre-seed.
- `seedforge --count 50 && seedforge clean`.
- Assert every table returns to its pre-seed row count, including
  V3-style master-data seed rows that were *not* added by seedforge.
- Two consecutive runs with different seeds: clean either in any order;
  assert correct subset removed each time.
- `--fast` parity: same seed under `--fast` produces a clean that
  removes the identical row set.
- External FK collision: insert an app-level row that FKs to a seedforge
  row, run `clean`, assert `SF6001` and no partial cleanup.

**Wave 2 ships as v2.8.0.** Follow-ups: v2.8.1 manifest mode, v2.8.2
cascade + crash-recovery hardening. The existing clean spec should be
renamed or retitled to v2.8.x when this wave starts.

---

## Wave 3 — Demo (week 5)

**Theme:** the artifact every external link points to.

### 3.1 `seedforge-ecommerce-demo` repository

**Scope:**

- New public repo at `github.com/Ommanimesh2/seedforge-ecommerce-demo`.
- Realistic Prisma schema: `users`, `addresses`, `products`, `categories`,
  `product_categories` (many-to-many), `orders`, `order_items`, `payments`,
  `reviews`, `inventory`. ~10 tables, full FK web, CHECK constraints
  on `order_status`, `payment_status`, `review_rating`.
- One-command bootstrap: `npm install && npm run demo`. Spins up local
  PG via docker-compose, runs migrations, runs seedforge, dumps a
  sample of every table, and exports a deterministic text/HTML report.
  A TablePlus screenshot can be used in marketing, but the demo itself
  must not depend on a proprietary desktop app.
- README: ~150 lines, screenshots, the wedge sentence at the top, link
  back to the main repo.
- Used as the canonical demo in Show HN, blog post, X/LinkedIn launch.

**E2e test:** `src/__tests__/e2e/ecommerce-demo.e2e.test.ts` *in the
main repo*

- Vendor the demo's `schema.prisma` into the main repo's e2e fixtures
  (single source of truth — when the demo's schema changes, the main
  repo's test catches incompatibilities first).
- Run seedforge against the schema with `--count 100 --seed 42`.
- Assert: row counts match, FKs resolve, all CHECK enums respected,
  zero constraint violations, generated output is byte-identical
  across runs.
- This is the contract test that protects the demo from main-repo
  regressions.

### 3.2 Launch surface

- Show HN post draft, scheduled.
- Blog post on `seedforge.ommmishra.in` walking through the demo.
- X / LinkedIn thread.
- Reddit r/node, r/typescript, r/programming.

**Not blocking on this wave for code work** — but the demo has to ship
before the launch posts. No launch on a broken demo.

**Wave 3 ships as a launch artifact.** It only needs a package version
bump if the demo work surfaces main-repo bug fixes; otherwise it ships
as the public demo repo plus launch materials.

---

## Wave 4 — Coherence (expansion bet, weeks 6–9)

**Theme:** stop generating Lorem and start generating *plausible*
fixtures. This is where seedforge moves beyond "valid rows" toward
"useful fixtures." It should start only after Waves 1-3 create real
usage signals.

This is Phase 10 from `ROADMAP.md`, but split. We ship the highest-value
slice first.

### 4.1 Cross-column semantic coherence

**Scope:**

- `first_name` matches `gender` if both columns exist on the same row.
- `city` / `state` / `zip` / `country` are geographically consistent
  (uses faker's locale-aware generators, but coordinated across columns).
- Temporal ordering: `paid_at IS NULL OR paid_at > created_at`,
  `updated_at >= created_at`, `end_date > start_date`. Inferred from
  column-name patterns (`*_at`, `start_*` / `end_*`) with an explicit
  override.
- Money coherence: `refund_amount <= original_amount` if both exist
  and there's a FK from refund row to original.

**Out of scope (explicitly deferred):** Zipf / normal / uniform
distribution controls, scenario presets, schema-diff regeneration.
Those are full-fat config-file features; ship them only after the
zero-config defaults are excellent.

**E2e test:** `src/__tests__/e2e/coherence.e2e.test.ts`

- Schema with `first_name VARCHAR`, `gender VARCHAR CHECK IN ('M','F','X')`.
  Generate 1000 rows. Assert: ≥95% of `M` rows have a name from the
  male names list, same for `F`.
- Schema with `city`, `state`, `country`. Generate 1000 rows. Assert:
  city/state combinations are valid (snapshot against a known-good
  pair list).
- Schema with `created_at TIMESTAMPTZ NOT NULL`,
  `paid_at TIMESTAMPTZ NULL`. Generate 1000 rows. Assert: every
  non-null `paid_at` is strictly greater than its `created_at`.
- Same fixtures with `--seed 42` produce byte-identical output.

### 4.2 LLM-hybrid for unmapped columns *(optional, behind a flag)*

**Scope:**

- For columns that fall through all heuristics (semantic stem
  scoring, CHECK enum, faker domain match) and end up at faker.lorem,
  optionally route to an LLM for a one-shot generation of N values.
- Cache by `(seed, schema_hash, table, column, count)` so determinism
  holds across runs.
- Provider: Anthropic / OpenAI / Ollama via existing `--ai-provider`
  plumbing.
- Default off. Opt-in via `--ai-fill-unmapped`.

**Why optional:** the OSS bar is "deterministic without network calls."
LLM-hybrid may become a moat, but it should not be bundled into the
coherence release unless unmapped columns show up as a frequent user
complaint after launch. The default experience must remain zero-config
and deterministic.

**E2e test:** `src/__tests__/e2e/ai-hybrid.e2e.test.ts`

- Mocks the LLM provider with a deterministic stub (same prompt → same
  response). Real LLM calls are out of scope for CI.
- Schema with a clearly-domain-specific column the heuristics miss
  (e.g. `mcc_description` mapped to lorem today).
- Assert: with the flag off, faker lorem; with the flag on, mocked
  stub values; cache hit on second invocation (no second prompt).
- Assert determinism: same seed → identical output even when LLM is
  involved (because of the cache).

**Wave 4 ships as v2.9.0 if coherence is the highest-leverage
post-launch bet.** If user feedback points elsewhere, keep this wave in
the roadmap and re-prioritize.

---

## Wave 5 — MCP server (expansion bet, week 10+)

**Theme:** make seedforge the deterministic backbone an LLM agent calls.

### 5.1 `seedforge mcp`

**Scope:**

- New subcommand `seedforge mcp` that exposes `seed`, `clean`,
  `inspect`, `runs` as MCP tools.
- The agent (Claude Code, Cursor, anything MCP-aware) can fix flaky
  tests by reseeding between them, fill staging after a wipe, or
  inspect a schema during a refactor.
- This is the practical answer to the "LLM directly accessing the DB"
  framing — the LLM still drives, but seedforge handles the
  deterministic, FK-correct, semantically-coherent generation.

**E2e test:** `src/__tests__/e2e/mcp-server.e2e.test.ts`

- Boot the MCP server in-process.
- Send `tools/list`; assert the four tools are exposed with correct
  schemas.
- Call `seed` via MCP against a testcontainer; assert rows landed.
- Call `clean` via MCP; assert rows removed.
- Call `inspect` via MCP; assert structured response matches the
  CLI's `--json` output.

**Wave 5 ships as v3.0.0 only if agent workflows become a clear
adoption channel.** This is the major-version bump because MCP lands
seedforge in a new category of consumer (LLM agents, not just
developers).

---

## What's deliberately not on this pathway

- **DDL fallback (`seedforge --ddl <path>`).** Earlier draft had this
  as Wave 1.6 with auto-detection of Flyway/Liquibase/Sqitch/Rails
  migration directories. **Deferred** per third-reviewer guidance: live
  DB introspection is the adoption wedge because it carries runtime
  truth (sequences, defaults, triggers, extensions). DDL parsing is a
  portability/CI/preflight workflow, not the hero. Revisit when real
  users ask for offline / PR-preview / CI-artifact workflows. When it
  ships, it must not be auto-discovered as a silent fallback — the
  user invokes `--ddl` explicitly so the fidelity tradeoff is visible.
- **Auto-running parser dump commands (Tier B/C).** Earlier draft had
  seedforge running `prisma migrate diff`, `dotnet ef migrations
  script`, Django/SQLAlchemy/GORM dumpers automatically. Dropped
  entirely. Users who want DDL-from-an-ORM-without-a-DB run their
  ecosystem's dump command themselves and pipe into `seedforge --ddl`
  *if and when that flag ships*.
- **Native parsers for GORM / SQLAlchemy / EF Core / ActiveRecord /
  Sequelize.** Out of scope. Connect via `--db` after running
  migrations (the high-fidelity path), or wait for the plugin system.
- **Plugin system (Phase 8).** Useful, but not on the critical path
  to adoption. Defer.
- **Distribution controls / scenario presets (rest of Phase 10).**
  Config-file features that need a population of users first to know
  what shapes matter. Defer.
- **TypeScript config file (`seedforge.config.ts`).** Same reason.
  YAML / CLI flags are sufficient for the wedge.
- **Privacy / compliance / PII detection.** This is the hosted-product
  line. Stays out of OSS by design.
- **Schema diff aware regeneration.** Useful but niche. Defer.
- **Cleaning up the breadth (removing JPA / TypeORM parsers).**
  Cost is sunk; market narrowly, support broadly. The parsers stay,
  they just stop being prominent in the README.

## Versioning summary

| Version | Wave | Theme |
|---|---|---|
| v2.7.0 | Wave 1 | Trust — CHECK enums, README, `seedforge inspect` |
| v2.8.0 | Wave 2 | Loop — `seedforge clean` MVP |
| v2.8.1 | Wave 2 follow-up | Manifest mode or demo bug fixes |
| v2.8.2 | Wave 2 follow-up | Cascade + clean recovery hardening |
| launch | Wave 3 | Demo — ecommerce demo repo + launch |
| v2.9.0 | Wave 4, if validated | Coherence — cross-column rules |
| v3.0.0 | Wave 5, if validated | MCP server |

## OSS / hosted line

The OSS surface is everything above. The hosted product (post-v3.0)
sits on top, not inside:

- Scenario libraries shared across a team
- CI integration with seed diff reports per PR
- Compliance-safe modes (PII detection + redaction during generation)
- Cloud orchestration: one click reseeds staging across regions
- Hosted MCP for teams without their own LLM infra

None of those land in the OSS repo. The line is enforced by which
issues get accepted, not by code-level gating.

## What every wave does for adoption

| Wave | What changes for the developer |
|---|---|
| 1 | The 60-second demo no longer breaks on real schemas. |
| 2 | They can run seedforge twice without rebuilding their DB. |
| 3 | Their first link to seedforge is a working ecommerce demo, not the repo README. |
| 4 | The fixtures are realistic enough to screenshot. |
| 5 | Their AI agent calls seedforge instead of fighting their DB. |

If we ship Waves 1–3 in six weeks, that's the inflection point. Wave 4
is the first expansion bet after usage data. Wave 5 is a second
expansion bet if LLM-agent workflows become a real acquisition channel.
