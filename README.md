# seedforge

**Generate realistic seed data from your PostgreSQL schema. Zero config required.**

Point seedforge at your database and it produces INSERT statements with data that actually looks real -- names in name columns, emails in email columns, prices in price columns. It reads your schema, resolves foreign keys, and just works.

## Quick Demo

```
$ seedforge --db postgres://localhost/myapp --count 10

seedforge v0.1.1
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
 first_name | last_name |          email           |     created_at
------------+-----------+--------------------------+---------------------
 Marcus     | Chen      | marcus.chen@example.com  | 2025-09-14 08:23:01
 Fatima     | Okafor    | fatima.okafor@example.com | 2025-11-02 14:45:33
 Lena       | Johansson | lena.johansson@example.com| 2025-12-01 09:12:47
 Diego      | Reyes     | diego.reyes@example.com  | 2026-01-18 16:30:22
 Aisha      | Patel     | aisha.patel@example.com  | 2026-02-25 11:05:59
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

## Quick Start

```bash
# Seed your database with 50 rows per table (default)
seedforge --db postgres://localhost/mydb

# Generate 100 rows per table with a fixed seed for reproducibility
seedforge --db postgres://localhost/mydb --count 100 --seed 42

# Export to a SQL file instead of inserting directly
seedforge --db postgres://localhost/mydb --output seed.sql

# Preview what would happen without touching the database
seedforge --db postgres://localhost/mydb --dry-run

# Use a config file for fine-grained control
seedforge --config .seedforge.yml
```

## Features

- **Schema-aware** -- reads your tables, columns, types, constraints, and enums directly from PostgreSQL
- **190+ column patterns** -- detects column semantics from names (email, phone, price, address, first_name, etc.) across 10 domains and generates matching Faker.js data
- **Foreign key resolution** -- topologically sorts tables and inserts in dependency order; handles circular references and self-referencing tables with deferred updates
- **Deterministic output** -- pass `--seed` to get identical data every time, for reproducible CI/CD
- **Constraint-safe** -- respects NOT NULL, UNIQUE, CHECK constraints, enum types, and generated columns
- **Multiple output modes** -- insert directly into the database, write a `.sql` file, or dry-run to preview
- **Config file support** -- fine-tune per-table row counts, column overrides, value weights, and table exclusions via `.seedforge.yml`
- **Existing data aware** -- augments existing data without unique constraint violations; resets sequences so your app can INSERT normally after seeding
- **Production safety** -- warns before seeding databases that look like production (RDS, Cloud SQL, Neon, Supabase, etc.) and requires `--yes` to override
- **Self-referencing tables** -- generates tree structures with NULL roots, then fills in parent references via deferred UPDATEs
- **Safe emails** -- all generated emails use RFC 2606 reserved domains (@example.com) to avoid accidentally matching real addresses
- **JSON/JSONB support** -- generates valid JSON objects for JSONB columns
- **UUID primary keys** -- generates valid UUIDs for UUID PK columns
- **Composite keys** -- handles composite primary keys and composite foreign keys

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
  --db <url>            PostgreSQL connection string
  --config <path>       path to .seedforge.yml config file
  --count <number>      rows per table (default: 50)
  --seed <number>       PRNG seed for deterministic output
  --dry-run             preview without executing
  --output <file>       SQL file export path
  --schema <name>       database schema to introspect (default: "public")
  --exclude <tables...> tables to skip
  --verbose             verbose logging
  --quiet               suppress non-essential output
  --debug               debug logging
  --json                machine-readable JSON output
  --yes                 skip confirmation prompts
  -V, --version         output the version number
  -h, --help            display help for command

Examples:
  $ seedforge --db postgres://localhost/mydb
  $ seedforge --db postgres://localhost/mydb --count 100 --seed 42
  $ seedforge --db postgres://localhost/mydb --output seed.sql --dry-run
  $ seedforge --config .seedforge.yml
```

## How It Works

1. **Introspect** -- connects to PostgreSQL and reads pg_catalog: tables, columns, types, constraints, foreign keys, enums, generated columns
2. **Resolve dependencies** -- builds a directed graph of FK relationships, detects cycles, and produces a topological insertion order
3. **Map columns** -- analyzes 190+ column name patterns and types to select appropriate Faker.js generators (e.g., `first_name` -> `faker.person.firstName()`)
4. **Generate** -- produces rows table-by-table in dependency order, threading FK references, enforcing uniqueness, respecting CHECK constraints
5. **Output** -- inserts directly into the database (with sequence reset), writes a SQL file, or prints a dry-run summary

## Supported Databases

- **PostgreSQL** -- full support (v12+)
- MySQL, SQLite -- planned for v2

## Supported Column Types

TEXT, VARCHAR, CHAR, INTEGER, BIGINT, SMALLINT, REAL, DOUBLE, DECIMAL, BOOLEAN, DATE, TIME, TIMESTAMP, TIMESTAMPTZ, INTERVAL, UUID, JSON, JSONB, BYTEA, INET, CIDR, MACADDR, ARRAY, ENUM, POINT, and more. Unknown types fall back to safe defaults.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE)
