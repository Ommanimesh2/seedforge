# Phase 2: PostgreSQL Schema Introspection

**Goal:** Connect to PostgreSQL and extract complete schema metadata into the internal `DatabaseSchema` representation.

**Requirements:** REQ-E01, REQ-E09, REQ-E10, REQ-C03, REQ-C10, REQ-C16

**Stack:** `pg` (single `pg.Client`), raw `pg_catalog` + `information_schema` queries, `@testcontainers/postgresql` for integration tests.

**Error codes:** SF1xxx (connection/auth), SF2xxx (introspection).

---

## Wave 1: Connection Management & Safety

*Foundation layer. All tasks are independent unless noted.*

### Task 2.1.1: Production hostname detection

File: `src/introspect/safety.ts`

- Export `isProductionHost(hostname: string): boolean`
  - Match against known cloud provider patterns:
    - `*.rds.amazonaws.com`
    - `*.cloud.google.com` / `*.cloudsql.google.com`
    - `*.database.azure.com`
    - `*.supabase.co`
    - `*.neon.tech`
    - `*.render.com`
    - `*.elephantsql.com`
    - `*.aiven.io`
    - `*.cockroachlabs.cloud`
  - Return `true` if hostname matches any pattern
- Export `extractHostFromConnectionString(url: string): string | null`
  - Parse connection string with `new URL()` to extract hostname
  - Handle parsing failures gracefully (return null)
- Export `confirmProductionAccess(hostname: string, skipPrompt: boolean): Promise<boolean>`
  - If `skipPrompt` is true (--yes flag), print warning to stderr but return `true`
  - Otherwise, print warning and prompt user via `readline` for explicit `yes` confirmation
  - Return `false` if user declines or if stdin is not a TTY (non-interactive mode)
  - Warning message: `"WARNING: ${hostname} looks like a production database. Continue? (yes/N)"`

### Task 2.1.2: Connection client wrapper

File: `src/introspect/connection.ts`

- Export `interface ConnectOptions`:
  - `connectionString: string`
  - `timeoutMs?: number` (default: 10_000)
  - `schema?: string` (default: `'public'`)
  - `skipProductionCheck?: boolean` (default: false, maps to `--yes`)
- Export `async function connect(options: ConnectOptions): Promise<pg.Client>`
  - Run production hostname detection before connecting (call `isProductionHost` + `confirmProductionAccess`)
  - If user declines production prompt, throw new `ConnectionError('SF1006', 'Connection aborted by user')`
  - Create `new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs })`
  - Call `client.connect()`
  - Set search_path: `SET search_path TO ${schema}` via parameterized query
  - Return connected client
- Export `async function disconnect(client: pg.Client): Promise<void>`
  - Call `client.end()`, swallow errors (logging only)
- Error mapping in `connect()`: catch `pg` errors and map to SeedForge errors:
  - `ECONNREFUSED` / `ENOTFOUND` / `EHOSTUNREACH` -> `connectionFailed(host, port)` (SF1001)
  - Error code `28P01` (invalid_password) -> `authenticationFailed(user)` (SF1002)
  - Error code `3D000` (invalid_catalog_name) -> `databaseNotFound(dbname)` (SF1003)
  - `ETIMEDOUT` / connection timeout -> `connectionTimeout(timeoutMs)` (SF1005)
  - Unknown pg errors -> new `ConnectionError('SF1004', redactConnectionString(message))` with generic hints
  - All error messages MUST pass through `redactConnectionString()` before surfacing

### Task 2.1.3: Add new error factory: connection aborted

File: `src/errors/index.ts`

- Add factory function `connectionAborted()`:
  ```
  export function connectionAborted(): ConnectionError {
    return new ConnectionError(
      'SF1006',
      'Connection aborted by user',
      ['Use --yes to skip production confirmation prompts'],
      {},
    )
  }
  ```
- Add factory function `sslRequired(host: string)`:
  ```
  export function sslRequired(host: string): ConnectionError {
    return new ConnectionError(
      'SF1007',
      `SSL connection required by server at ${host}`,
      ['Add ?sslmode=require to your connection string'],
      { host },
    )
  }
  ```

### Task 2.1.4: Unit tests for Wave 1

File: `src/introspect/__tests__/safety.test.ts`

- Test `isProductionHost` returns true for each cloud provider pattern
- Test `isProductionHost` returns false for `localhost`, `127.0.0.1`, `db.local`, `postgres`, custom hostnames
- Test `extractHostFromConnectionString` extracts host from valid URLs
- Test `extractHostFromConnectionString` returns null for malformed strings

File: `src/introspect/__tests__/connection.test.ts`

- Test error mapping: mock `pg.Client.connect()` to throw each pg error code, verify correct SeedForge error type and code
- Test that all error messages are redacted (no raw passwords)
- Test that production check is invoked before connection attempt
- Test that `SF1006` is thrown when user declines production prompt
- Test `disconnect` swallows errors

---

## Wave 2: Core Introspection Queries

*Depends on Wave 1 (needs connection). All query modules are independent of each other.*

### Task 2.2.1: Type mapping — native PG types to NormalizedType

File: `src/introspect/type-map.ts`

- Export `function mapNativeType(nativeType: string, udtName?: string): NormalizedType`
- Mapping table (case-insensitive match on `udt_name` / `data_type`):
  - `text` -> TEXT
  - `character varying` / `varchar` -> VARCHAR
  - `character` / `char` / `bpchar` -> CHAR
  - `smallint` / `int2` -> SMALLINT
  - `integer` / `int4` / `int` -> INTEGER
  - `bigint` / `int8` -> BIGINT
  - `real` / `float4` -> REAL
  - `double precision` / `float8` -> DOUBLE
  - `numeric` / `decimal` -> DECIMAL
  - `boolean` / `bool` -> BOOLEAN
  - `date` -> DATE
  - `time` / `time without time zone` / `timetz` / `time with time zone` -> TIME
  - `timestamp` / `timestamp without time zone` -> TIMESTAMP
  - `timestamp with time zone` / `timestamptz` -> TIMESTAMPTZ
  - `interval` -> INTERVAL
  - `json` -> JSON
  - `jsonb` -> JSONB
  - `uuid` -> UUID
  - `bytea` -> BYTEA
  - `inet` -> INET
  - `cidr` -> CIDR
  - `macaddr` / `macaddr8` -> MACADDR
  - `point` -> POINT
  - `line` / `lseg` / `box` / `path` / `polygon` / `circle` -> LINE
  - `geometry` / `geography` -> GEOMETRY
  - `vector` -> VECTOR
  - `ARRAY` (when `data_type` is `ARRAY`) -> ARRAY
  - `USER-DEFINED` (when `udt_name` matches a known enum) -> ENUM
  - Everything else -> UNKNOWN
- Export `function isSerialType(defaultValue: string | null): boolean`
  - Returns true if default matches `nextval(...)` pattern (serial/bigserial detection)
- Export `function isGeneratedColumn(generationExpression: string | null, isIdentity: string | null): boolean`
  - Returns true if `generation_expression` is non-empty OR `is_identity` is `'ALWAYS'`

### Task 2.2.2: Enum introspection query

File: `src/introspect/queries/enums.ts`

- Export `async function queryEnums(client: pg.Client, schema: string): Promise<Map<string, EnumDef>>`
- Query against `pg_catalog`:
  ```sql
  SELECT
    t.typname AS enum_name,
    n.nspname AS enum_schema,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = $1
  GROUP BY t.typname, n.nspname
  ORDER BY t.typname;
  ```
- Return `Map<string, EnumDef>` keyed by enum name
- Wrap query errors in `IntrospectError('SF2002', 'Failed to introspect enum types')`

### Task 2.2.3: Table and column introspection query

File: `src/introspect/queries/tables.ts`

- Export `async function queryTables(client: pg.Client, schema: string, enumMap: Map<string, EnumDef>): Promise<Map<string, TableDef>>`
- Step 1 -- Fetch table list from `pg_catalog`:
  ```sql
  SELECT
    c.relname AS table_name,
    obj_description(c.oid) AS table_comment
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = $1
    AND c.relkind IN ('r', 'p')  -- regular tables and partitioned tables
  ORDER BY c.relname;
  ```
- Step 2 -- Fetch columns from `information_schema.columns` + `pg_catalog` for each table (single query for all tables in schema):
  ```sql
  SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    c.is_identity,
    c.identity_generation,
    c.is_generated,
    c.generation_expression,
    col_description(
      (SELECT oid FROM pg_class WHERE relname = c.table_name AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)),
      c.ordinal_position
    ) AS column_comment
  FROM information_schema.columns c
  WHERE c.table_schema = $1
  ORDER BY c.table_name, c.ordinal_position;
  ```
- For each column:
  - Call `mapNativeType(data_type, udt_name)` to get `NormalizedType`
  - If `NormalizedType` is ENUM, populate `enumValues` from `enumMap`
  - Call `isSerialType(column_default)` to set `isAutoIncrement`
  - Call `isGeneratedColumn(generation_expression, identity_generation)` to set `isGenerated`
  - Set `hasDefault = column_default !== null || isAutoIncrement || isGenerated`
  - Set `nativeType = udt_name` (preserves the raw PG type name)
- Build `Map<string, ColumnDef>` for each table's columns (keyed by column name)
- Build `Map<string, TableDef>` keyed by table name, initially with empty FK/PK/constraint arrays
- If zero tables found, throw `noTablesFound(schema)` (SF2001)

### Task 2.2.4: Primary key introspection query

File: `src/introspect/queries/primary-keys.ts`

- Export `async function queryPrimaryKeys(client: pg.Client, schema: string): Promise<Map<string, PrimaryKeyDef>>`
- Query `pg_catalog` for PKs (supports composite PKs):
  ```sql
  SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS columns
  FROM pg_constraint con
  JOIN pg_class c ON con.conrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
  WHERE con.contype = 'p'
    AND n.nspname = $1
  GROUP BY c.relname, con.conname
  ORDER BY c.relname;
  ```
- Return `Map<string, PrimaryKeyDef>` keyed by table name
- Composite PKs naturally handled: `columns` array has multiple entries

### Task 2.2.5: Foreign key introspection query

File: `src/introspect/queries/foreign-keys.ts`

- Export `async function queryForeignKeys(client: pg.Client, schema: string): Promise<Map<string, ForeignKeyDef[]>>`
- Query `pg_catalog` (supports composite FKs, deferrable status):
  ```sql
  SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS columns,
    ref_c.relname AS referenced_table,
    ref_n.nspname AS referenced_schema,
    array_agg(ref_a.attname ORDER BY array_position(con.confkey, ref_a.attnum)) AS referenced_columns,
    con.confdeltype AS delete_action,
    con.confupdtype AS update_action,
    con.condeferrable AS is_deferrable,
    con.condeferred AS is_deferred
  FROM pg_constraint con
  JOIN pg_class c ON con.conrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_class ref_c ON con.confrelid = ref_c.oid
  JOIN pg_namespace ref_n ON ref_c.relnamespace = ref_n.oid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
  JOIN pg_attribute ref_a ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = ANY(con.confkey)
  WHERE con.contype = 'f'
    AND n.nspname = $1
  GROUP BY c.relname, con.conname, ref_c.relname, ref_n.nspname,
           con.confdeltype, con.confupdtype, con.condeferrable, con.condeferred
  ORDER BY c.relname, con.conname;
  ```
- Map PG FK action codes to `FKAction` enum:
  - `a` -> NO_ACTION
  - `r` -> RESTRICT
  - `c` -> CASCADE
  - `n` -> SET_NULL
  - `d` -> SET_DEFAULT
- Return `Map<string, ForeignKeyDef[]>` keyed by table name
- Set `isVirtual = false` for all introspected FKs (virtual FKs come from config in Phase 7)

### Task 2.2.6: Unique constraint and index introspection query

File: `src/introspect/queries/unique-indexes.ts`

- Export `async function queryUniqueConstraints(client: pg.Client, schema: string): Promise<Map<string, UniqueConstraintDef[]>>`
  - Query `pg_constraint` where `contype = 'u'`
  - Return multi-column unique constraints grouped by table
- Export `async function queryIndexes(client: pg.Client, schema: string): Promise<Map<string, IndexDef[]>>`
  - Query `pg_index` + `pg_class` + `pg_attribute`
  - Include `indisunique` as `isUnique`
  - Exclude indexes that back PK or unique constraints (avoid duplication)
  - Return grouped by table

### Task 2.2.7: CHECK constraint introspection and value extraction

File: `src/introspect/queries/check-constraints.ts`

- Export `async function queryCheckConstraints(client: pg.Client, schema: string): Promise<Map<string, CheckConstraintDef[]>>`
- Query `pg_constraint` where `contype = 'c'`:
  ```sql
  SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    pg_get_constraintdef(con.oid) AS expression
  FROM pg_constraint con
  JOIN pg_class c ON con.conrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE con.contype = 'c'
    AND n.nspname = $1
  ORDER BY c.relname, con.conname;
  ```
- Export `function extractEnumLikeValues(expression: string): string[] | null`
  - Best-effort parsing of CHECK expression to find enum-like value lists
  - Patterns to match:
    - `CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, ...])))` -> `['active', 'pending', ...]`
    - `CHECK (((status)::text = ANY (...)))` -> same extraction
    - `CHECK ((status IN ('active', 'pending', ...)))` -> `['active', 'pending', ...]`
    - `CHECK (((col)::text = 'value1'::text) OR ((col)::text = 'value2'::text))` -> `['value1', 'value2']`
  - Use regex-based parsing (not a full SQL parser)
  - Return `null` if pattern is not recognized (store raw expression regardless)
  - Strip type casts (`::text`, `::character varying`, etc.) from extracted values

### Task 2.2.8: Unit tests for type mapping

File: `src/introspect/__tests__/type-map.test.ts`

- Test every entry in the type mapping table
- Test case-insensitivity
- Test `isSerialType` with `nextval('seq_name'::regclass)`, non-serial defaults, null
- Test `isGeneratedColumn` with GENERATED ALWAYS identity, GENERATED ALWAYS stored, normal columns
- Test unknown types map to UNKNOWN

### Task 2.2.9: Unit tests for CHECK constraint parsing

File: `src/introspect/__tests__/check-constraints.test.ts`

- Test `extractEnumLikeValues` with:
  - `CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'closed'::text])))` -> `['active', 'pending', 'closed']`
  - `CHECK ((status IN ('a', 'b', 'c')))` -> `['a', 'b', 'c']`
  - `CHECK ((col)::text = ANY (...))` with casts
  - `CHECK (((col)::text = 'x'::text) OR ((col)::text = 'y'::text))` -> `['x', 'y']`
  - `CHECK ((age > 0))` -> `null` (not enum-like)
  - `CHECK ((price >= 0.00))` -> `null`
  - Empty string -> `null`

---

## Wave 3: Introspection Orchestrator

*Depends on Wave 2. Assembles all queries into one cohesive introspection pass.*

### Task 2.3.1: Introspection orchestrator

File: `src/introspect/introspect.ts`

- Export `async function introspect(client: pg.Client, schema: string): Promise<DatabaseSchema>`
- Orchestration steps:
  1. Query enums (Task 2.2.2)
  2. Query tables + columns (Task 2.2.3), passing enum map for ENUM type resolution
  3. In parallel (Promise.all):
     - Query primary keys (Task 2.2.4)
     - Query foreign keys (Task 2.2.5)
     - Query unique constraints + indexes (Task 2.2.6)
     - Query check constraints (Task 2.2.7)
  4. Merge results: iterate over tables, attach PKs, FKs, unique constraints, check constraints, and indexes to each TableDef
  5. For CHECK constraints with `inferredValues`, also set the corresponding column's `enumValues` if the CHECK references a single column and the column doesn't already have enum values from a PG enum type
  6. Warn (stderr) for tables with no primary key (SF2005 warning, non-fatal)
  7. Build and return `DatabaseSchema`:
     - `name`: database name from `SELECT current_database()`
     - `tables`: merged table map
     - `enums`: enum map
     - `schemas`: `[schema]` (single schema for v1)
- Wrap any unexpected query errors in `IntrospectError('SF2004', 'Schema introspection failed: <redacted message>')`

### Task 2.3.2: Module barrel export

File: `src/introspect/index.ts`

- Re-export public API:
  - `introspect` from `./introspect.js`
  - `connect`, `disconnect`, `ConnectOptions` from `./connection.js`
  - `isProductionHost`, `confirmProductionAccess` from `./safety.js`
  - `mapNativeType` from `./type-map.js`
  - `extractEnumLikeValues` from `./queries/check-constraints.js`

### Task 2.3.3: Wire introspection into CLI

File: `src/cli.ts`

- Replace stub action handler with real pipeline:
  1. Call `connect({ connectionString: options.db, schema: options.schema, skipProductionCheck: options.yes, timeoutMs: ... })`
  2. Call `introspect(client, options.schema)`
  3. Call `disconnect(client)`
  4. Print summary: `"Found N tables, M enums in schema 'public'"`
  5. If `--verbose`: print table names, column counts, FK counts
  6. If `--debug`: print full DatabaseSchema as JSON
  7. Wrap in try/catch, render SeedForgeError on failure, ensure disconnect in finally block
- Connection string redaction: ensure `options.db` is NEVER logged directly; use `redactConnectionString()` everywhere

### Task 2.3.4: Update library entry point

File: `src/index.ts`

- Add re-exports from `src/introspect/index.ts` so the library API exposes:
  - `introspect`
  - `connect`, `disconnect`
  - `ConnectOptions`

---

## Wave 4: Integration Tests

*Depends on Wave 3. Requires testcontainers.*

### Task 2.4.1: Install testcontainers dev dependency

- Run `npm install -D @testcontainers/postgresql testcontainers`
- Verify vitest config supports longer timeouts for container startup (set test timeout to 60s for integration tests)
- Add `src/introspect/__tests__/integration/` directory

### Task 2.4.2: Test fixture — complex schema SQL

File: `src/introspect/__tests__/integration/fixtures/complex-schema.sql`

- Create a comprehensive test schema exercising all introspection features:
  ```sql
  -- Enum types
  CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');
  CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');

  -- Users table (serial PK, enum column, generated column)
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'viewer',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    full_display_name TEXT GENERATED ALWAYS AS (name || ' <' || email || '>') STORED
  );

  -- Categories (self-referencing FK)
  CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT
  );

  -- Products (FK to categories, CHECK constraint, numeric types)
  CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'discontinued')),
    tags TEXT[] DEFAULT '{}',
    weight_kg REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Orders (composite FK example, enum type, multiple FKs)
  CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status order_status NOT NULL DEFAULT 'pending',
    total DECIMAL(12,2) NOT NULL,
    shipping_address JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Order items (composite PK, composite FK pattern)
  CREATE TABLE order_items (
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (order_id, product_id)
  );

  -- Audit log (various types, nullable columns)
  CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address INET
  );

  -- Table with IDENTITY column (GENERATED ALWAYS AS IDENTITY)
  CREATE TABLE system_events (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload JSON,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Table with no PK (should trigger SF2005 warning)
  CREATE TABLE migrations (
    version TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Comments
  COMMENT ON TABLE users IS 'Application users';
  COMMENT ON COLUMN users.email IS 'Unique email address';
  COMMENT ON COLUMN users.metadata IS 'Arbitrary user metadata';
  ```

### Task 2.4.3: Integration test — full introspection pipeline

File: `src/introspect/__tests__/integration/introspect.integration.test.ts`

- Use `@testcontainers/postgresql` to spin up a PG container
- Apply `complex-schema.sql` fixture via `pg.Client`
- Run `introspect(client, 'public')`
- Assert on the returned `DatabaseSchema`:
  - **Enums:**
    - `order_status` has values `['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']`
    - `user_role` has values `['admin', 'editor', 'viewer']`
  - **Tables:** 8 tables present (users, categories, products, orders, order_items, audit_log, system_events, migrations)
  - **users table:**
    - `id`: INTEGER, isAutoIncrement=true, hasDefault=true
    - `email`: VARCHAR, maxLength=255, isNullable=false
    - `role`: ENUM, enumValues=`['admin', 'editor', 'viewer']`
    - `metadata`: JSONB, hasDefault=true
    - `full_display_name`: TEXT, isGenerated=true
    - `created_at`: TIMESTAMPTZ
    - PK: `['id']`
    - Unique constraint on `email`
    - Comment: `'Application users'`
  - **categories table:**
    - FK from `parent_id` -> `categories.id` (self-ref), onDelete=SET_NULL
  - **products table:**
    - `id`: UUID, hasDefault=true
    - `category_id`: FK to categories, onDelete=CASCADE
    - `price`: DECIMAL, numericPrecision=10, numericScale=2
    - `status`: CHECK constraint with inferredValues `['draft', 'active', 'discontinued']`
    - `tags`: ARRAY type
  - **order_items table:**
    - Composite PK: `['order_id', 'product_id']`
    - Two FKs (to orders and products)
  - **audit_log table:**
    - CHECK on `action` -> inferredValues `['INSERT', 'UPDATE', 'DELETE']`
    - `ip_address`: INET type
    - `performed_by`: FK to users, onDelete=SET_NULL, isNullable=true
  - **system_events table:**
    - `id`: isGenerated=true (GENERATED ALWAYS AS IDENTITY)
  - **migrations table:**
    - `primaryKey` is null (no PK)

### Task 2.4.4: Integration test — connection error handling

File: `src/introspect/__tests__/integration/connection.integration.test.ts`

- Test connection to running container succeeds
- Test connection to wrong port throws `ConnectionError` with code `SF1001`
- Test connection with wrong password throws `ConnectionError` with code `SF1002`
- Test connection to non-existent database throws `ConnectionError` with code `SF1003`
- Test all error messages have redacted connection strings (no passwords in output)
- Test connection to empty database (no tables) throws `IntrospectError` with code `SF2001`

### Task 2.4.5: Integration test — non-public schema

File: `src/introspect/__tests__/integration/schemas.integration.test.ts`

- Create a custom schema (`CREATE SCHEMA inventory`)
- Create tables within that schema
- Run `introspect(client, 'inventory')`
- Verify tables are found and schema field is `'inventory'`
- Verify FK references across schemas resolve correctly (if applicable)
- Test that default `'public'` schema excludes tables from other schemas

### Task 2.4.6: Configure integration test runner

File: `vitest.config.ts` (update)

- Add a separate test project or test configuration for integration tests:
  - Integration tests match: `src/**/*.integration.test.ts`
  - Timeout: 60_000ms (container startup)
  - Sequential execution (not parallel, to avoid port conflicts)
- Add npm script: `"test:integration": "vitest run --project integration"` or `"vitest run src/**/*.integration.test.ts"`
- Ensure `npm test` still runs only unit tests by default (fast feedback)
- Integration tests run via explicit `npm run test:integration`

---

## Completion Checklist

- [ ] `pg.Client` connects to PostgreSQL via connection string
- [ ] Connection errors (refused, auth, db not found, timeout) mapped to SF1xxx codes with hints
- [ ] All error messages have connection strings redacted
- [ ] Production hostname detection warns on cloud provider hostnames
- [ ] Confirmation prompt blocks on production hosts (unless `--yes`)
- [ ] Enum types introspected with correct value ordering
- [ ] Tables and columns introspected with all metadata (types, nullable, defaults, generated, comments)
- [ ] Native PG types mapped to NormalizedType enum (30+ type mappings)
- [ ] Serial/bigserial detected via `nextval()` default pattern
- [ ] Generated columns detected (GENERATED ALWAYS AS, GENERATED ALWAYS AS IDENTITY)
- [ ] Primary keys introspected, including composite PKs
- [ ] Foreign keys introspected with action types, deferrable status, composite FK support
- [ ] Unique constraints and indexes introspected
- [ ] CHECK constraints introspected with best-effort enum-like value extraction
- [ ] CHECK-inferred values propagated to column `enumValues` when applicable
- [ ] Tables with no PK produce a non-fatal warning
- [ ] CLI wired: `seedforge --db <url>` connects, introspects, prints summary
- [ ] `--schema` flag works for non-public schemas
- [ ] Integration tests pass against real PostgreSQL (testcontainers)
- [ ] Complex test fixture exercises: enums, composite PKs, composite FKs, self-ref, generated columns, CHECK constraints, ARRAY, UUID, JSONB, INET, no-PK tables
- [ ] Unit tests pass for type mapping, CHECK parsing, safety module, connection error mapping
- [ ] `npm test` runs unit tests; `npm run test:integration` runs integration tests

---

## Files Created

```
src/introspect/
  index.ts                          (barrel export)
  connection.ts                     (connect/disconnect with error mapping)
  safety.ts                         (production hostname detection + confirmation)
  introspect.ts                     (orchestrator)
  type-map.ts                       (native PG type -> NormalizedType mapping)
  queries/
    enums.ts                        (pg_catalog enum query)
    tables.ts                       (table + column introspection)
    primary-keys.ts                 (PK introspection, composite support)
    foreign-keys.ts                 (FK introspection, composite + deferrable)
    unique-indexes.ts               (unique constraints + indexes)
    check-constraints.ts            (CHECK introspection + value extraction)
  __tests__/
    safety.test.ts                  (unit: hostname detection)
    connection.test.ts              (unit: error mapping, redaction)
    type-map.test.ts                (unit: type mapping)
    check-constraints.test.ts       (unit: CHECK value extraction)
    integration/
      fixtures/
        complex-schema.sql          (comprehensive test schema)
      introspect.integration.test.ts    (full pipeline)
      connection.integration.test.ts    (connection error scenarios)
      schemas.integration.test.ts       (non-public schema)
```

**Files Modified:**
```
src/errors/index.ts                 (add connectionAborted + sslRequired factories)
src/cli.ts                          (wire introspection pipeline)
src/index.ts                        (re-export introspect module)
vitest.config.ts                    (add integration test config)
package.json                        (add testcontainers dev deps)
```
