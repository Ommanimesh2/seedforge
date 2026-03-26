# Phase 5: Data Generation Engine

**Goal:** Generate rows respecting all constraints, relationships, and existing data. This phase produces in-memory data structures (row arrays per table, plus deferred UPDATE lists) — it does NOT produce SQL or execute inserts. That is Phase 6.

**Requirements:** REQ-E07, REQ-E08, REQ-G04, REQ-G05, REQ-G06, REQ-G07, REQ-G08, REQ-G09, REQ-G10

**Depends on:**
- Phase 1 — types (`DatabaseSchema`, `ColumnDef`, `TableDef`, `ForeignKeyDef`, `NormalizedType`), error system (`GenerationError`)
- Phase 3 — `buildInsertPlan()` returns `InsertPlan` with `ordered`, `deferredEdges`, `selfRefTables`
- Phase 4 — `mapTable()` returns `MappingResult` with `GeneratorFn` per column, `createSeededFaker()`

**Code location:** `src/generate/`

---

## Architecture Overview

The generation engine walks the `InsertPlan.ordered` array (topological order) and generates rows for each table. For each table, it:

1. Queries existing data (row count, existing PK/unique values, existing FK reference IDs)
2. Resolves column generators from the mapping engine, overriding FK columns with reference pool selection
3. Generates N rows, enforcing uniqueness, nullable rates, timestamp ordering, and composite FK integrity
4. Stores generated PK values so downstream tables can reference them as FK targets
5. For self-ref and cycle-broken tables, produces a separate list of deferred UPDATE operations

The primary output is a `GenerationResult` containing all generated rows and deferred updates, ready for Phase 6 to serialize as SQL or execute directly.

### Data Flow

```
DatabaseSchema ──→ buildInsertPlan() ──→ InsertPlan
                                              │
DatabaseSchema ──→ mapTable()         ──→ MappingResult (per table)
                                              │
pg.Client ─────→ queryExistingData()  ──→ ExistingData (per table)
                                              │
                                              ▼
                                       generateRows()
                                         per table,
                                         in topological order
                                              │
                                              ▼
                                       GenerationResult
                                        ├── tableRows: Map<tableName, Row[]>
                                        ├── deferredUpdates: DeferredUpdate[]
                                        └── warnings: string[]
```

---

## Wave 1: Types and Configuration

*Foundation types for the generation engine. All tasks in this wave are independent — run in parallel.*

### Task 5.1.1: Generation types
File: `src/generate/types.ts`

Define the core data structures produced by the generation engine:

- `GenerationConfig` interface:
  - `globalRowCount: number` — default rows per table (default: 50)
  - `tableRowCounts: Map<string, number>` — per-table overrides (key: qualified table name)
  - `nullableRate: number` — probability [0..1] that a nullable column receives NULL (default: 0.1)
  - `seed?: number` — seed for deterministic generation (passed to `createSeededFaker`)

- `Row` type alias: `Record<string, unknown>` — a single generated row keyed by column name.

- `DeferredUpdate` interface:
  - `tableName: string` — qualified table name
  - `pkColumns: string[]` — PK column names used to identify the row
  - `pkValues: unknown[]` — PK values for this specific row
  - `setColumns: string[]` — columns to UPDATE (the self-ref/cycle-broken FK columns)
  - `setValues: unknown[]` — the FK values to set

- `TableGenerationResult` interface:
  - `tableName: string`
  - `rows: Row[]` — generated rows (with NULLs for deferred FK columns)
  - `generatedPKs: unknown[][]` — PK values extracted from generated rows (array of tuples for composite PKs), used to populate downstream FK reference pools

- `GenerationResult` interface:
  - `tables: Map<string, TableGenerationResult>` — keyed by qualified table name, insertion-ordered (topological)
  - `deferredUpdates: DeferredUpdate[]` — all deferred UPDATEs for self-ref and cycle-broken edges
  - `warnings: string[]`

- `ExistingData` interface:
  - `rowCount: number`
  - `existingPKs: unknown[][]` — sampled existing PK values (tuples for composite PKs)
  - `existingUniqueValues: Map<string, Set<string>>` — column name -> set of existing values for unique columns
  - `sequenceValues: Map<string, number>` — sequence name -> current value (for serial/identity columns)

- `ReferencePool` interface:
  - `tableName: string` — the referenced table
  - `columns: string[]` — the referenced columns (PK or unique columns)
  - `values: unknown[][]` — available tuples to pick from (existing + newly generated)

Export all types from `src/generate/index.ts`.

### Task 5.1.2: Generation configuration defaults
File: `src/generate/config.ts`

Implement `createGenerationConfig(overrides?: Partial<GenerationConfig>): GenerationConfig`:

- Returns a `GenerationConfig` with defaults:
  - `globalRowCount`: 50
  - `tableRowCounts`: empty Map
  - `nullableRate`: 0.1 (10%)
  - `seed`: undefined
- Merges any provided overrides on top of defaults.

Implement `getRowCount(config: GenerationConfig, tableName: string): number`:
- Returns `config.tableRowCounts.get(tableName)` if present, otherwise `config.globalRowCount`.
- Validates result is a positive integer >= 1.

Unit tests in `src/generate/__tests__/config.test.ts`:
- Default config values are correct.
- Per-table override is respected.
- Global count used when no per-table override.
- Config merging preserves existing tableRowCounts.
- getRowCount returns correct values for both cases.

---

## Wave 2: Existing Data Awareness

*Depends on Wave 1 types. Queries the live database for existing data to avoid collisions. These tasks are sequential (5.2.1 then 5.2.2).*

### Task 5.2.1: Existing data queries
File: `src/generate/existing-data.ts`

Implement `queryExistingData(client: pg.Client, table: TableDef): Promise<ExistingData>`:

This function executes up to 3 SQL queries against the live database to understand existing state. All queries use parameterized statements.

**Query 1 — Row count:**
```sql
SELECT COUNT(*)::int AS count FROM "schema"."table"
```
Store as `rowCount`.

**Query 2 — Existing PK values:**
If `table.primaryKey` is non-null:
```sql
SELECT "pk_col1", "pk_col2" FROM "schema"."table"
```
Store as `existingPKs` (array of tuples). Used to populate FK reference pools for downstream tables.

Limit: `SELECT ... LIMIT 10000` to avoid memory issues on large tables. If the table has > 10K rows, we sample — that is fine for FK reference pools.

**Query 3 — Existing unique values:**
For each column that appears in `table.uniqueConstraints` (single-column unique constraints only):
```sql
SELECT DISTINCT "column_name"::text FROM "schema"."table" LIMIT 10000
```
Store as `existingUniqueValues` Map. These values are added to the uniqueness exclusion sets to avoid unique constraint violations.

**Query 4 — Sequence state:**
For each column where `isAutoIncrement === true`:
```sql
SELECT pg_get_serial_sequence('"schema"."table"', 'column_name') AS seq_name
```
Then for each non-null sequence:
```sql
SELECT last_value FROM "seq_name"
```
Store as `sequenceValues` Map. This tells us what IDs the database will auto-generate, so we can avoid conflicts.

Error handling:
- Wrap in try/catch. If any query fails, log a warning and return partial results (don't abort generation).
- Use the existing `GenerationError` class with code `SF3003` for existing data query failures.

### Task 5.2.2: Existing data query tests
File: `src/generate/__tests__/existing-data.test.ts`

These are unit tests using a mock `pg.Client`. Do NOT use testcontainers here — integration tests with a real DB are in Wave 7.

Test with a mock client that returns canned query results:
- **Empty table**: rowCount = 0, empty PKs, empty unique values, no sequences.
- **Table with existing rows**: rowCount = 5, PKs returned, unique values populated.
- **Table with composite PK**: PK tuples have correct arity.
- **Table with unique constraint**: existingUniqueValues contains the sampled values.
- **Auto-increment column**: sequence name and last_value fetched.
- **Query failure**: partial ExistingData returned, no throw.
- **Table with no PK**: existingPKs is empty array.

---

## Wave 3: FK Reference Pool Management

*Depends on Wave 1 types and Wave 2 existing data. Manages the pool of FK reference values that grows as tables are generated.*

### Task 5.3.1: Reference pool builder
File: `src/generate/reference-pool.ts`

Implement `ReferencePoolManager` class:

```typescript
class ReferencePoolManager {
  // Internal storage: qualifiedTableName -> ReferencePool
  private pools: Map<string, ReferencePool>

  constructor()

  // Initialize a pool from existing data (called before generation starts for each table)
  initFromExisting(tableName: string, columns: string[], existingPKs: unknown[][]): void

  // Add newly generated PK values to the pool (called after each table's rows are generated)
  addGenerated(tableName: string, newPKs: unknown[][]): void

  // Pick a random FK reference tuple from the pool for a given referenced table
  // Uses the provided faker instance for deterministic random selection
  pickReference(referencedTable: string, faker: Faker): unknown[] | null

  // Get the full pool for a table (for composite FK selection)
  getPool(referencedTable: string): ReferencePool | null

  // Check if a pool exists and has values
  hasReferences(referencedTable: string): boolean

  // Get pool size (for diagnostics)
  poolSize(referencedTable: string): number
}
```

Key behaviors:
- `initFromExisting` creates the pool with existing PK values. If the pool already exists, merges.
- `addGenerated` appends new PK values to an existing pool. If no pool exists, creates one.
- `pickReference` selects a random tuple from the pool using `faker.helpers.arrayElement()`. Returns `null` if pool is empty (caller decides whether to NULL the FK or error).
- For composite FKs, the entire tuple is returned as a unit — never mix-and-match columns from different rows.

### Task 5.3.2: Reference pool tests
File: `src/generate/__tests__/reference-pool.test.ts`

Test cases:
- **Init from existing**: pool contains existing values.
- **Add generated**: pool grows with new values.
- **Merge existing + generated**: pool contains both.
- **Pick reference**: returns a valid tuple from pool.
- **Pick from empty pool**: returns null.
- **Composite PK**: tuples have correct arity, never split.
- **Deterministic picks**: same faker seed produces same selection sequence.
- **Multiple tables**: pools are independent.
- **Pool size**: reports correct count.

---

## Wave 4: Row Generation Core

*Depends on Waves 1-3. The heart of the engine: generating rows for a single table. This is the most complex wave.*

### Task 5.4.1: Unique value tracker
File: `src/generate/unique-tracker.ts`

Implement `UniqueTracker` class:

```typescript
class UniqueTracker {
  // Tracks generated values per column to enforce uniqueness
  // Key: "tableName.columnName", Value: Set of stringified generated values
  private seen: Map<string, Set<string>>

  constructor()

  // Initialize with existing values from the database
  initFromExisting(tableName: string, columnName: string, existingValues: Set<string>): void

  // Check if a value has already been used
  has(tableName: string, columnName: string, value: unknown): boolean

  // Register a value as used. Returns false if it was already present.
  add(tableName: string, columnName: string, value: unknown): boolean

  // Generate a unique value using the generator, with counter/suffix fallback.
  // Tries the generator first. If collision, appends _1, _2, etc. for strings,
  // or increments for numbers. Throws GenerationError SF3002 after maxRetries.
  generateUnique(
    tableName: string,
    columnName: string,
    generator: GeneratorFn,
    faker: Faker,
    rowIndex: number,
    maxRetries?: number,  // default: 1000
  ): unknown
}
```

Uniqueness strategy:
1. Call `generator(faker, rowIndex)` to get a candidate value.
2. Stringify the value for Set comparison (using `String(value)`).
3. If not in the Set, add it and return.
4. If collision, apply suffix strategy based on value type:
   - **String values**: append `_1`, `_2`, ... (e.g., `john.doe@example.com` -> `john.doe_1@example.com` for emails, `john_doe_1` for usernames). For emails, insert the suffix before the `@`.
   - **Number values**: increment by 1 from the collided value.
   - **UUID values**: regenerate (UUIDs have negligible collision probability, just retry).
5. After `maxRetries` attempts, throw `uniqueValueExhaustion()` error (already defined in `src/errors/index.ts`).

### Task 5.4.2: Unique value tracker tests
File: `src/generate/__tests__/unique-tracker.test.ts`

Test cases:
- **No collision**: value accepted on first try.
- **String collision**: suffix appended (`_1`, `_2`, ...).
- **Email collision**: suffix inserted before `@` (`user_1@example.com`).
- **Number collision**: incremented.
- **UUID collision**: regenerated (no suffix).
- **Existing values excluded**: init with existing, new generation avoids them.
- **Exhaustion**: throws `GenerationError` SF3002 after maxRetries.
- **Cross-table independence**: same value allowed in different tables.
- **Case-sensitive**: `"John"` and `"john"` are different values (PostgreSQL default behavior).

### Task 5.4.3: Timestamp pair detection and generation
File: `src/generate/timestamp-pairs.ts`

Implement `detectTimestampPairs(table: TableDef): TimestampPair[]`:

```typescript
interface TimestampPair {
  createdColumn: string   // e.g., "created_at"
  updatedColumn: string   // e.g., "updated_at"
}
```

Detection logic:
1. Find all timestamp/timestamptz columns in the table.
2. Look for pairs matching these patterns:
   - `created_at` / `updated_at`
   - `created` / `updated`
   - `created_at` / `modified_at`
   - `created` / `modified`
   - `create_date` / `update_date`
   - `inserted_at` / `updated_at`
3. Both columns must be present for a pair to be detected.
4. Return the pairs found.

Implement `generateTimestampPair(faker: Faker, pair: TimestampPair): { created: Date; updated: Date }`:
1. Generate `created` as a random date in the past 2 years: `faker.date.past({ years: 2 })`.
2. Generate `updated` as a random date between `created` and now: `faker.date.between({ from: created, to: new Date() })`.
3. Return both values.

### Task 5.4.4: Timestamp pair tests
File: `src/generate/__tests__/timestamp-pairs.test.ts`

Test cases:
- **Standard pair**: `created_at` + `updated_at` detected.
- **Alternative names**: `created` + `modified` detected.
- **No pair**: table with only `created_at` (no updated) returns empty.
- **Non-timestamp columns named similarly**: `created_by` (text) is not included.
- **Multiple pairs**: table with `created_at/updated_at` and `inserted_at/modified_at` returns both.
- **Generated values**: `created < updated` invariant holds across 1000 generations.
- **Both within expected range**: created is in past, updated is between created and now.

### Task 5.4.5: Row generator for a single table
File: `src/generate/generate-table.ts`

Implement `generateTableRows(context: TableGenerationContext): TableGenerationResult`:

```typescript
interface TableGenerationContext {
  table: TableDef
  mappingResult: MappingResult
  config: GenerationConfig
  faker: Faker
  referencePool: ReferencePoolManager
  uniqueTracker: UniqueTracker
  existingData: ExistingData
  deferredFKColumns: Set<string>  // FK columns that should be NULL (self-ref or cycle-broken)
}
```

Algorithm — for each row index `i` from 0 to `rowCount - 1`:

1. **Initialize empty row** as `Row` (Record<string, unknown>).

2. **Detect timestamp pairs** for this table (cached, not re-detected per row).

3. **For each column** in `table.columns` (iteration order from Map):

   a. **Skip auto-increment / generated columns**: if `column.isAutoIncrement || column.isGenerated`, skip entirely (let DB handle). Exception: UUID PKs are NOT auto-increment, so they are generated.

   b. **Handle deferred FK columns**: if column is in `deferredFKColumns`, set to `NULL`. Store the row's PK for later UPDATE.

   c. **Handle FK columns (non-deferred)**: if column is part of any `table.foreignKeys`:
      - Look up the FK definition to get the referenced table.
      - If composite FK: call `referencePool.pickReference()` to get the entire tuple. Assign each column in the tuple to the corresponding row column. Mark all FK columns as "handled" so they are not re-generated individually.
      - If single-column FK: call `referencePool.pickReference()` to get a single value.
      - If pool is empty and column is nullable: set to NULL.
      - If pool is empty and column is not nullable: throw `GenerationError` SF3004 ("No reference values available for FK").

   d. **Handle nullable columns**: if `column.isNullable` and column is not a PK and not an FK:
      - Roll `faker.number.float({ min: 0, max: 1 })`. If < `config.nullableRate`, set to NULL and continue.

   e. **Handle timestamp pairs**: if column is part of a detected timestamp pair:
      - Generate the pair together (created + updated). Store both values. When the second column of the pair is reached, use the stored value instead of regenerating.

   f. **Handle unique columns**: if column appears in any single-column unique constraint or is a PK:
      - Use `uniqueTracker.generateUnique()` to get a collision-free value.

   g. **Default generation**: call `mapping.generator(faker, i)` from the `MappingResult`.

4. **Extract PK values** from the generated row and add to `generatedPKs`.

5. **Return** `TableGenerationResult` with all rows and generated PKs.

Composite FK handling — critical detail:
When a table has a composite FK (e.g., `(order_id, product_id) REFERENCES order_items(order_id, product_id)`), the reference pool stores tuples. When generating, pick ONE tuple and assign all columns from it. Never pick `order_id` from one tuple and `product_id` from another.

Implementation: group FK columns by FK name. Process each FK as a unit, not column-by-column.

### Task 5.4.6: Row generator unit tests
File: `src/generate/__tests__/generate-table.test.ts`

Test with minimal in-memory fixtures (no DB, no mock client). Construct `TableDef`, `MappingResult`, and other context objects directly.

Test cases:
- **Simple table, no FKs**: generates N rows with correct column names and types.
- **Auto-increment PK skipped**: `isAutoIncrement` column not in generated rows.
- **UUID PK generated**: UUID column gets `faker.string.uuid()` value.
- **FK column resolved from pool**: FK value comes from reference pool.
- **Composite FK**: all columns assigned from same tuple.
- **Empty FK pool + nullable**: FK set to NULL.
- **Empty FK pool + non-nullable**: throws GenerationError SF3004.
- **Nullable rate**: ~10% of nullable non-FK columns are NULL (statistical, use tolerance).
- **Unique column**: no duplicate values across generated rows.
- **Unique column with existing values**: existing values avoided.
- **Timestamp pair**: created_at < updated_at for every row.
- **Deferred FK columns**: set to NULL in rows.
- **Generated PKs extracted**: correct PK values in generatedPKs output.
- **Enum column**: values come from enumValues array.
- **JSON/JSONB column**: generates `{}` by default.
- **Row count**: exactly N rows generated.
- **Deterministic**: same seed produces same rows.

---

## Wave 5: Deferred Updates (Self-Ref and Cycle Resolution)

*Depends on Wave 4. Generates the UPDATE statements for self-referencing and cycle-broken FK columns.*

### Task 5.5.1: Deferred update generator
File: `src/generate/deferred-updates.ts`

Implement `generateDeferredUpdates(context: DeferredUpdateContext): DeferredUpdate[]`:

```typescript
interface DeferredUpdateContext {
  tableName: string
  table: TableDef
  generatedRows: Row[]
  generatedPKs: unknown[][]
  deferredFKEdges: DependencyEdge[]   // from InsertPlan.deferredEdges or self-ref edges
  referencePool: ReferencePoolManager
  faker: Faker
}
```

Algorithm:

1. For each deferred FK edge that applies to this table:
   a. Get the referenced table name from the edge.
   b. Get the reference pool for that table (which now includes newly generated IDs, since the referenced table was generated before this one in topological order — or it is the same table for self-ref).
   c. For self-ref tables: the reference pool IS this table's own generated PKs.
2. For each generated row:
   a. Pick a reference tuple from the pool for each deferred FK.
   b. For self-ref: optionally leave some rows as NULL (root nodes). Strategy: first 10-20% of rows have NULL self-ref (they are tree roots), remaining rows reference random earlier rows. This creates a realistic tree structure.
   c. Build a `DeferredUpdate` with the row's PK values and the FK values to set.

Self-referencing tree generation detail:
- Rows 0 through `floor(rowCount * 0.15)` keep NULL (tree roots, ~15% of rows).
- Remaining rows reference a random row from index 0 to their own index - 1 (ensures no forward references, creates valid tree).
- Use `faker.number.int({ min: 0, max: i - 1 })` to pick the parent row index, then look up its PK.

### Task 5.5.2: Deferred update tests
File: `src/generate/__tests__/deferred-updates.test.ts`

Test cases:
- **Self-ref table**: first ~15% of rows have NULL FK, rest reference earlier rows.
- **No forward references**: every self-ref FK points to a row with a lower index.
- **Cycle-broken FK**: updates reference the correct target table's pool.
- **Composite FK in deferred update**: full tuple assigned.
- **PK values correct**: each DeferredUpdate's pkValues match the row's actual PK.
- **Empty reference pool**: self-ref rows all remain NULL (edge case: only 1 row).
- **Deterministic**: same seed produces same update pattern.

---

## Wave 6: Main Orchestrator

*Depends on all previous waves. Ties everything together into the single public entry point.*

### Task 5.6.1: Generation orchestrator
File: `src/generate/generate.ts`

Implement `generate(schema: DatabaseSchema, plan: InsertPlan, client: pg.Client | null, config?: Partial<GenerationConfig>): Promise<GenerationResult>`:

This is the main entry point for Phase 5. It orchestrates the full generation pipeline:

1. **Initialize**:
   - `const genConfig = createGenerationConfig(config)`
   - `const faker = createSeededFaker(genConfig.seed)`
   - `const referencePool = new ReferencePoolManager()`
   - `const uniqueTracker = new UniqueTracker()`
   - `const warnings: string[] = [...plan.warnings]`

2. **Build deferred FK column lookup**:
   - From `plan.deferredEdges`, build a `Map<tableName, Set<columnName>>` of columns that must be NULL on first insert.
   - From `plan.selfRefTables`, find self-referencing FK edges from the schema and add their columns to the same map.

3. **Walk tables in topological order** (`plan.ordered`):
   For each `tableName` in `plan.ordered`:

   a. **Resolve table**: look up `TableDef` from `schema.tables`.

   b. **Query existing data** (if `client` is provided):
      - `const existing = await queryExistingData(client, table)`
      - Initialize reference pool from existing PKs: `referencePool.initFromExisting(tableName, pkColumns, existing.existingPKs)`
      - Initialize unique tracker from existing unique values: `uniqueTracker.initFromExisting(tableName, col, existing.existingUniqueValues.get(col))`

   c. **Map columns**: `const mapping = mapTable(table)`

   d. **Generate rows**:
      ```
      const result = generateTableRows({
        table,
        mappingResult: mapping,
        config: genConfig,
        faker,
        referencePool,
        uniqueTracker,
        existingData: existing,
        deferredFKColumns: deferredColumnMap.get(tableName) ?? new Set(),
      })
      ```

   e. **Update reference pool**: `referencePool.addGenerated(tableName, result.generatedPKs)`

   f. **Generate deferred updates** (if this table has deferred FKs or is self-ref):
      ```
      const updates = generateDeferredUpdates({
        tableName,
        table,
        generatedRows: result.rows,
        generatedPKs: result.generatedPKs,
        deferredFKEdges: applicableEdges,
        referencePool,
        faker,
      })
      ```

   g. **Store results**: add to `tables` Map and append deferred updates.

4. **Return** `GenerationResult` with all tables, deferred updates, and warnings.

**Null client mode**: When `client` is null (dry-run or testing), skip existing data queries. All pools start empty; existing data is assumed to be none. This allows the generation engine to run without a database connection.

### Task 5.6.2: Orchestrator unit tests
File: `src/generate/__tests__/generate.test.ts`

Test with mock client (or null client for most tests). Build `DatabaseSchema` and `InsertPlan` fixtures directly.

Test cases:

- **Single table, no FKs, null client**: generates rows, returns in result.
- **Linear chain (A -> B)**: B generated first, A's FK column references B's PKs.
- **Diamond dependency**: correct ordering, all FK references valid.
- **Self-referencing table**: rows generated with NULL FK, deferred updates populate FKs with tree structure.
- **Cycle-broken edge**: deferred column is NULL in rows, deferred updates fix it.
- **Configurable row count**: global count applied, per-table override respected.
- **Nullable rate**: nullable columns have ~10% NULLs (statistical test with tolerance).
- **Unique values**: no duplicates across all rows for unique columns.
- **Timestamp ordering**: every created_at < updated_at.
- **UUID PK**: all PKs are valid UUIDs.
- **JSON/JSONB**: default value is `{}`.
- **Warnings propagated**: plan warnings appear in result.
- **Deterministic output**: same seed + same schema = identical result.
- **Empty schema**: returns empty result, no errors.
- **Table with all column types**: smoke test covering all NormalizedType values.

---

## Wave 7: Integration Tests

*Depends on Wave 6. End-to-end tests with realistic schemas and (optionally) testcontainers.*

### Task 5.7.1: Realistic schema integration tests
File: `src/generate/__tests__/integration.test.ts`

Test the full pipeline: `DatabaseSchema` -> `buildInsertPlan()` -> `generate()` -> verify `GenerationResult`.

No database needed — use null client mode.

**Fixture 1 — Blog schema:**
```
users (id SERIAL PK, username VARCHAR UNIQUE, email VARCHAR UNIQUE, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
posts (id SERIAL PK, user_id INT FK->users, title VARCHAR, body TEXT, status ENUM('draft','published','archived'), created_at TIMESTAMPTZ)
comments (id SERIAL PK, post_id INT FK->posts, user_id INT FK->users, body TEXT, created_at TIMESTAMPTZ)
tags (id SERIAL PK, name VARCHAR UNIQUE)
post_tags (post_id INT FK->posts, tag_id INT FK->tags, PRIMARY KEY(post_id, tag_id))
```
Verify:
- users generated before posts, posts before comments, tags before post_tags.
- comments.user_id and comments.post_id reference valid generated PKs.
- post_tags has composite FK referencing valid posts and tags.
- users.username and users.email are unique across all rows.
- users.created_at < users.updated_at.
- posts.status is one of 'draft', 'published', 'archived'.

**Fixture 2 — Self-referencing categories:**
```
categories (id SERIAL PK, name VARCHAR, parent_id INT FK->categories.id NULLABLE)
products (id SERIAL PK, category_id INT FK->categories, name VARCHAR, price DECIMAL)
```
Verify:
- categories generated with NULL parent_id initially.
- Deferred updates set parent_id to valid category IDs.
- ~15% of categories remain root nodes (NULL parent_id).
- No category references itself directly.
- products.category_id references valid category IDs.

**Fixture 3 — Cycle (orders <-> invoices):**
```
customers (id SERIAL PK, name VARCHAR)
orders (id SERIAL PK, customer_id INT FK->customers, invoice_id INT FK->invoices NULLABLE)
invoices (id SERIAL PK, order_id INT FK->orders)
```
Verify:
- Cycle broken at orders.invoice_id (nullable edge).
- orders generated with NULL invoice_id.
- Deferred updates set orders.invoice_id to valid invoice IDs.
- invoices.order_id references valid order IDs.

**Fixture 4 — Large schema (15+ tables):**
Build a realistic e-commerce schema with users, profiles, products, categories, orders, order_items, payments, shipping_addresses, reviews, wishlists, coupons, coupon_usages, product_images, inventory, and audit_log.
Verify:
- All FK references are valid.
- No unique constraint violations.
- Total rows generated = sum of per-table counts.
- Execution completes in < 2 seconds.

### Task 5.7.2: Existing data awareness integration tests (testcontainers)
File: `src/generate/__tests__/existing-data-integration.test.ts`

These tests use testcontainers to run a real PostgreSQL instance. Mark with appropriate test timeout.

Test cases:
- **Augment mode**: seed 10 rows, then generate 50 more. FK references include both existing and new IDs. Unique values do not collide with existing.
- **Sequence awareness**: after seeding, auto-increment IDs start after the last existing value.
- **Existing unique values avoided**: insert rows with known unique values, then generate — no collisions.

---

## Wave 8: Module API and Barrel Export

*Depends on Wave 7. Finalize public API surface.*

### Task 5.8.1: Module barrel export
File: `src/generate/index.ts`

Export the public API:
- `generate` (primary entry point)
- `createGenerationConfig`
- `getRowCount`
- All types: `GenerationConfig`, `GenerationResult`, `TableGenerationResult`, `Row`, `DeferredUpdate`, `ExistingData`, `ReferencePool`

Do NOT export:
- `ReferencePoolManager` (internal)
- `UniqueTracker` (internal)
- `generateTableRows` (internal)
- `generateDeferredUpdates` (internal)
- `queryExistingData` (internal)
- `detectTimestampPairs` (internal)

### Task 5.8.2: Root barrel export update
File: `src/index.ts`

Add re-export: `export * from './generate/index.js'`

### Task 5.8.3: Build and lint verification
- `npm run build` succeeds with no TypeScript errors from new files.
- `npm run lint` passes on all new files.
- `npm test` runs all new test files and passes.
- No circular imports between `src/generate/` and other modules.

---

## Error Codes

This phase introduces the following error codes (SF3xxx series — Data Generation):

| Code | Error | When |
|------|-------|------|
| SF3001 | Unresolvable circular dependency | Already exists (Phase 3) |
| SF3002 | Unique value exhaustion | Already exists — thrown by UniqueTracker |
| SF3003 | Existing data query failure | Query to introspect existing data fails |
| SF3004 | FK reference pool empty | Non-nullable FK column has no reference values available |
| SF3005 | Generation failure | Catch-all for unexpected generation errors |

Add factory functions for SF3003, SF3004, SF3005 to `src/errors/index.ts`.

---

## Completion Checklist

- [ ] `GenerationConfig` supports global + per-table row counts and nullable rate
- [ ] Existing data queried: row count, PK values, unique values, sequence state
- [ ] FK reference pools merge existing + newly generated PKs
- [ ] Composite FK tuples selected as units (never mixed)
- [ ] Unique values enforced with counter/suffix strategy
- [ ] RFC 2606 email domains used (via existing `createSafeEmailGenerator`)
- [ ] Nullable rate applied to nullable non-FK, non-PK columns
- [ ] Timestamp ordering: created_at < updated_at
- [ ] UUID PKs generated via `faker.string.uuid()`
- [ ] JSON/JSONB default to `{}`
- [ ] Auto-increment and generated columns skipped
- [ ] Self-referencing tables: INSERT NULL then deferred UPDATE with tree structure
- [ ] Cycle-broken edges: INSERT NULL then deferred UPDATE
- [ ] Deterministic output with seed
- [ ] Null-client mode works (no DB needed for dry-run)
- [ ] All integration test fixtures pass
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` passes all new tests
- [ ] No new runtime dependencies added (uses pg and @faker-js/faker already in deps)

---

## Files Created

```
src/generate/
  index.ts                                # barrel export (public API)
  types.ts                                # GenerationConfig, Row, DeferredUpdate, etc.
  config.ts                               # createGenerationConfig(), getRowCount()
  existing-data.ts                        # queryExistingData() — DB queries for existing state
  reference-pool.ts                       # ReferencePoolManager class
  unique-tracker.ts                       # UniqueTracker class with suffix strategy
  timestamp-pairs.ts                      # detectTimestampPairs(), generateTimestampPair()
  generate-table.ts                       # generateTableRows() — single table row generation
  deferred-updates.ts                     # generateDeferredUpdates() — self-ref/cycle UPDATEs
  generate.ts                             # generate() — main orchestrator
  __tests__/
    config.test.ts                        # config defaults and getRowCount tests
    existing-data.test.ts                 # existing data query tests (mock client)
    reference-pool.test.ts               # reference pool management tests
    unique-tracker.test.ts                # unique value tracking + suffix strategy tests
    timestamp-pairs.test.ts              # timestamp pair detection + ordering tests
    generate-table.test.ts               # single-table row generation tests
    deferred-updates.test.ts             # deferred update generation tests
    generate.test.ts                      # orchestrator unit tests
    integration.test.ts                   # full pipeline integration tests (no DB)
    existing-data-integration.test.ts    # testcontainers integration tests
```

---

## Files Modified

```
src/errors/index.ts                       # add SF3003, SF3004, SF3005 factory functions
src/index.ts                              # add re-export from src/generate/index.js
```
