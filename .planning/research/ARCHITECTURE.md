# Architecture Research

## Internal Schema Representation

Database-agnostic type system with NormalizedType enum:

```
DatabaseSchema
  └── tables: Map<string, TableDef>
       ├── columns: Map<string, ColumnDef>
       │    ├── dataType: NormalizedType (TEXT, INTEGER, BOOLEAN, UUID, JSON, ENUM, etc.)
       │    ├── nativeType: string (raw DB type)
       │    ├── isNullable, hasDefault, isAutoIncrement, isGenerated
       │    ├── maxLength, numericPrecision, enumValues
       │    └── comment
       ├── primaryKey: PrimaryKeyDef (columns[])
       ├── foreignKeys: ForeignKeyDef[] (columns[], referencedTable, isDeferrable)
       ├── uniqueConstraints: UniqueConstraintDef[]
       └── checkConstraints: CheckConstraintDef[] (expression, inferredValues)
```

Key decisions:
- Composite keys as arrays always (eliminates special-case code)
- Store both normalized AND native types
- CHECK constraint parsing is best-effort (store raw + attempt enum extraction)
- Support virtual FKs (user-declared via config)

## Column-to-Faker Mapping (3-tier heuristic)

1. **Exact name match** (highest priority): ~80 patterns covering person, contact, internet, location, finance, commerce, text, temporal
2. **Pattern/suffix/prefix match**: `_at` → timestamp, `is_*` → boolean, `_url` → URL
3. **Type-based fallback** (lowest): TEXT → lorem, INTEGER → int, BOOLEAN → boolean

Coverage: ~90% of real-world columns. Config overrides handle the rest.
Confidence scoring: HIGH/MEDIUM/LOW reported to user.

## FK Resolution (Kahn's Algorithm)

- Standard topo sort for acyclic graphs
- Cycle detection: remaining nodes after sort
- Cycle resolution strategies (in order):
  1. Break at nullable FK edge (works all DBs)
  2. Deferred constraints (PG/Oracle only)
  3. CTE-based inserts (PG only)
- Self-referencing: insert with NULL, then UPDATE (tree generation)
- Composite FKs: select complete tuples, never mix columns

## Existing Data Awareness

Pre-generation analysis per table:
1. Row count check
2. Sequence/auto-increment state
3. Unique value sampling (exclusion set)
4. FK reference pool (existing + newly generated)

Three modes: augment (default), truncate, error

## Plugin Architecture (v2)

Four plugin types:
1. Schema parsers (Prisma, Drizzle, TypeORM, JPA)
2. Database adapters (PG, MySQL, SQLite)
3. Generator plugins (custom data generators)
4. Output formatters (SQL, CSV, JSON)

Discovery: npm naming convention (`seedforge-plugin-*`) + explicit config

## Config File (.seedforge.yml)

- cosmiconfig-based discovery
- Zero-config works with just connection URL
- Table/column overrides: generators, values, weights, nullable rates
- Exclude patterns for system tables
- Virtual FKs and polymorphic associations
- Environment variable interpolation (${VAR})
- JSON Schema for IDE autocomplete

## Error Handling

Categorized error codes (SF1xxx–SF6xxx):
- SF1xxx: Connection & auth
- SF2xxx: Schema introspection
- SF3xxx: Data generation
- SF4xxx: Data insertion
- SF5xxx: Configuration
- SF6xxx: Plugin errors

Every error: what happened + where + how to fix + error code
Severity levels: FATAL, ERROR, WARNING, INFO
