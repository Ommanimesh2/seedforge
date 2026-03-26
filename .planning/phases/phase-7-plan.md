# Phase 7: Configuration System

**Goal:** `.seedforge.yml` parsing, column overrides, table exclusions, virtual FKs, environment variable interpolation, and config merging with CLI flags.

**Requirements:** REQ-C02, REQ-C11, REQ-C13

**Depends on:** Phase 1 (types, error system, CLI skeleton). Integrates with Phase 4 (mapping overrides), Phase 3 (virtual FKs into dependency graph), and Phase 5/6 (per-table counts, nullable rates, existing data mode). Can be developed in parallel with Phases 5/6 since it produces a standalone config object consumed by other modules.

**Code location:** `src/config/`

**Stack:** `yaml` v2 (already installed, zero transitive deps)

---

## Config Schema Reference

The `.seedforge.yml` file supports the following top-level keys:

```yaml
connection:
  url: "postgres://${DB_USER}:${DB_PASS}@localhost:5432/myapp"
  schema: "public"
seed: 42
count: 100
locale: "en"
existingData:
  mode: "augment"  # augment | truncate | error
tables:
  users:
    count: 500
    columns:
      email:
        generator: "faker.internet.email"
        unique: true
      role:
        values: ["admin", "editor", "viewer"]
        weights: [0.05, 0.25, 0.70]
      bio:
        nullable: 0.3
exclude:
  - schema_migrations
  - _prisma_migrations
  - "pg_*"
  - "*_backup"
virtualForeignKeys:
  - source: { table: "comments", column: "commentable_id" }
    target: { table: "posts", column: "id" }
```

---

## Wave 1: Config Types & Schema Definition

*Foundation types that define the shape of the parsed configuration. All tasks in this wave are independent -- run in parallel.*

### Task 7.1.1: Config type definitions
File: `src/config/types.ts`

Define the TypeScript interfaces for the fully parsed and validated config object. These types represent the **internal** representation after parsing, validation, and env var interpolation -- not the raw YAML shape.

- `ExistingDataMode` enum: `AUGMENT`, `TRUNCATE`, `ERROR`
  - `AUGMENT` (default): add rows alongside existing data
  - `TRUNCATE`: delete existing data before seeding
  - `ERROR`: fail if table already contains rows

- `ColumnOverride` interface:
  - `generator?: string` -- Faker method path (e.g., `"faker.internet.email"`)
  - `unique?: boolean` -- enforce uniqueness for this column
  - `nullable?: number` -- probability (0.0-1.0) that a value is NULL
  - `values?: unknown[]` -- explicit value array to pick from
  - `weights?: number[]` -- optional weights for `values` (must match length)

- `TableConfig` interface:
  - `count?: number` -- per-table row count override
  - `columns?: Record<string, ColumnOverride>` -- column-level overrides keyed by column name

- `VirtualForeignKey` interface:
  - `source: { table: string; column: string }` -- the column that holds the FK reference
  - `target: { table: string; column: string }` -- the column being referenced (typically a PK)

- `ConnectionConfig` interface:
  - `url?: string` -- connection string (after env var interpolation)
  - `schema?: string` -- database schema name

- `SeedforgeConfig` interface (the root config object):
  - `connection: ConnectionConfig`
  - `seed?: number`
  - `count: number` -- global default row count (default: 50)
  - `locale: string` -- Faker locale (default: `"en"`)
  - `existingData: ExistingDataMode` -- default: `AUGMENT`
  - `tables: Record<string, TableConfig>` -- per-table config, keyed by table name
  - `exclude: string[]` -- table exclusion patterns (supports globs)
  - `virtualForeignKeys: VirtualForeignKey[]` -- user-declared FK relationships

Export all types from `src/config/index.ts`.

### Task 7.1.2: Default config factory
File: `src/config/defaults.ts`

Implement `createDefaultConfig(): SeedforgeConfig`:

- Returns a `SeedforgeConfig` with all defaults populated:
  - `connection: { url: undefined, schema: 'public' }`
  - `seed: undefined`
  - `count: 50`
  - `locale: 'en'`
  - `existingData: ExistingDataMode.AUGMENT`
  - `tables: {}`
  - `exclude: []`
  - `virtualForeignKeys: []`

This function is the single source of truth for default values. Used by the config loader as the base that YAML and CLI flags merge into.

---

## Wave 2: Environment Variable Interpolation

*Standalone string processing -- no dependency on YAML parsing. Must be completed before the config loader (Wave 4) since the loader calls it on raw YAML string values.*

### Task 7.2.1: Env var interpolation engine
File: `src/config/env.ts`

Implement `interpolateEnvVars(value: string): string`:

1. Find all occurrences of `${VAR_NAME}` in the input string using the regex `/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g`.
2. For each match, look up `process.env[VAR_NAME]`.
3. If the env var is defined, replace `${VAR_NAME}` with its value.
4. If the env var is NOT defined, throw a `ConfigError` with:
   - Code: `SF5010`
   - Message: `Environment variable "${VAR_NAME}" is not defined`
   - Hints:
     - `Set it with: export ${VAR_NAME}=<value>`
     - `Or remove the \${${VAR_NAME}} reference from .seedforge.yml`
   - Context: `{ variable: VAR_NAME }`
5. Support multiple interpolations in the same string: `"${USER}:${PASS}@${HOST}"`.
6. Literal `$` not followed by `{` is left unchanged.

Also implement `interpolateDeep(obj: unknown): unknown`:

A recursive function that walks an object/array tree and applies `interpolateEnvVars` to every string value it encounters. Non-string primitives (number, boolean, null) pass through unchanged. This is applied to the entire parsed YAML object before validation.

### Task 7.2.2: Env var interpolation tests
File: `src/config/__tests__/env.test.ts`

Test cases for `interpolateEnvVars`:
- Basic substitution: `${HOME}` resolves to `process.env.HOME`
- Multiple vars in one string: `${USER}:${PASS}@${HOST}` with all set
- Undefined var throws `ConfigError` with code `SF5010`
- Literal `$HOME` (no braces) is left unchanged
- Literal `${}` (empty braces) is left unchanged (no match for regex)
- Nested braces `${FOO${BAR}}` -- only inner match attempts resolution
- Empty string input returns empty string

Test cases for `interpolateDeep`:
- Deeply nested object with string values -- all interpolated
- Array of strings -- all interpolated
- Non-string values (numbers, booleans, null) -- unchanged
- Mixed object with strings, numbers, arrays, nested objects

Use `vi.stubEnv()` / `vi.unstubAllEnvs()` (vitest) to control env vars in tests.

---

## Wave 3: Table Exclusion & Glob Matching

*Independent from env vars. Can run in parallel with Wave 2.*

### Task 7.3.1: Glob matcher for table exclusion
File: `src/config/exclude.ts`

Implement `isTableExcluded(tableName: string, patterns: string[]): boolean`:

1. Accept a table name and an array of exclusion patterns.
2. For each pattern, check if it matches the table name.
3. Support two matching modes:
   - **Exact match**: pattern `schema_migrations` matches only `schema_migrations`.
   - **Glob match**: pattern contains `*` or `?` wildcard characters.
     - `*` matches zero or more characters (not including `.`).
     - `?` matches exactly one character.
     - Examples: `pg_*` matches `pg_stat`, `pg_catalog`, etc. `*_backup` matches `users_backup`, `orders_backup`.
4. Matching is case-sensitive.
5. Return `true` if any pattern matches.

Implementation approach: Convert glob patterns to regex internally.
- `*` becomes `[^.]*` (match any chars except dot, to avoid crossing schema boundaries)
- `?` becomes `[^.]`
- Escape all other regex-special characters in the pattern
- Anchor the regex: `^<pattern>$`

Do NOT use any external glob library -- the pattern language is minimal (just `*` and `?`) and a 10-line regex converter is sufficient.

Also implement `filterExcludedTables(tableNames: string[], patterns: string[]): string[]`:
- Returns the subset of `tableNames` that are NOT excluded by any pattern.
- Convenience wrapper around `isTableExcluded`.

### Task 7.3.2: Glob matcher tests
File: `src/config/__tests__/exclude.test.ts`

Test cases for `isTableExcluded`:
- Exact match: `"schema_migrations"` matches `["schema_migrations"]`
- No match: `"users"` does not match `["schema_migrations"]`
- Glob `*` prefix: `"pg_stat"` matches `["pg_*"]`
- Glob `*` suffix: `"users_backup"` matches `["*_backup"]`
- Glob `*` middle: `"test_data_table"` matches `["test_*_table"]`
- Glob `?` wildcard: `"v1"` matches `["v?"]`, `"v12"` does NOT
- Multiple patterns: `"_prisma_migrations"` matches `["schema_migrations", "_prisma_migrations"]`
- No patterns (empty array): always returns `false`
- Case sensitivity: `"Users"` does NOT match `["users"]`

Test cases for `filterExcludedTables`:
- Filters out matching tables, retains non-matching ones
- Empty patterns returns all tables
- All tables excluded returns empty array

---

## Wave 4: YAML Config File Loading & Parsing

*Depends on Wave 1 (types), Wave 2 (env var interpolation). Uses the `yaml` package already installed.*

### Task 7.4.1: Config file discovery
File: `src/config/loader.ts`

Implement `findConfigFile(startDir?: string): string | null`:

1. Starting from `startDir` (defaults to `process.cwd()`), look for `.seedforge.yml` in the directory.
2. Also check for `.seedforge.yaml` (alternate extension).
3. If found, return the absolute path.
4. If not found, walk UP the directory tree (parent directories) until the filesystem root.
5. Return `null` if no config file is found anywhere in the ancestor chain.

This is a simplified cosmiconfig-style discovery. We do NOT search for `seedforge.config.js`, `package.json#seedforge`, etc. -- YAML only for v1.

### Task 7.4.2: YAML parser and raw config extraction
File: `src/config/loader.ts` (same file, additional exports)

Implement `loadConfigFile(filePath: string): Record<string, unknown>`:

1. Read the file using `fs.readFileSync(filePath, 'utf-8')`.
2. Parse using `yaml.parse(content)` (from the `yaml` v2 package).
3. If the YAML is empty or parses to `null`/`undefined`, return `{}`.
4. If parsing throws, catch the error and throw a `ConfigError`:
   - Code: `SF5001`
   - Message: `Invalid YAML syntax in ${filePath}: ${yamlError.message}`
   - Hints: `["Check YAML syntax — common issues: incorrect indentation, tabs instead of spaces"]`
   - Context: `{ filePath, line: yamlError.linePos?.[0]?.line }`
5. If the parsed result is not a plain object (e.g., it's a string or array at the root), throw a `ConfigError`:
   - Code: `SF5002`
   - Message: `Config file must contain a YAML mapping (object) at the top level`
   - Hints: `["The config file should start with key-value pairs, not a list or scalar"]`
6. Apply `interpolateDeep()` to the parsed object before returning.
7. Return the raw parsed object (not yet validated against the config schema).

### Task 7.4.3: Config file discovery and loading tests
File: `src/config/__tests__/loader.test.ts`

Test cases for `findConfigFile`:
- Finds `.seedforge.yml` in the given directory
- Finds `.seedforge.yaml` (alternate extension)
- Prefers `.seedforge.yml` over `.seedforge.yaml` if both exist
- Walks up directories to find config in parent
- Returns `null` when no config file exists

Test cases for `loadConfigFile`:
- Parses valid YAML into a plain object
- Returns `{}` for empty file
- Throws `SF5001` for invalid YAML syntax
- Throws `SF5002` for non-object root (e.g., just a string)
- Interpolates env vars in string values
- Throws `SF5010` for undefined env vars in values

Use `fs.mkdtempSync` and `fs.writeFileSync` to create temporary config files in tests. Clean up in `afterEach`.

---

## Wave 5: Config Validation

*Depends on Wave 1 (types), Wave 4 (loader returns raw object). Validates the raw parsed object and produces a typed `SeedforgeConfig`.*

### Task 7.5.1: Config validator
File: `src/config/validate.ts`

Implement `validateConfig(raw: Record<string, unknown>): SeedforgeConfig`:

This function takes the raw parsed YAML object and validates every field, producing a fully typed `SeedforgeConfig` or throwing a `ConfigError` with an actionable message. Validation is manual (no JSON Schema library) -- field-by-field checking with specific error messages.

**Validation rules:**

Top-level keys:
- Only known keys are allowed: `connection`, `seed`, `count`, `locale`, `existingData`, `tables`, `exclude`, `virtualForeignKeys`. Unknown keys trigger:
  - Code: `SF5003`
  - Message: `Unknown config key "${key}"`
  - Hints: `["Valid keys: connection, seed, count, locale, existingData, tables, exclude, virtualForeignKeys", "Did you mean "${suggestion}"?"]` (include a typo suggestion if edit distance <= 2)

`connection`:
- Must be an object if present.
- `connection.url`: must be a string if present. Validated but NOT required (CLI `--db` can provide it).
- `connection.schema`: must be a string if present.
- Unknown sub-keys -> `SF5003`.

`seed`:
- Must be a non-negative integer if present.
- Non-integer or negative -> `SF5004`, message: `"seed" must be a non-negative integer, got ${typeof value}: ${value}`

`count`:
- Must be a positive integer if present.
- Zero, negative, or non-integer -> `SF5005`, message: `"count" must be a positive integer, got ${value}`

`locale`:
- Must be a string if present.
- No exhaustive locale validation (Faker handles that), but must be a non-empty string.

`existingData`:
- Must be an object if present.
- `existingData.mode`: must be one of `"augment"`, `"truncate"`, `"error"`.
- Invalid mode -> `SF5006`, message: `Invalid existingData.mode: "${value}". Must be one of: augment, truncate, error`

`tables`:
- Must be an object if present. Keys are table names, values are `TableConfig` objects.
- Each table config:
  - `count`: same validation as top-level count (positive integer).
  - `columns`: must be an object if present. Keys are column names, values are `ColumnOverride` objects.
  - Each column override:
    - `generator`: must be a string starting with `"faker."` if present.
      - Invalid format -> `SF5007`, message: `Invalid generator "${value}" for ${table}.${column}. Must be a faker method path like "faker.person.firstName"`
    - `unique`: must be a boolean if present.
    - `nullable`: must be a number between 0.0 and 1.0 if present.
      - Out of range -> `SF5008`, message: `"nullable" for ${table}.${column} must be between 0 and 1, got ${value}`
    - `values`: must be an array if present. Can contain strings, numbers, booleans, or null.
    - `weights`: must be an array of numbers if present.
      - Must have same length as `values` -> `SF5009`, message: `"weights" length (${weights.length}) must match "values" length (${values.length}) for ${table}.${column}`
      - Each weight must be >= 0.
      - Weights do NOT need to sum to 1.0 -- they are relative (normalized at generation time).
    - `values` without `weights` is valid (uniform distribution).
    - `weights` without `values` -> `SF5009`, message: `"weights" requires "values" to be defined for ${table}.${column}`
    - `generator` and `values` are mutually exclusive -> `SF5011`, message: `Cannot specify both "generator" and "values" for ${table}.${column}`
  - Unknown sub-keys under table config -> `SF5003`.
  - Unknown sub-keys under column override -> `SF5003`.

`exclude`:
- Must be an array of strings if present.
- Non-string elements -> `SF5012`, message: `"exclude" must be an array of strings`

`virtualForeignKeys`:
- Must be an array if present.
- Each entry must have `source` and `target` objects, each with `table` (string) and `column` (string).
- Missing or invalid fields -> `SF5013`, message: `Invalid virtualForeignKey at index ${i}: must have source.table, source.column, target.table, and target.column`

**Return value:** The validated `SeedforgeConfig`, with defaults filled in from `createDefaultConfig()` for any missing keys.

### Task 7.5.2: Levenshtein distance helper (for typo suggestions)
File: `src/config/levenshtein.ts`

Implement `levenshtein(a: string, b: string): number`:
- Standard dynamic programming Levenshtein edit distance.
- Used by the validator to suggest "Did you mean X?" when unknown config keys are found.

Implement `suggestKey(unknown: string, validKeys: string[]): string | null`:
- Returns the closest valid key if its edit distance from `unknown` is <= 2.
- Returns `null` if no close match.

### Task 7.5.3: Config validation tests
File: `src/config/__tests__/validate.test.ts`

Test cases — valid configs:
- Minimal config (just `connection.url`) produces correct defaults
- Full config with all fields parses successfully
- `tables` with column overrides: generator, values, values+weights, nullable, unique

Test cases — error conditions (each should throw `ConfigError` with the specified code):
- Unknown top-level key -> `SF5003` with typo suggestion
- `seed` as string -> `SF5004`
- `seed` as negative number -> `SF5004`
- `count` as 0 -> `SF5005`
- `count` as float -> `SF5005`
- Invalid `existingData.mode` -> `SF5006`
- `generator` not starting with `faker.` -> `SF5007`
- `nullable` as 1.5 -> `SF5008`
- `nullable` as -0.1 -> `SF5008`
- `weights` length mismatch with `values` -> `SF5009`
- `weights` without `values` -> `SF5009`
- Both `generator` and `values` on same column -> `SF5011`
- `exclude` with non-string element -> `SF5012`
- `virtualForeignKeys` entry missing `source.table` -> `SF5013`
- Unknown key in column override -> `SF5003`

---

## Wave 6: Config Merging (CLI flags override config file)

*Depends on Wave 1 (types), Wave 5 (validated config). This wave implements the three-layer merge: defaults < config file < CLI flags.*

### Task 7.6.1: Config merger
File: `src/config/merge.ts`

Implement `mergeCliIntoConfig(config: SeedforgeConfig, cli: CliOverrides): SeedforgeConfig`:

Define `CliOverrides` interface (the subset of CLI options that can override config):
```
CliOverrides {
  db?: string         // --db flag
  count?: number      // --count flag
  seed?: number       // --seed flag
  schema?: string     // --schema flag
  exclude?: string[]  // --exclude flag
  dryRun?: boolean    // --dry-run flag
  output?: string     // --output flag
}
```

Merge strategy (CLI wins over config file):
1. `config.connection.url`: use `cli.db` if provided, else keep config value.
2. `config.connection.schema`: use `cli.schema` if provided, else keep config value.
3. `config.count`: use `cli.count` if provided AND different from the Commander default (50), else keep config value. This is important: if the user does not pass `--count`, Commander fills in 50 as the default, which would always override the config file. To handle this, the CLI should pass `undefined` when the flag is not explicitly provided. Document this in the task.
4. `config.seed`: use `cli.seed` if provided, else keep config value.
5. `config.exclude`: if `cli.exclude` is provided and non-empty, APPEND to config exclude patterns (union, deduplicated). CLI exclusions add to, not replace, config exclusions.

Note: `dryRun` and `output` are CLI-only concerns and do not exist in the config file schema. They are passed through as-is without merging.

Return a new `SeedforgeConfig` (do not mutate the input).

### Task 7.6.2: Config merger tests
File: `src/config/__tests__/merge.test.ts`

Test cases:
- CLI `db` overrides config `connection.url`
- CLI `schema` overrides config `connection.schema`
- CLI `count` overrides config `count`
- CLI `seed` overrides config `seed`
- CLI `exclude` appends to config `exclude` (no duplicates)
- Unset CLI fields do not override config values
- Returned config is a new object (original not mutated)
- Config with no CLI overrides returns equivalent config

---

## Wave 7: Virtual FK Integration

*Depends on Wave 1 (types) and Wave 5 (validated config with virtualForeignKeys). This wave converts virtual FK declarations into `ForeignKeyDef` objects that the existing graph module can consume.*

### Task 7.7.1: Virtual FK converter
File: `src/config/virtual-fk.ts`

Implement `injectVirtualForeignKeys(schema: DatabaseSchema, virtualFKs: VirtualForeignKey[]): DatabaseSchema`:

1. For each virtual FK declaration:
   a. Verify that `source.table` exists in `schema.tables`. If not, throw `ConfigError`:
      - Code: `SF5014`
      - Message: `Virtual FK references unknown source table "${source.table}"`
      - Hints: `["Check the table name in virtualForeignKeys[${i}].source.table", "Available tables: ${availableTables}"]`
   b. Verify that `source.column` exists in `schema.tables[source.table].columns`. If not, throw `ConfigError`:
      - Code: `SF5015`
      - Message: `Virtual FK references unknown source column "${source.table}.${source.column}"`
   c. Verify that `target.table` exists in `schema.tables`. If not, throw `ConfigError`:
      - Code: `SF5014` (same code, different message)
      - Message: `Virtual FK references unknown target table "${target.table}"`
   d. Verify that `target.column` exists in `schema.tables[target.table].columns`. If not, throw `ConfigError`:
      - Code: `SF5015`
   e. Create a `ForeignKeyDef`:
      - `name: "virtual_fk_${source.table}_${source.column}"` (synthetic name)
      - `columns: [source.column]`
      - `referencedTable: target.table`
      - `referencedSchema: schema.tables[target.table].schema`
      - `referencedColumns: [target.column]`
      - `onDelete: FKAction.NO_ACTION`
      - `onUpdate: FKAction.NO_ACTION`
      - `isDeferrable: false`
      - `isDeferred: false`
      - `isVirtual: true` (the `isVirtual` flag already exists on `ForeignKeyDef`)
   f. Append the FK to `schema.tables[source.table].foreignKeys`.

2. Return the modified schema. It is acceptable to mutate the input schema in place (it is already a working copy at this point in the pipeline), but document this.

Note: The `isVirtual: true` flag on `ForeignKeyDef` was designed for this purpose in Phase 1. The graph module already processes all FKs uniformly, so virtual FKs will automatically participate in topological sorting and cycle detection with no changes to the graph code.

### Task 7.7.2: Virtual FK tests
File: `src/config/__tests__/virtual-fk.test.ts`

Test cases:
- Valid virtual FK is injected as a `ForeignKeyDef` with `isVirtual: true`
- Multiple virtual FKs are all injected
- Source table not found -> `SF5014`
- Source column not found -> `SF5015`
- Target table not found -> `SF5014`
- Target column not found -> `SF5015`
- Virtual FK affects dependency graph (test by calling `buildDependencyGraph` after injection)
- Virtual FK with self-referencing table works correctly

---

## Wave 8: Generator Override Resolution

*Depends on Wave 1 (types), Wave 5 (validated config), and Phase 4 (mapping types). This wave resolves `generator: "faker.person.firstName"` strings into actual `GeneratorFn` callables.*

### Task 7.8.1: Generator resolver
File: `src/config/generator-resolver.ts`

Implement `resolveGenerator(generatorPath: string): GeneratorFn`:

1. Parse the generator path: split on `.` to get segments. Example: `"faker.person.firstName"` -> `["faker", "person", "firstName"]`.
2. The first segment must be `"faker"` (already validated in Wave 5).
3. Walk the Faker instance to resolve the method:
   - Start with a Faker instance (`import { faker } from '@faker-js/faker'`).
   - Traverse: `faker["person"]["firstName"]`.
   - If any segment is not found, throw `ConfigError`:
     - Code: `SF5016`
     - Message: `Unknown faker method: "${generatorPath}"`
     - Hints: `["Check the @faker-js/faker documentation for available methods", "Common methods: faker.person.firstName, faker.internet.email, faker.lorem.word"]`
   - If the final resolved value is not a function, throw `ConfigError`:
     - Code: `SF5016`
     - Message: `"${generatorPath}" is not a callable faker method`
4. Return a `GeneratorFn` that wraps the resolved method:
   ```
   (faker, rowIndex) => resolvedMethod.call(parentObject)
   ```
   The returned `GeneratorFn` should use the SEEDED faker instance passed as argument, not the global one. Therefore, the path resolution at config load time is for validation only. At generation time, the actual call must traverse the seeded faker instance.

Implementation detail for seeded resolution: Store the path segments (minus the `"faker"` prefix) and at call time walk the seeded faker instance:

```
function resolveGenerator(generatorPath: string): GeneratorFn {
  // Validate against the global faker at config load time
  // Return a GeneratorFn that resolves against the seeded faker at call time
  const segments = generatorPath.split('.').slice(1) // remove "faker"
  // ... validation ...
  return (seededFaker, _rowIndex) => {
    let obj: unknown = seededFaker
    for (const seg of segments.slice(0, -1)) {
      obj = (obj as Record<string, unknown>)[seg]
    }
    const method = segments[segments.length - 1]
    return (obj as Record<string, CallableFunction>)[method]()
  }
}
```

Also implement `resolveColumnOverrides(tableConfig: TableConfig): Map<string, ColumnMapping>`:

For each column in `tableConfig.columns`, produce a `ColumnMapping` from the override:
- If `generator` is set: resolve it via `resolveGenerator` and produce a mapping with `source: MappingSource.EXACT_NAME`, `confidence: ConfidenceLevel.HIGH`, `domain: "config_override"`, `fakerMethod: generatorPath`.
- If `values` is set (with or without `weights`): produce a `GeneratorFn` that selects from the values array using weighted random selection. Use `faker.helpers.weightedArrayElement` if weights are provided, or `faker.helpers.arrayElement` for uniform.
- The returned mappings REPLACE heuristic mappings for those columns (config overrides are highest priority).

### Task 7.8.2: Generator resolver tests
File: `src/config/__tests__/generator-resolver.test.ts`

Test cases for `resolveGenerator`:
- Valid path `"faker.person.firstName"` produces a callable GeneratorFn
- Valid nested path `"faker.internet.email"` works
- Invalid path `"faker.nonexistent.method"` -> `SF5016`
- Non-function path `"faker.person"` (a namespace, not a method) -> `SF5016`
- Generator uses the seeded faker instance (verify deterministic output with two different seeds)

Test cases for `resolveColumnOverrides`:
- Column with `generator` override produces a ColumnMapping with `domain: "config_override"`
- Column with `values` produces a GeneratorFn that only returns values from the array
- Column with `values` + `weights` produces weighted distribution (statistical test: generate 1000 values and check distribution is roughly proportional to weights)
- Returns empty map when no columns are defined

---

## Wave 9: Top-Level Config Loader (Orchestrator)

*Depends on all previous waves. This is the public API that the CLI and pipeline call.*

### Task 7.9.1: Config orchestrator
File: `src/config/loader.ts` (extend the existing file from Wave 4)

Implement `loadConfig(options?: LoadConfigOptions): SeedforgeConfig`:

```
LoadConfigOptions {
  configPath?: string     // explicit path to config file (skip discovery)
  cwd?: string            // working directory for config file discovery
}
```

Orchestration steps:
1. Discover config file: if `options.configPath` is provided, use it directly. Otherwise, call `findConfigFile(options.cwd)`.
2. If no config file found, return `createDefaultConfig()`.
3. Load and parse the YAML file via `loadConfigFile(filePath)`.
4. Validate the raw object via `validateConfig(raw)`.
5. Return the validated `SeedforgeConfig`.

Implement `loadAndMergeConfig(cliOptions: CliOverrides, loadOptions?: LoadConfigOptions): SeedforgeConfig`:

Full pipeline:
1. Call `loadConfig(loadOptions)` to get the file-based config.
2. Call `mergeCliIntoConfig(config, cliOptions)` to apply CLI overrides.
3. Final validation: if `config.connection.url` is still undefined after merge, that is OK at this stage -- the CLI action handler will check for it separately (it is a required CLI flag).
4. Return the final merged config.

### Task 7.9.2: Integration test for full config pipeline
File: `src/config/__tests__/integration.test.ts`

Test cases:
- No config file + CLI defaults produces default config
- Config file with `count: 200` + no CLI override -> count is 200
- Config file with `count: 200` + CLI `--count 500` -> count is 500
- Config file with `exclude: ["pg_*"]` + CLI `--exclude users` -> exclude is `["pg_*", "users"]`
- Config file with env var `${DATABASE_URL}` in connection.url resolves correctly
- Config file with undefined env var throws `SF5010`
- Invalid YAML syntax throws `SF5001`
- Unknown keys throw `SF5003` with suggestions
- Full realistic config file (all features) loads successfully
- `virtualForeignKeys` are parsed and available in the result
- Column overrides with generators are parsed (not yet resolved -- that happens at generation time)
- Column overrides with values + weights are parsed

---

## Wave 10: CLI Integration

*Depends on Wave 9 (config orchestrator) and the existing CLI (src/cli.ts). Wires the config system into the CLI action handler.*

### Task 7.10.1: Update CLI to load config
File: `src/cli.ts` (modify existing)

Changes to the CLI action handler:

1. Add a `--config <path>` flag to commander:
   - Optional. If provided, use this path instead of automatic discovery.
   - Flag: `--config <path>`, description: `"path to .seedforge.yml config file"`

2. At the top of the action handler (before connecting to the DB):
   a. Build `CliOverrides` from the parsed commander options. Important: detect which flags were explicitly passed vs. which have Commander defaults. Use `program.getOptionValue()` and `program.getOptionValueSource()` to distinguish `"default"` from `"cli"` sources. Only include in `CliOverrides` values where the source is `"cli"`.
   b. Call `loadAndMergeConfig(cliOverrides, { configPath: options.config })`.
   c. Use the merged config for:
      - `connection.url` as the DB connection string (fall back to `--db` which is required).
      - `connection.schema` for the schema to introspect.
      - `config.count` as the global row count.
      - `config.seed` as the PRNG seed.
      - `config.exclude` for table exclusion.

3. Log the config source in verbose mode:
   - `"Config loaded from /path/to/.seedforge.yml"` if a file was found.
   - `"No config file found, using defaults"` if not.

4. The `--db` flag remains required in commander. If the user provides `connection.url` in the config file, they can skip `--db` on the command line. To support this:
   - Change `--db` from `requiredOption` to `option` (optional).
   - After config merge, check if `connection.url` is available from either source.
   - If neither config nor CLI provides a connection URL, throw `ConfigError`:
     - Code: `SF5017`
     - Message: `No database connection URL provided`
     - Hints: `["Pass --db <url> on the command line", "Or set connection.url in .seedforge.yml", "Or set DATABASE_URL environment variable and use ${DATABASE_URL} in config"]`

### Task 7.10.2: CLI config integration tests
File: `src/config/__tests__/cli-integration.test.ts`

Test cases (unit tests that create a commander program and parse args):
- `--config /path/to/file` flag is parsed
- Config file values are used when CLI flags are not provided
- CLI `--count` overrides config file `count`
- CLI `--seed` overrides config file `seed`
- CLI `--exclude` appends to config file `exclude`
- `--db` is no longer required if `connection.url` is in config
- Missing both `--db` and config `connection.url` throws `SF5017`

---

## Wave 11: Module Exports & Barrel File

*Depends on all previous waves. Wires up the public API.*

### Task 7.11.1: Config module barrel export
File: `src/config/index.ts` (create/update)

Export the public API:

```typescript
// Types
export { ExistingDataMode, type ColumnOverride, type TableConfig,
         type VirtualForeignKey, type ConnectionConfig,
         type SeedforgeConfig, type CliOverrides } from './types.js'

// Defaults
export { createDefaultConfig } from './defaults.js'

// Env interpolation
export { interpolateEnvVars, interpolateDeep } from './env.js'

// Table exclusion
export { isTableExcluded, filterExcludedTables } from './exclude.js'

// Loader
export { findConfigFile, loadConfigFile, loadConfig,
         loadAndMergeConfig } from './loader.js'

// Validation
export { validateConfig } from './validate.js'

// Merge
export { mergeCliIntoConfig } from './merge.js'

// Virtual FKs
export { injectVirtualForeignKeys } from './virtual-fk.js'

// Generator resolution
export { resolveGenerator, resolveColumnOverrides } from './generator-resolver.js'

// Levenshtein (internal, but exported for testing)
export { levenshtein, suggestKey } from './levenshtein.js'
```

Update `src/index.ts` to include:
```typescript
export * from './config/index.js'
```

### Task 7.11.2: Verify build and full test suite
- Run `npm run build` and verify no TypeScript errors.
- Run `npm test` and verify all tests pass (existing + new).
- Run `npm run lint` and verify no lint errors.

---

## Error Code Reference

All errors in Phase 7 use the `SF5xxx` range (`ConfigError` subclass):

| Code | Condition | Thrown By |
|------|-----------|-----------|
| SF5001 | Invalid YAML syntax | `loadConfigFile` |
| SF5002 | Config root is not an object | `loadConfigFile` |
| SF5003 | Unknown config key (with typo suggestion) | `validateConfig` |
| SF5004 | `seed` is not a non-negative integer | `validateConfig` |
| SF5005 | `count` is not a positive integer | `validateConfig` |
| SF5006 | Invalid `existingData.mode` | `validateConfig` |
| SF5007 | Invalid generator path format | `validateConfig` |
| SF5008 | `nullable` out of range [0, 1] | `validateConfig` |
| SF5009 | `weights`/`values` length mismatch or weights without values | `validateConfig` |
| SF5010 | Undefined environment variable | `interpolateEnvVars` |
| SF5011 | Both `generator` and `values` on same column | `validateConfig` |
| SF5012 | `exclude` contains non-string element | `validateConfig` |
| SF5013 | Invalid `virtualForeignKeys` entry | `validateConfig` |
| SF5014 | Virtual FK references unknown table | `injectVirtualForeignKeys` |
| SF5015 | Virtual FK references unknown column | `injectVirtualForeignKeys` |
| SF5016 | Unknown or non-callable faker method | `resolveGenerator` |
| SF5017 | No connection URL from config or CLI | CLI action handler |

---

## Files Created / Modified

```
src/config/
  types.ts                    (NEW — Wave 1)
  defaults.ts                 (NEW — Wave 1)
  env.ts                      (NEW — Wave 2)
  exclude.ts                  (NEW — Wave 3)
  loader.ts                   (NEW — Wave 4, extended Wave 9)
  validate.ts                 (NEW — Wave 5)
  levenshtein.ts              (NEW — Wave 5)
  merge.ts                    (NEW — Wave 6)
  virtual-fk.ts               (NEW — Wave 7)
  generator-resolver.ts       (NEW — Wave 8)
  index.ts                    (NEW — Wave 11)
  __tests__/
    env.test.ts               (NEW — Wave 2)
    exclude.test.ts           (NEW — Wave 3)
    loader.test.ts            (NEW — Wave 4)
    validate.test.ts          (NEW — Wave 5)
    merge.test.ts             (NEW — Wave 6)
    virtual-fk.test.ts        (NEW — Wave 7)
    generator-resolver.test.ts (NEW — Wave 8)
    integration.test.ts       (NEW — Wave 9)
    cli-integration.test.ts   (NEW — Wave 10)

src/cli.ts                    (MODIFIED — Wave 10)
src/index.ts                  (MODIFIED — Wave 11)
```

---

## Completion Checklist

- [ ] `SeedforgeConfig` type represents the full validated config
- [ ] `createDefaultConfig()` returns sensible defaults
- [ ] `${VAR}` env var interpolation works in all string values
- [ ] Undefined env vars throw `SF5010` with actionable message
- [ ] Glob patterns in `exclude` correctly match table names (`*`, `?`)
- [ ] `.seedforge.yml` discovered via directory traversal
- [ ] `.seedforge.yaml` alternate extension supported
- [ ] Valid YAML parsed correctly
- [ ] Invalid YAML throws `SF5001` with line number
- [ ] All 15 validation rules produce correct `SF5xxx` errors with hints
- [ ] Unknown keys suggest typo corrections via Levenshtein distance
- [ ] `generator` and `values` are mutually exclusive
- [ ] `weights` requires `values` and must match length
- [ ] CLI flags override config file values (merge priority correct)
- [ ] `--exclude` appends to (not replaces) config excludes
- [ ] Virtual FKs converted to `ForeignKeyDef` with `isVirtual: true`
- [ ] Virtual FK table/column references validated against schema
- [ ] `faker.*` generator paths resolved and validated against Faker API
- [ ] Generator resolution uses seeded faker at call time (deterministic)
- [ ] Values with weights produce weighted random selection
- [ ] `--db` is optional when `connection.url` is in config
- [ ] Missing both `--db` and config URL throws `SF5017`
- [ ] `--config <path>` flag works
- [ ] Config source logged in verbose mode
- [ ] All new tests pass
- [ ] Build clean, lint clean
- [ ] Existing tests unbroken

---

## Parallelism Summary

```
Wave 1 (Types + Defaults)
  |
  ├──→ Wave 2 (Env Vars) ──┐
  |                         |
  ├──→ Wave 3 (Glob/Exclude)├──→ Wave 4 (YAML Loader) ──→ Wave 5 (Validation)
  |                         |         |                         |
  └─────────────────────────┘         └──→ Wave 6 (Merge) ─────┤
                                                                |
                                      Wave 7 (Virtual FKs) ────┤
                                                                |
                                      Wave 8 (Generator Res.) ─┤
                                                                |
                                                          Wave 9 (Orchestrator)
                                                                |
                                                          Wave 10 (CLI Integration)
                                                                |
                                                          Wave 11 (Exports + Verify)
```

Waves 2 and 3 can run in parallel.
Waves 6, 7, and 8 can run in parallel (all depend on Wave 5 for validation types but not on each other).
Waves 9-11 are sequential.
