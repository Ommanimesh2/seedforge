# Phase 6: Output & Insertion

**Goal:** Direct database insertion and SQL file export with batching, progress reporting, sequence reset, dry-run mode, and transaction safety.

**Requirements:** REQ-O01, REQ-O02, REQ-O03, REQ-O04, REQ-O05, REQ-O06, REQ-O07

**Depends on:** Phase 5 (data generation engine produces rows as arrays of objects per table, metadata about deferred updates for self-ref/cyclic tables). Also depends on Phase 1 (types, error system), Phase 2 (pg client connection), and Phase 3 (InsertPlan with ordered tables, deferredEdges, selfRefTables).

**Code location:** `src/output/`

**Stack:**
- `pg-format` (already installed) — safe SQL value escaping for INSERT statements and SQL file export
- `pg` client (already installed) — direct database insertion via parameterized multi-row INSERTs
- No additional dependencies — progress output uses simple stderr writes

**Error codes:** SF4xxx (InsertionError) — insertion/output failures

---

## Input Contract (from Phase 5)

Phase 6 consumes the output of Phase 5's data generation engine. Define the expected input shape:

```
GenerationResult {
  tables: Map<string, TableRows>   // table name -> generated rows
  deferredUpdates: DeferredUpdate[] // UPDATE statements for two-phase inserts (self-ref, cycles)
  plan: InsertPlan                  // from Phase 3 — ordered tables, deferredEdges, selfRefTables
  schema: DatabaseSchema            // original introspected schema
  warnings: string[]                // generation warnings to include in summary
}

TableRows {
  tableName: string
  schemaName: string
  columns: string[]                 // ordered column names for INSERT (excludes generated columns)
  rows: Record<string, unknown>[]   // array of {column: value} objects
}

DeferredUpdate {
  tableName: string
  schemaName: string
  column: string                    // the FK column that was initially NULL
  rowIndex: number                  // which row to update
  value: unknown                    // the FK value to set
}
```

These types will be defined by Phase 5. Phase 6 must import and consume them. If Phase 5 produces a slightly different shape, adjust the adapter layer (Task 6.1.2) accordingly.

---

## Wave 1: Output Types and SQL Formatting

*Foundation types and the pg-format SQL builder. No database interaction yet — purely string construction. Tasks 6.1.1, 6.1.2, and 6.1.3 are independent. Task 6.1.4 depends on all three.*

### Task 6.1.1: Output types
File: `src/output/types.ts`

Define the types that drive the output layer:

- `OutputMode` enum: `DIRECT`, `FILE`, `DRY_RUN`
  - `DIRECT` — insert into database via pg client
  - `FILE` — write SQL file to disk
  - `DRY_RUN` — generate SQL, print summary, do not execute or write
- `OutputOptions` interface:
  - `mode: OutputMode`
  - `client?: pg.Client` — required for DIRECT mode
  - `filePath?: string` — required for FILE mode
  - `batchSize: number` — rows per INSERT statement (default: 500)
  - `showProgress: boolean` — whether to show per-table progress (default: true)
  - `quiet: boolean` — suppress all non-essential output (default: false)
- `InsertBatch` interface:
  - `tableName: string`
  - `schemaName: string`
  - `columns: string[]`
  - `rows: unknown[][]` — array of row value arrays (parallel to columns)
  - `sql: string` — the formatted INSERT SQL
- `SequenceResetInfo` interface:
  - `tableName: string`
  - `schemaName: string`
  - `columnName: string` — the serial/identity column
  - `sequenceName: string` — the PG sequence name
- `InsertionSummary` interface:
  - `tablesSeeded: number`
  - `totalRowsInserted: number`
  - `rowsPerTable: Map<string, number>` — breakdown per table
  - `deferredUpdatesApplied: number`
  - `sequencesReset: number`
  - `elapsedMs: number`
  - `warnings: string[]`
  - `mode: OutputMode` — which mode was used

Export all types from `src/output/index.ts`.

### Task 6.1.2: SQL statement builder
File: `src/output/sql-builder.ts`

Build SQL INSERT statements using `pg-format` for safe escaping. All functions are pure (no I/O).

**`buildInsertSQL(tableName: string, schemaName: string, columns: string[], rows: unknown[][]): string`**

- Use `pg-format` to construct a multi-row INSERT:
  ```
  INSERT INTO %I.%I (%s) VALUES %L;
  ```
  Where:
  - `%I` escapes the schema name and table name as identifiers
  - Column names are individually escaped with `%I` and joined with commas
  - `%L` handles the VALUES list — each row is `(val1, val2, ...)` with proper literal escaping
- Handle special value types:
  - `null` -> `NULL`
  - `Date` objects -> ISO 8601 string
  - `Buffer` / `Uint8Array` -> PG hex bytea format `\\x...`
  - `object` (JSON/JSONB) -> `JSON.stringify(value)`
  - `boolean` -> `TRUE` / `FALSE`
  - `Array` -> PG array literal via `pg-format`
  - Primitives (string, number) -> direct escaping
- Return the complete INSERT statement as a string

**`buildUpdateSQL(tableName: string, schemaName: string, pkColumns: string[], pkValues: unknown[], setColumn: string, setValue: unknown): string`**

- For deferred updates (self-ref, cycle resolution):
  ```
  UPDATE %I.%I SET %I = %L WHERE %I = %L [AND %I = %L ...];
  ```
- Support composite PKs: multiple columns in the WHERE clause joined with AND
- Return the complete UPDATE statement as a string

**`buildSequenceResetSQL(schemaName: string, tableName: string, columnName: string, sequenceName: string): string`**

- Generate:
  ```
  SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I.%I), 1));
  ```
- Uses `COALESCE` so empty tables don't set sequence to NULL
- Return the complete SELECT setval statement as a string

**`buildTransactionWrapper(statements: string[]): string`**

- Wrap an array of SQL statements in `BEGIN;` / `COMMIT;` block
- Each statement separated by newline
- Return the complete transaction block as a string

### Task 6.1.3: Batch splitter
File: `src/output/batcher.ts`

**`splitIntoBatches(rows: Record<string, unknown>[], columns: string[], batchSize: number): unknown[][][]`**

- Convert array-of-objects rows into array-of-arrays format (column-ordered values)
- Split into chunks of `batchSize` rows
- Return array of batches, where each batch is `unknown[][]` (array of row arrays)
- Handle edge cases: empty rows array returns empty batches array, batchSize larger than row count returns single batch

**`buildBatchedInserts(tableName: string, schemaName: string, columns: string[], rows: Record<string, unknown>[], batchSize: number): InsertBatch[]`**

- Combines `splitIntoBatches` with `buildInsertSQL` to produce ready-to-execute `InsertBatch` objects
- Each batch contains the SQL string and metadata

### Task 6.1.4: SQL builder and batcher unit tests
File: `src/output/__tests__/sql-builder.test.ts`

Test cases for `buildInsertSQL`:
- **Simple row**: single row with string, number, boolean values -> valid INSERT statement
- **Multi-row**: 3 rows -> single INSERT with 3 value tuples
- **NULL handling**: null values -> `NULL` in SQL
- **Date handling**: Date objects -> ISO 8601 string in SQL
- **JSON handling**: object values -> JSON.stringify'd in SQL
- **String escaping**: values with single quotes, backslashes -> properly escaped (no SQL injection)
- **Schema qualification**: `public.users` -> `INSERT INTO "public"."users"`
- **Column name escaping**: columns with reserved words or special chars -> properly quoted
- **Empty rows**: empty array -> throws or returns no-op (define behavior)

Test cases for `buildUpdateSQL`:
- Single PK column: `UPDATE t SET col = val WHERE id = 1`
- Composite PK: `UPDATE t SET col = val WHERE id1 = 1 AND id2 = 2`
- NULL set value: `UPDATE t SET col = NULL WHERE id = 1`

Test cases for `buildSequenceResetSQL`:
- Standard case: generates valid `SELECT setval(...)` statement
- Schema-qualified: uses correct schema.table reference

Test cases for `buildTransactionWrapper`:
- Wraps statements in BEGIN/COMMIT
- Empty array -> `BEGIN;\nCOMMIT;`

File: `src/output/__tests__/batcher.test.ts`

Test cases for `splitIntoBatches`:
- 10 rows with batchSize 3 -> 4 batches (3, 3, 3, 1)
- 5 rows with batchSize 10 -> 1 batch
- 0 rows -> 0 batches
- Rows converted from objects to arrays in column order

Test cases for `buildBatchedInserts`:
- Produces correct number of InsertBatch objects
- Each batch contains valid SQL
- Column ordering is consistent across batches

---

## Wave 2: Progress Reporter and Sequence Introspection

*Depends on Wave 1 (types). Tasks 6.2.1 and 6.2.2 are independent.*

### Task 6.2.1: Progress reporter
File: `src/output/progress.ts`

Simple progress output to stderr. No external dependency.

**`ProgressReporter` class:**

```
constructor(options: { quiet: boolean; showProgress: boolean })
```

Methods:
- `startTable(tableName: string, totalRows: number): void`
  - Print: `  tableName: 0/${totalRows} rows` to stderr
  - Store state for this table
- `updateTable(tableName: string, insertedRows: number, totalRows: number): void`
  - Overwrite the current line with: `  tableName: ${insertedRows}/${totalRows} rows`
  - Use `\r` to overwrite in-place if stderr is a TTY, otherwise print on new line
  - Only print every 100ms at most (throttle) to avoid flooding stderr
- `finishTable(tableName: string, totalRows: number, elapsedMs: number): void`
  - Print final line: `  tableName: ${totalRows}/${totalRows} rows (${elapsedMs}ms)`
  - Move to new line
- `printWarning(message: string): void`
  - Print: `  WARN: ${message}` to stderr on its own line
- `printSummary(summary: InsertionSummary): void`
  - Print formatted summary block:
    ```
    Seeding complete:
      Tables:  ${tablesSeeded}
      Rows:    ${totalRowsInserted}
      Time:    ${elapsedMs}ms
      Mode:    ${mode}
    ```
  - If warnings exist, print them below the summary
  - If mode is DRY_RUN, prefix summary with `[DRY RUN] `

Behavior when `quiet` is true: suppress all output except errors.
Behavior when `showProgress` is false: suppress per-table progress, still show final summary (unless quiet).

TTY detection: use `process.stderr.isTTY` to decide between `\r` overwrite (interactive) and newline-per-update (piped/CI).

### Task 6.2.2: Sequence introspection
File: `src/output/sequences.ts`

Query PostgreSQL to find all sequences associated with serial/identity columns that need resetting after seeding.

**`async function findSequences(client: pg.Client, schema: string, tableNames: string[]): Promise<SequenceResetInfo[]>`**

- Query `pg_catalog` for sequences owned by columns in the specified tables:
  ```sql
  SELECT
    t.relname AS table_name,
    a.attname AS column_name,
    s.relname AS sequence_name,
    n.nspname AS schema_name
  FROM pg_depend d
  JOIN pg_class s ON d.objid = s.oid AND s.relkind = 'S'
  JOIN pg_class t ON d.refobjid = t.oid AND t.relkind IN ('r', 'p')
  JOIN pg_namespace n ON t.relnamespace = n.oid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
  WHERE n.nspname = $1
    AND t.relname = ANY($2)
    AND d.deptype IN ('a', 'i')
  ORDER BY t.relname, a.attname;
  ```
- Also detect IDENTITY columns (GENERATED ALWAYS AS IDENTITY / GENERATED BY DEFAULT AS IDENTITY):
  ```sql
  SELECT
    c.relname AS table_name,
    a.attname AS column_name,
    pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS sequence_name,
    n.nspname AS schema_name
  FROM pg_attribute a
  JOIN pg_class c ON a.attrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE a.attidentity IN ('a', 'd')
    AND n.nspname = $1
    AND c.relname = ANY($2)
    AND NOT a.attisdropped
  ORDER BY c.relname, a.attname;
  ```
- Merge results, deduplicate by (table, column) pair
- Filter out any entries where `sequence_name` is null (shouldn't happen, but be defensive)
- Return `SequenceResetInfo[]`
- Wrap query errors in `InsertionError('SF4005', 'Failed to introspect sequences for reset')`

**`async function resetSequences(client: pg.Client, sequences: SequenceResetInfo[]): Promise<number>`**

- For each sequence, execute `buildSequenceResetSQL()` from Task 6.1.2
- Return count of sequences successfully reset
- Log each reset in verbose mode
- If a setval fails (e.g., sequence doesn't exist), log warning and continue (non-fatal)

### Task 6.2.3: Progress reporter and sequence tests

File: `src/output/__tests__/progress.test.ts`

Test cases:
- `startTable` writes to stderr (mock/capture stderr)
- `updateTable` throttles output (multiple rapid calls don't flood)
- `finishTable` prints final count and elapsed time
- `printSummary` formats summary correctly with all fields
- `quiet: true` suppresses all output
- `showProgress: false` suppresses per-table progress but not summary
- DRY_RUN mode prefixes summary with `[DRY RUN]`
- Non-TTY mode uses newlines instead of `\r` overwrite

File: `src/output/__tests__/sequences.test.ts`

Test cases:
- `findSequences` constructs correct SQL query with schema and table names
- Mock pg client returns sequence info -> correctly mapped to `SequenceResetInfo[]`
- Deduplication: same (table, column) from both serial and identity queries -> single entry
- Empty result -> empty array
- `resetSequences` calls `buildSequenceResetSQL` for each sequence
- `resetSequences` returns count of successful resets
- Individual setval failure -> logs warning, continues to next, does not throw

---

## Wave 3: Executor Backends

*Depends on Waves 1 and 2. The three executor backends (direct, file, dry-run) are independent of each other. Tasks 6.3.1, 6.3.2, and 6.3.3 can run in parallel.*

### Task 6.3.1: Direct database executor
File: `src/output/executors/direct.ts`

Execute INSERT statements directly against a PostgreSQL database via the `pg` client.

**`async function executeDirect(generationResult: GenerationResult, options: OutputOptions, progress: ProgressReporter): Promise<InsertionSummary>`**

High-level flow:

1. Record start time (`Date.now()`).
2. Initialize `rowsPerTable` map, counters for `totalRowsInserted`, `deferredUpdatesApplied`, `sequencesReset`.
3. Iterate tables in `generationResult.plan.ordered` order:
   a. Get `TableRows` for this table from `generationResult.tables`.
   b. Skip if table has zero rows.
   c. Build batched inserts via `buildBatchedInserts()`.
   d. Call `progress.startTable(tableName, totalRows)`.
   e. Begin transaction: `await client.query('BEGIN')`.
   f. For each batch:
      - Execute the batch SQL: `await client.query(batch.sql)`.
      - Update progress: `progress.updateTable(tableName, insertedSoFar, totalRows)`.
   g. Commit transaction: `await client.query('COMMIT')`.
   h. Call `progress.finishTable(tableName, totalRows, elapsed)`.
   i. Update counters.
4. Apply deferred updates (self-ref, cycle resolution):
   a. Group `generationResult.deferredUpdates` by table name.
   b. For each table's deferred updates:
      - Begin transaction.
      - For each update, build and execute UPDATE SQL via `buildUpdateSQL()`.
      - Commit transaction.
      - Increment `deferredUpdatesApplied` counter.
5. Reset sequences:
   a. Call `findSequences(client, schema, tableNames)`.
   b. Call `resetSequences(client, sequences)`.
   c. Set `sequencesReset` count.
6. Compute elapsed time.
7. Collect all warnings from `generationResult.warnings`.
8. Return `InsertionSummary`.

Error handling per table:
- If a batch fails, execute `ROLLBACK` for the current table's transaction.
- Throw `InsertionError('SF4001', 'INSERT failed for table ${tableName}: ${error.message}')` with hints:
  - `"Check for unique constraint violations (try reducing row count)"`
  - `"Check for NOT NULL constraint violations"`
  - `"Run with --dry-run to preview generated SQL"`
- Include the failing SQL statement in the error context (truncated to 500 chars) for debugging.

Error handling for deferred updates:
- If an UPDATE fails, throw `InsertionError('SF4002', 'Deferred UPDATE failed for ${tableName}.${column}: ${error.message}')` with hints:
  - `"This may indicate an issue with circular FK resolution"`
  - `"Check that the referenced row exists"`

### Task 6.3.2: SQL file executor
File: `src/output/executors/file.ts`

Write all INSERT statements to a SQL file on disk.

**`async function executeFile(generationResult: GenerationResult, options: OutputOptions, progress: ProgressReporter): Promise<InsertionSummary>`**

High-level flow:

1. Record start time.
2. Open output file for writing (use `fs.createWriteStream` or collect and `fs.writeFile`).
3. Write file header comment:
   ```sql
   -- Generated by seedforge v{version}
   -- Date: {ISO timestamp}
   -- Database: {schema.name}
   -- Tables: {count}
   --
   -- Execute with: psql -f {filename} <connection_string>

   ```
4. Iterate tables in `generationResult.plan.ordered` order:
   a. Get `TableRows` for this table.
   b. Skip if zero rows.
   c. Write table section comment: `-- Table: {schemaName}.{tableName} ({rowCount} rows)`
   d. Build batched inserts.
   e. Write `BEGIN;`
   f. Write each batch's SQL followed by a newline.
   g. Write `COMMIT;`
   h. Write blank line separator.
   i. Update progress.
5. Write deferred updates section:
   a. If there are deferred updates, write comment: `-- Deferred updates (two-phase insert for circular/self-referencing FKs)`
   b. Group by table, wrap each group in BEGIN/COMMIT.
   c. Write each UPDATE statement.
6. Write sequence resets section:
   a. Query sequences via `findSequences()` (requires client for FILE mode too — or compute from schema metadata).
   b. For FILE mode, compute sequence resets from schema metadata instead of querying: find columns with `isAutoIncrement: true` or `isGenerated: true` with identity, use `pg_get_serial_sequence` pattern.
   c. Alternative: detect serial columns from `ColumnDef.isAutoIncrement` and `ColumnDef.defaultValue` (contains `nextval(...)`), extract sequence name from the default value.
   d. Write comment: `-- Reset sequences`
   e. Write each `SELECT setval(...)` statement.
7. Close file.
8. Return `InsertionSummary` with mode `FILE`.

Error handling:
- File open/write failure: throw `InsertionError('SF4003', 'Failed to write SQL file: ${filePath}: ${error.message}')` with hints:
  - `"Check that the directory exists and is writable"`
  - `"Check available disk space"`
- Include `filePath` in error context.

Note on sequence detection for FILE mode: Since FILE mode may not have a database connection, extract sequence names from `ColumnDef.defaultValue` where it matches `nextval('sequence_name'::regclass)`. Parse the sequence name with a regex: `/nextval\('([^']+)'/.exec(defaultValue)`. For IDENTITY columns, construct the sequence name using PostgreSQL's naming convention: `{tableName}_{columnName}_seq`. This is a best-effort approach — the generated SQL will work in most cases.

### Task 6.3.3: Dry-run executor
File: `src/output/executors/dry-run.ts`

Generate data and display a summary without executing anything or writing files.

**`async function executeDryRun(generationResult: GenerationResult, options: OutputOptions, progress: ProgressReporter): Promise<InsertionSummary>`**

High-level flow:

1. Record start time.
2. For each table in insertion order:
   a. Get `TableRows` for this table.
   b. Build batched inserts (to compute the SQL that would be executed).
   c. Print table info to stderr:
      ```
      [DRY RUN] {schemaName}.{tableName}: {rowCount} rows, {batchCount} batches
      ```
   d. If verbose mode, print the first batch's SQL (truncated to 5 rows max) as a preview.
3. Print deferred update count:
   ```
   [DRY RUN] Deferred updates: {count} UPDATE statements
   ```
4. Print sequence reset info:
   ```
   [DRY RUN] Sequences to reset: {count}
   ```
5. Compute elapsed time (includes data generation time from Phase 5).
6. Return `InsertionSummary` with mode `DRY_RUN` and `totalRowsInserted` reflecting what would have been inserted.

No database interaction. No file writes. Only stderr output.

### Task 6.3.4: Executor tests

File: `src/output/__tests__/executors/direct.test.ts`

Test with a mock `pg.Client`:
- **Happy path**: 2 tables with 5 rows each -> 2 transactions, correct INSERT SQL executed, summary counts correct
- **Batching**: 250 rows with batchSize 100 -> 3 batches (100, 100, 50), 1 transaction per table
- **Deferred updates**: self-ref table -> UPDATE statements executed after all INSERTs
- **Transaction rollback on error**: simulate batch failure -> ROLLBACK called, InsertionError thrown with SF4001
- **Deferred update failure**: simulate UPDATE failure -> InsertionError thrown with SF4002
- **Empty table**: table with 0 rows -> skipped, no transaction started
- **Sequence reset**: verify `findSequences` and `resetSequences` called after inserts
- **Progress calls**: verify `startTable`, `updateTable`, `finishTable` called in correct order

File: `src/output/__tests__/executors/file.test.ts`

Test with a temp directory (use `os.tmpdir()` + unique suffix):
- **Happy path**: write SQL file -> file contains valid SQL with header, BEGIN/COMMIT blocks, INSERT statements
- **File header**: contains seedforge version, timestamp, database name
- **Transaction wrapping**: each table's inserts wrapped in BEGIN/COMMIT
- **Deferred updates section**: present when deferred updates exist, wrapped in transaction
- **Sequence resets section**: present, contains setval statements
- **File write error**: mock fs failure -> InsertionError SF4003 thrown
- **Round-trip**: generated SQL file can be parsed as valid SQL (basic syntax check)

File: `src/output/__tests__/executors/dry-run.test.ts`

Test cases:
- **No database calls**: verify mock pg client's `query` method is never called
- **No file writes**: verify no files created
- **Summary output**: captures stderr, verifies `[DRY RUN]` prefix
- **Summary counts**: `totalRowsInserted` reflects what would be inserted
- **Verbose preview**: with verbose flag, first batch SQL is printed (truncated)

---

## Wave 4: Orchestrator and CLI Integration

*Depends on Wave 3. Brings everything together into a single entry point and wires into the CLI.*

### Task 6.4.1: Output orchestrator
File: `src/output/orchestrate.ts`

The main entry point for Phase 6. Called by the CLI after Phase 5 produces generated data.

**`async function executeOutput(generationResult: GenerationResult, options: OutputOptions): Promise<InsertionSummary>`**

1. Validate options:
   - DIRECT mode requires `options.client` to be set. If missing, throw `InsertionError('SF4006', 'Direct insertion mode requires a database connection')`.
   - FILE mode requires `options.filePath` to be set. If missing, throw `InsertionError('SF4007', 'File output mode requires --output <path>')`.
   - Validate `batchSize` is between 1 and 10000. If out of range, clamp and warn.
2. Create `ProgressReporter` with quiet/showProgress options.
3. Dispatch to the appropriate executor:
   - `DIRECT` -> `executeDirect()`
   - `FILE` -> `executeFile()`
   - `DRY_RUN` -> `executeDryRun()`
4. Print summary via `progress.printSummary(summary)`.
5. Return `InsertionSummary`.

**`function resolveOutputMode(cliOptions: CliOptions): OutputMode`**

Determine the output mode from CLI flags:
- `--dry-run` -> `DRY_RUN` (takes precedence)
- `--output <file>` without `--dry-run` -> `FILE`
- Neither -> `DIRECT` (default)
- Both `--output` and no `--dry-run` -> `FILE` (write to file, don't insert)

Note: `--output` + `--dry-run` means DRY_RUN wins (no file write, just preview). Document this behavior.

### Task 6.4.2: Error factories for insertion errors
File: `src/errors/index.ts` (modify)

Add factory functions for insertion-specific errors:

**`insertFailed(tableName: string, message: string, sql?: string): InsertionError`**
```
Code: SF4001
Message: "INSERT failed for table ${tableName}: ${message}"
Hints:
  - "Check for unique constraint violations (try reducing row count)"
  - "Check for NOT NULL constraint violations"
  - "Run with --dry-run to preview generated SQL"
Context: { tableName, sql: sql?.slice(0, 500) }
```

**`updateFailed(tableName: string, column: string, message: string): InsertionError`**
```
Code: SF4002
Message: "Deferred UPDATE failed for ${tableName}.${column}: ${message}"
Hints:
  - "This may indicate an issue with circular FK resolution"
  - "Check that the referenced row exists"
Context: { tableName, column }
```

**`fileWriteFailed(filePath: string, message: string): InsertionError`**
```
Code: SF4003
Message: "Failed to write SQL file: ${filePath}: ${message}"
Hints:
  - "Check that the directory exists and is writable"
  - "Check available disk space"
Context: { filePath }
```

**`transactionFailed(tableName: string, message: string): InsertionError`**
```
Code: SF4004
Message: "Transaction failed for table ${tableName}: ${message}"
Hints:
  - "The table's data was rolled back"
  - "Other tables that completed successfully are still committed"
Context: { tableName }
```

**`sequenceResetFailed(sequenceName: string, message: string): InsertionError`**
```
Code: SF4005
Message: "Failed to reset sequence ${sequenceName}: ${message}"
Hints:
  - "The sequence may need manual reset"
  - "Run: SELECT setval('${sequenceName}', (SELECT MAX(id) FROM table))"
Context: { sequenceName }
```

**`missingConnection(): InsertionError`**
```
Code: SF4006
Message: "Direct insertion mode requires a database connection"
Hints:
  - "Provide a connection string with --db <url>"
  - "Or use --output <file> to write SQL to a file instead"
Context: {}
```

**`missingOutputPath(): InsertionError`**
```
Code: SF4007
Message: "File output mode requires an output path"
Hints:
  - "Specify output path with --output <file.sql>"
Context: {}
```

### Task 6.4.3: CLI wiring
File: `src/cli.ts` (modify)

Update the CLI action handler to integrate Phase 6 output. The current handler ends at introspection with a TODO comment. Add the output step after Phase 5 generation:

After the Phase 5 generation call (which produces `GenerationResult`):

1. Determine output mode: `const mode = resolveOutputMode(options)`.
2. Build `OutputOptions`:
   ```
   {
     mode,
     client: mode === OutputMode.DIRECT ? client : undefined,
     filePath: options.output,
     batchSize: 500,  // could be a CLI option in future
     showProgress: !options.quiet,
     quiet: options.quiet,
   }
   ```
3. Call `const summary = await executeOutput(generationResult, outputOptions)`.
4. Handle exit codes:
   - Success (0): all rows inserted, no errors
   - Runtime error (1): InsertionError caught
   - User error (2): invalid options (missing --db, invalid --output path)
5. If `--json` flag: print `InsertionSummary` as JSON to stdout instead of formatted summary.

Note: The CLI already has the try/catch structure for SeedForgeError. InsertionError extends SeedForgeError, so it will be caught and rendered automatically.

### Task 6.4.4: Orchestrator and CLI tests

File: `src/output/__tests__/orchestrate.test.ts`

Test cases:
- **Mode resolution**: `--dry-run` -> DRY_RUN, `--output file.sql` -> FILE, neither -> DIRECT
- **Mode precedence**: `--dry-run --output file.sql` -> DRY_RUN
- **Missing client for DIRECT**: throws SF4006
- **Missing filePath for FILE**: throws SF4007
- **Batch size clamping**: batchSize 0 -> clamped to 1, batchSize 99999 -> clamped to 10000, with warning
- **Summary printed**: verify `progress.printSummary` called after execution
- **Dispatches correctly**: DIRECT calls `executeDirect`, FILE calls `executeFile`, DRY_RUN calls `executeDryRun`

File: `src/output/__tests__/error-factories.test.ts`

Test cases for each new error factory:
- Correct error code (SF4001-SF4007)
- Correct error class (InsertionError)
- Hints are populated
- Context contains relevant fields
- SQL truncation in SF4001 (verify context.sql is <= 500 chars)
- `render()` output includes code, message, and hints

---

## Wave 5: Module API, Barrel Export, and Verification

*Depends on Wave 4. Final wiring, exports, and full test verification.*

### Task 6.5.1: Module barrel export
File: `src/output/index.ts`

Export the public API:
- `executeOutput` from `./orchestrate.js` (primary entry point)
- `resolveOutputMode` from `./orchestrate.js`
- All types from `./types.js`: `OutputMode`, `OutputOptions`, `InsertBatch`, `SequenceResetInfo`, `InsertionSummary`
- `ProgressReporter` from `./progress.js`
- `buildInsertSQL`, `buildUpdateSQL`, `buildSequenceResetSQL` from `./sql-builder.js` (useful for testing/debugging)

Do NOT export:
- `executeDirect`, `executeFile`, `executeDryRun` (internal executors — accessed via `executeOutput`)
- `splitIntoBatches` (internal implementation detail)
- `findSequences`, `resetSequences` (internal, used only by executors)

Update `src/index.ts` to re-export from `./output/index.js`.

### Task 6.5.2: Cross-module integration verification
File: `src/output/__tests__/integration.test.ts`

Verify that the output module integrates cleanly with existing types:
- Import `InsertPlan` from `src/graph`, `DatabaseSchema` from `src/types`, and `executeOutput` from `src/output`.
- Construct a mock `GenerationResult` using real type constructors.
- Call `executeOutput` in DRY_RUN mode (no database needed).
- Verify the returned `InsertionSummary` matches the expected interface.
- Verify error thrown for missing client is an `InsertionError` with code `SF4006`.
- Verify the module compiles and exports correctly (`import { executeOutput } from './output/index.js'`).

### Task 6.5.3: Build, lint, and test verification
- `npm run build` succeeds with no TypeScript errors from new files.
- `npm run lint` passes on all new files.
- `npm test` runs all new test files and passes.
- No circular imports between `src/output/` and other modules.
- No new runtime dependencies added (pg-format and pg are already installed).

---

## Completion Checklist

- [ ] Multi-row INSERT statements built with pg-format safe escaping
- [ ] Batching: rows split into configurable batch sizes (default 500)
- [ ] Direct database insertion executes batched INSERTs via pg client
- [ ] Transaction wrapping: each table's inserts wrapped in BEGIN/COMMIT
- [ ] Transaction rollback on batch failure (per-table isolation)
- [ ] SQL file export: valid .sql file with header, transactions, all statements
- [ ] SQL file includes deferred UPDATE statements for two-phase inserts
- [ ] SQL file includes sequence reset statements
- [ ] Dry-run mode: generates SQL, prints summary, no execution or file writes
- [ ] Sequence auto-reset: finds serial/identity sequences, resets via setval
- [ ] Sequence reset handles empty tables (COALESCE with 1)
- [ ] Deferred updates: UPDATE statements for self-ref and cyclic FK columns executed after INSERTs
- [ ] Progress reporting: per-table progress to stderr with throttling
- [ ] Progress supports TTY (overwrite) and non-TTY (newlines) modes
- [ ] Summary report: tables seeded, rows inserted, time elapsed, mode, warnings
- [ ] Quiet mode suppresses all non-error output
- [ ] Error handling: SF4001 (insert failed), SF4002 (update failed), SF4003 (file write failed), SF4004 (transaction failed), SF4005 (sequence reset), SF4006 (missing connection), SF4007 (missing output path)
- [ ] Error messages include actionable hints
- [ ] NULL, Date, JSON, boolean, Buffer values correctly escaped in SQL
- [ ] Output mode resolution: --dry-run > --output > direct
- [ ] Orchestrator validates options before dispatching
- [ ] CLI wired: `seedforge --db <url>` inserts data, `--output <file>` writes SQL, `--dry-run` previews
- [ ] Exit codes: 0 success, 1 runtime error, 2 user error
- [ ] No new runtime dependencies added
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` passes all new tests
- [ ] No regressions in Phases 1-5 tests

---

## Files Created

```
src/output/
  index.ts                              # Barrel export (public API)
  types.ts                              # OutputMode, OutputOptions, InsertBatch, SequenceResetInfo, InsertionSummary
  sql-builder.ts                        # buildInsertSQL(), buildUpdateSQL(), buildSequenceResetSQL(), buildTransactionWrapper()
  batcher.ts                            # splitIntoBatches(), buildBatchedInserts()
  progress.ts                           # ProgressReporter class (stderr progress output)
  sequences.ts                          # findSequences(), resetSequences()
  orchestrate.ts                        # executeOutput(), resolveOutputMode() — main entry point
  executors/
    direct.ts                           # executeDirect() — pg client insertion
    file.ts                             # executeFile() — SQL file writer
    dry-run.ts                          # executeDryRun() — preview mode
  __tests__/
    sql-builder.test.ts                 # SQL statement builder tests
    batcher.test.ts                     # Batch splitting tests
    progress.test.ts                    # Progress reporter tests
    sequences.test.ts                   # Sequence introspection/reset tests
    orchestrate.test.ts                 # Orchestrator + mode resolution tests
    error-factories.test.ts             # Insertion error factory tests
    integration.test.ts                 # Cross-module integration tests
    executors/
      direct.test.ts                    # Direct executor tests (mock pg client)
      file.test.ts                      # File executor tests (temp directory)
      dry-run.test.ts                   # Dry-run executor tests
```

## Files Modified

```
src/errors/index.ts                     # Add SF4001-SF4007 insertion error factories
src/cli.ts                              # Wire output orchestrator after Phase 5 generation
src/index.ts                            # Add re-export from src/output/index.js
```
