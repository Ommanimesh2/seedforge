# seedforge

**Generate realistic seed data from your PostgreSQL schema. Zero config required.**

Point seedforge at your database and it produces INSERT statements with data that actually looks real -- names in name columns, emails in email columns, prices in price columns. It reads your schema, resolves foreign keys, and just works.

## Quick Demo

```
$ seedforge --db postgres://localhost/myapp --count 10

seedforge v0.1.0
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
 Fatima     | Okafor    | fatima.okafor@mail.com   | 2025-11-02 14:45:33
 Lena       | Johansson | lena.johansson@email.com | 2025-12-01 09:12:47
 Diego      | Reyes     | diego.reyes@example.com  | 2026-01-18 16:30:22
 Aisha      | Patel     | aisha.patel@mail.com     | 2026-02-25 11:05:59
```

Not random gibberish. Real-looking data.

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
```

## Features

- **Schema-aware** -- reads your tables, columns, types, constraints, and enums directly from PostgreSQL
- **Smart column mapping** -- detects column semantics from names (email, phone, price, address, etc.) and generates matching data
- **Foreign key resolution** -- topologically sorts tables and inserts in dependency order; handles circular references with deferred updates
- **Deterministic output** -- pass `--seed` to get identical data every time
- **Constraint-safe** -- respects NOT NULL, UNIQUE, CHECK constraints, and enum types
- **Multiple output modes** -- insert directly, write a SQL file, or dry-run to preview
- **Config file support** -- fine-tune per-table row counts, column overrides, and custom generators via `.seedforge.yml`
- **Production safety** -- warns before seeding databases that look like production (requires `--yes` to override)
- **Self-referencing tables** -- handles tables with FKs pointing to themselves (e.g., parent_id)
- **Existing data aware** -- can augment existing data or truncate before seeding

## Configuration

Create a `.seedforge.yml` in your project root for full control:

```yaml
connection:
  url: postgres://localhost/mydb
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

  products:
    columns:
      price:
        generator: faker.commerce.price

exclude:
  - schema_migrations
  - _prisma_migrations
```

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
```

## How It Works

1. **Introspect** -- connects to PostgreSQL and reads the information_schema: tables, columns, types, constraints, foreign keys, enums
2. **Resolve dependencies** -- builds a directed graph of FK relationships, detects cycles, and produces a topological insertion order
3. **Map columns** -- analyzes column names and types to select appropriate Faker.js generators (e.g., `first_name` -> `faker.person.firstName()`)
4. **Generate** -- produces rows table-by-table in dependency order, threading FK references from parent to child tables
5. **Output** -- inserts directly into the database, writes a SQL file, or prints a dry-run summary

## Supported Databases

- **PostgreSQL** -- full support (v12+)
- MySQL, SQLite -- planned for v2

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE)
