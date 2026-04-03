# seedforge

**Generate realistic seed data from your database schema. Zero config required.**

Point seedforge at any database -- PostgreSQL, MySQL, or SQLite -- and it produces INSERT statements with data that actually looks real. Names in name columns, emails in email columns, prices in price columns. It reads your schema, resolves foreign keys, and just works.

Works with live databases and ORM schema files (Prisma, Drizzle, TypeORM, JPA). Use it from the CLI or import the programmatic API into your tests.

## Quick Demo

```
$ seedforge --db postgres://localhost/myapp --count 10

seedforge v2.1.0
Introspected 8 tables, 2 enums, 12 foreign keys
Insert order: countries -> users -> categories -> products -> orders -> order_items -> reviews -> audit_log
Generated 80 rows across 8 tables

Seeding complete:
  Tables:  8
  Rows:    80
  Time:    142ms
  Mode:    DIRECT
```

Query the result:

```sql
SELECT first_name, last_name, email, created_at FROM users LIMIT 5;
```

```
 first_name | last_name |           email            |     created_at
------------+-----------+----------------------------+---------------------
 Marcus     | Chen      | marcus.chen@example.com    | 2025-09-14 08:23:01
 Fatima     | Okafor    | fatima.okafor@example.com  | 2025-11-02 14:45:33
 Lena       | Johansson | lena.johansson@example.com | 2025-12-01 09:12:47
 Diego      | Reyes     | diego.reyes@example.com    | 2026-01-18 16:30:22
 Aisha      | Patel     | aisha.patel@example.com    | 2026-02-25 11:05:59
```

Not random gibberish. Real-looking data with correct relationships.

## Install

```bash
npm install -g @otg-dev/seedforge
```

Or run without installing:

```bash
npx @otg-dev/seedforge --db postgres://localhost/mydb
```

For programmatic use in your project:

```bash
npm install @otg-dev/seedforge
```

## Quick Start

### CLI

```bash
# Seed a PostgreSQL database (50 rows per table by default)
seedforge --db postgres://localhost/mydb

# MySQL
seedforge --db mysql://root:pass@localhost/mydb

# SQLite
seedforge --db sqlite:///path/to/database.db

# 100 rows per table, deterministic output
seedforge --db postgres://localhost/mydb --count 100 --seed 42

# Export to a SQL file
seedforge --db postgres://localhost/mydb --output seed.sql

# Preview without touching the database
seedforge --db postgres://localhost/mydb --dry-run

# Seed from a Prisma schema (no running database needed for SQL file output)
seedforge --prisma ./prisma/schema.prisma --output seed.sql

# Seed from Drizzle, TypeORM, or JPA schemas
seedforge --drizzle ./src/db/schema.ts --output seed.sql
seedforge --typeorm ./src/entities/ --output seed.sql
seedforge --jpa ./src/main/java/com/example/entities/ --output seed.sql

# Fast mode: COPY-based insertion for PostgreSQL (10x+ faster)
seedforge --db postgres://localhost/mydb --count 10000 --fast

# Use a config file for fine-grained control
seedforge --config .seedforge.yml
```

### Programmatic API

```typescript
import { seed, createSeeder, withSeed } from '@otg-dev/seedforge'

// One-liner: seed everything and get results
const result = await seed('postgres://localhost/testdb', {
  count: 100,
  seed: 42,
})
console.log(`Generated ${result.rowCount} rows in ${result.duration}ms`)

// Stateful seeder: persistent connection, per-table control
const seeder = await createSeeder('postgres://localhost/testdb', {
  seed: 42,
  transaction: true,
})
const users = await seeder.seed('users', 10)
const posts = await seeder.seed('posts', 50)
await seeder.teardown() // rolls back everything

// Test helper: automatic transaction + cleanup
const { seed: seedTable, teardown } = withSeed('postgres://localhost/testdb', {
  seed: 42,
  transaction: true,
})
const rows = await seedTable('users', 5)
// ... run assertions ...
await teardown() // rolls back all seeded data
```

See [USAGE.md](USAGE.md) for the full programmatic API reference with examples.

## Features

### Schema Sources
- **Multi-database** -- PostgreSQL (v12+), MySQL (v5.7+), SQLite3 via live introspection
- **Prisma** -- parse `.prisma` schema files directly
- **Drizzle** -- parse Drizzle ORM schema files (TypeScript/JavaScript)
- **TypeORM** -- parse TypeORM entity classes with decorators
- **JPA/Hibernate** -- parse Java entity classes with annotations
- **Plugins** -- extend with custom schema parsers and data generators

### Data Generation
- **190+ column patterns** -- detects column semantics from names (email, phone, price, address, first_name, etc.) across 10 domains and generates matching Faker.js data
- **Multi-tier matching** -- exact name -> suffix -> prefix -> regex -> stem-based semantic matching with confidence levels
- **Constraint-safe** -- respects NOT NULL, UNIQUE, CHECK constraints, enum types, and generated columns
- **JSON/JSONB support** -- generates valid JSON objects for JSON columns
- **UUID primary keys** -- generates valid UUIDs for UUID PK columns
- **Composite keys** -- handles composite primary keys and composite foreign keys
- **Safe emails** -- all generated emails use RFC 2606 reserved domains (@example.com)
- **Deterministic output** -- pass `--seed` to get identical data every time, for reproducible CI/CD

### Relationships
- **Foreign key resolution** -- topologically sorts tables and inserts in dependency order
- **Circular references** -- detects cycles and resolves them with deferred UPDATEs
- **Self-referencing tables** -- generates tree structures with NULL roots, then fills parent references
- **Cardinality control** -- configure min..max child rows per parent with uniform, zipf, or normal distributions
- **Existing data aware** -- augments existing data without unique constraint violations; resets sequences after seeding

### Output & Performance
- **Multiple output modes** -- insert directly, write a `.sql` file, or dry-run to preview
- **Fast mode** -- PostgreSQL COPY-based bulk insertion (10x+ faster for large datasets)
- **Auto-batch tuning** -- optimal batch sizes calculated per table
- **Streaming generation** -- memory-efficient generation for very large datasets

### Safety & Configuration
- **Production safety** -- warns before seeding databases that look like production (RDS, Cloud SQL, Neon, Supabase, etc.) and requires `--yes` to override
- **Config file support** -- fine-tune per-table row counts, column overrides, value weights, cardinality, and table exclusions via `.seedforge.yml`
- **Environment variables** -- interpolate `${DATABASE_URL}` in config files
- **Programmatic API** -- four-tier API from one-liner to test helper, with transaction support

## Configuration

Create a `.seedforge.yml` in your project root for full control:

```yaml
connection:
  url: ${DATABASE_URL}
  schema: public

count: 100
seed: 42

tables:
  users:
    count: 200
    columns:
      email:
        generator: faker.internet.email
        unique: true
      role:
        values: [admin, user, moderator]
        weights: [0.05, 0.9, 0.05]
      bio:
        nullable: 0.3
    relationships:
      orders:
        cardinality: "1..5"
        distribution: zipf

  products:
    columns:
      price:
        generator: faker.commerce.price

exclude:
  - schema_migrations
  - _prisma_migrations
  - pg_*
```

Environment variables are interpolated with `${VAR}` syntax. Table exclusion supports glob patterns.

## CLI Reference

```
Usage: seedforge [options]

Generate realistic seed data from your database schema

Options:
  --db <url>              Database connection string (postgres://, mysql://, sqlite://)
  --prisma <path>         Path to Prisma schema file (.prisma)
  --drizzle <path>        Path to Drizzle schema file or directory
  --typeorm <path>        Path to TypeORM entity directory
  --jpa <path>            Path to JPA entity directory
  --plugin <paths...>     Paths to plugin modules
  --config <path>         Path to .seedforge.yml config file
  --count <number>        Rows per table (default: 50)
  --seed <number>         PRNG seed for deterministic output
  --dry-run               Preview without executing
  --output <file>         SQL file export path
  --schema <name>         Database schema to introspect (default: "public")
  --exclude <tables...>   Tables to skip
  --fast                  Use COPY-based insertion for PostgreSQL (faster)
  --verbose               Verbose logging
  --quiet                 Suppress non-essential output
  --debug                 Debug logging
  --json                  Machine-readable JSON output
  --yes                   Skip confirmation prompts
  -V, --version           Output the version number
  -h, --help              Display help for command

Examples:
  $ seedforge --db postgres://localhost/mydb
  $ seedforge --db mysql://root:pass@localhost/mydb
  $ seedforge --db sqlite:///path/to/db.sqlite
  $ seedforge --db postgres://localhost/mydb --count 100 --seed 42
  $ seedforge --db postgres://localhost/mydb --output seed.sql --dry-run
  $ seedforge --prisma ./prisma/schema.prisma --output seed.sql
  $ seedforge --drizzle ./src/db/schema.ts --db postgres://localhost/mydb
  $ seedforge --config .seedforge.yml
```

## How It Works

1. **Introspect** -- connects to your database and reads the catalog (pg_catalog, information_schema, or sqlite_master), or parses your ORM schema files (Prisma, Drizzle, TypeORM, JPA)
2. **Resolve dependencies** -- builds a directed graph of FK relationships, detects cycles, and produces a topological insertion order with deferred UPDATEs for cycles
3. **Map columns** -- analyzes 190+ column name patterns across 10 domains to select appropriate Faker.js generators (e.g., `first_name` -> `faker.person.firstName()`)
4. **Generate** -- produces rows table-by-table in dependency order, threading FK references, enforcing uniqueness, respecting constraints, and applying cardinality distributions
5. **Output** -- inserts directly into the database (with sequence reset), writes a SQL file, or prints a dry-run summary

## Supported Databases

| Database   | Introspection | Direct Insert | COPY (fast) | File Export |
|------------|:---:|:---:|:---:|:---:|
| PostgreSQL | yes | yes | yes | yes |
| MySQL      | yes | yes | --  | yes |
| SQLite     | yes | yes | --  | yes |

## Supported Schema Parsers

| Parser  | Source Type | Live DB Required |
|---------|------------|:---:|
| Prisma  | `.prisma` files | No (for file output) |
| Drizzle | TypeScript/JavaScript schema files | No (for file output) |
| TypeORM | TypeScript entity classes with decorators | No (for file output) |
| JPA     | Java entity classes with annotations | No (for file output) |

## Supported Column Types

TEXT, VARCHAR, CHAR, INTEGER, BIGINT, SMALLINT, SERIAL, BIGSERIAL, REAL, DOUBLE, DECIMAL, NUMERIC, BOOLEAN, DATE, TIME, TIMESTAMP, TIMESTAMPTZ, INTERVAL, UUID, JSON, JSONB, BYTEA, INET, CIDR, MACADDR, ARRAY, ENUM, POINT, and more. Unknown types fall back to safe defaults.

## Column Pattern Domains

seedforge recognizes column semantics across 10 domains:

| Domain | Example Columns | Example Output |
|--------|----------------|----------------|
| Person | `first_name`, `last_name`, `age` | Marcus, Chen, 34 |
| Contact | `email`, `phone` | marcus@example.com, +1-555-0123 |
| Internet | `url`, `domain`, `ip_address` | https://example.com, 192.168.1.1 |
| Location | `city`, `country`, `zipcode` | San Francisco, US, 94102 |
| Finance | `price`, `amount`, `currency` | 29.99, 1500.00, USD |
| Commerce | `product_name`, `category`, `sku` | Wireless Headphones, Electronics |
| Text | `description`, `body`, `comment` | Lorem ipsum dolor sit amet... |
| Temporal | `created_at`, `updated_at`, `birthdate` | 2025-09-14T08:23:01Z |
| Boolean | `is_active`, `has_verified`, `enabled` | true, false |
| Identifiers | `uuid`, `slug`, `code` | 550e8400-e29b-41d4-a716-446655440000 |

## Plugin System

Extend seedforge with custom schema parsers and data generators:

```typescript
// my-parser-plugin.ts
import type { SchemaParserPlugin } from '@otg-dev/seedforge'

const plugin: SchemaParserPlugin = {
  name: 'my-parser',
  version: '1.0.0',
  filePatterns: ['*.myorm'],
  detect: async (projectRoot) => { /* ... */ },
  parse: async (projectRoot) => { /* ... */ },
}

export default plugin
```

```bash
seedforge --plugin ./my-parser-plugin.ts --output seed.sql
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE)
