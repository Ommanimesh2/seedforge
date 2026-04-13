# seedforge Usage Guide

Complete reference for using seedforge as a CLI tool and programmatic library.

## Table of Contents

- [CLI Usage](#cli-usage)
  - [Database Connections](#database-connections)
  - [Schema Parsers](#schema-parsers)
  - [Output Modes](#output-modes)
  - [Generation Options](#generation-options)
  - [Configuration File](#configuration-file)
- [Programmatic API](#programmatic-api)
  - [Tier 1: seed() One-Liner](#tier-1-seed-one-liner)
  - [Tier 2: createSeeder() Stateful Seeder](#tier-2-createseeder-stateful-seeder)
  - [Tier 3: TableChain Fluent Builder](#tier-3-tablechain-fluent-builder)
  - [Tier 4: withSeed() Test Helper](#tier-4-withseed-test-helper)
- [Configuration Reference](#configuration-reference)
  - [Config File Format](#config-file-format)
  - [Column Overrides](#column-overrides)
  - [Relationship Cardinality](#relationship-cardinality)
  - [Table Exclusion](#table-exclusion)
  - [Environment Variables](#environment-variables)
  - [Virtual Foreign Keys](#virtual-foreign-keys)
- [Recipes](#recipes)
  - [CI/CD Seeding](#cicd-seeding)
  - [Test Suite Integration](#test-suite-integration)
  - [Schema-Only Seeding (No Live DB)](#schema-only-seeding-no-live-db)
  - [Large Dataset Generation](#large-dataset-generation)
  - [Weighted Enum Values](#weighted-enum-values)
  - [Controlling FK Cardinality](#controlling-fk-cardinality)

---

## CLI Usage

### Database Connections

seedforge connects directly to your database and introspects the schema automatically.

**PostgreSQL:**

```bash
seedforge --db postgres://user:pass@localhost:5432/mydb
seedforge --db postgresql://user:pass@localhost/mydb

# With specific schema
seedforge --db postgres://localhost/mydb --schema myschema
```

**MySQL:**

```bash
seedforge --db mysql://root:pass@localhost:3306/mydb
seedforge --db mysql://user:pass@localhost/mydb
```

**SQLite:**

```bash
seedforge --db sqlite:///path/to/database.db
seedforge --db sqlite:///./local.db
```

### Schema Parsers

Generate seed data from ORM schema files without a running database. When combined with `--output`, no live database is needed.

**Prisma:**

```bash
# File output only (no DB needed)
seedforge --prisma ./prisma/schema.prisma --output seed.sql

# Parse schema + insert into a live database
seedforge --prisma ./prisma/schema.prisma --db postgres://localhost/mydb
```

**Drizzle:**

```bash
# Single schema file
seedforge --drizzle ./src/db/schema.ts --output seed.sql

# Directory of schema files
seedforge --drizzle ./src/db/ --output seed.sql
```

**TypeORM:**

```bash
seedforge --typeorm ./src/entities/ --output seed.sql
```

**JPA/Hibernate:**

```bash
seedforge --jpa ./src/main/java/com/example/entities/ --output seed.sql
```

**Custom Plugins:**

```bash
seedforge --plugin ./my-parser-plugin.ts --output seed.sql
```

### Output Modes

**Direct insertion (default):**

Inserts directly into the database. Resets sequences after seeding.

```bash
seedforge --db postgres://localhost/mydb
```

**File export:**

Writes a `.sql` file with all INSERT statements.

```bash
seedforge --db postgres://localhost/mydb --output seed.sql
```

**Dry-run:**

Previews what would happen without executing anything.

```bash
seedforge --db postgres://localhost/mydb --dry-run
```

**Fast mode (PostgreSQL only):**

Uses PostgreSQL's COPY protocol for 10x+ faster insertion on large datasets.

```bash
seedforge --db postgres://localhost/mydb --count 10000 --fast
```

### Generation Options

```bash
# Set rows per table
seedforge --db postgres://localhost/mydb --count 100

# Deterministic output (same seed = same data)
seedforge --db postgres://localhost/mydb --seed 42

# Exclude specific tables (glob patterns OK)
seedforge --db postgres://localhost/mydb --exclude schema_migrations audit_*

# Generate only a subset — FK ancestors are auto-included
seedforge --db postgres://localhost/mydb --only users posts --count 500

# Strict subset — error instead of auto-including FK ancestors
seedforge --db postgres://localhost/mydb --only comments --strict-only

# Describe detected schema (columns, constraints, FKs, insert order) without writing anything
seedforge --db postgres://localhost/mydb --inspect

# Machine-readable inspection report for CI
seedforge --db postgres://localhost/mydb --inspect --json --quiet > schema.json

# Verbose output (show column mappings, generation details)
seedforge --db postgres://localhost/mydb --verbose

# Machine-readable JSON output
seedforge --db postgres://localhost/mydb --json

# Suppress all output except errors
seedforge --db postgres://localhost/mydb --quiet

# Skip production database safety prompts
seedforge --db postgres://rds-host.amazonaws.com/mydb --yes
```

### Configuration File

Use a `.seedforge.yml` file for persistent, team-shared configuration:

```bash
# Auto-detect .seedforge.yml in current directory
seedforge --db postgres://localhost/mydb

# Explicit config file path
seedforge --config ./config/seedforge.yml

# CLI flags override config file values
seedforge --config .seedforge.yml --count 200
```

---

## Programmatic API

Install seedforge as a dependency:

```bash
npm install @otg-dev/seedforge
```

All API functions are exported from the package root:

```typescript
import { seed, createSeeder, withSeed, TableChain } from '@otg-dev/seedforge'
```

### Tier 1: seed() One-Liner

The simplest way to seed a database programmatically. Connects, introspects, generates, inserts, and disconnects in one call.

```typescript
import { seed } from '@otg-dev/seedforge'

// Basic usage
const result = await seed('postgres://localhost/testdb')

// With options
const result = await seed('postgres://localhost/testdb', {
  count: 100,
  seed: 42,
  exclude: ['audit_log', 'schema_migrations'],
})

// MySQL
const result = await seed('mysql://root:pass@localhost/testdb', {
  count: 50,
})

// SQLite
const result = await seed('sqlite:///path/to/test.db', {
  count: 50,
  seed: 42,
})
```

**Config object form** -- pass all options in a single object:

```typescript
const result = await seed({
  db: 'postgres://localhost/testdb',
  count: 100,
  seed: 42,
  exclude: ['audit_log'],
  fast: true, // PostgreSQL COPY mode
})
```

**Parser-based seeding** -- generate SQL from schema files without a live database:

```typescript
// Prisma schema -> SQL file
const result = await seed({
  prisma: './prisma/schema.prisma',
  output: './seed.sql',
  count: 100,
})

// Drizzle schema -> SQL file
const result = await seed({
  drizzle: './src/db/schema.ts',
  output: './seed.sql',
})

// Parser schema -> live database
const result = await seed({
  prisma: './prisma/schema.prisma',
  db: 'postgres://localhost/testdb',
  count: 100,
})
```

**Dry-run** -- generate data without executing:

```typescript
const result = await seed('postgres://localhost/testdb', {
  dryRun: true,
  count: 50,
})
// result.tables contains the generated rows
// Nothing was inserted into the database
```

**Return type:**

```typescript
interface SeedResult {
  tables: Map<string, Row[]>  // Generated rows per table
  rowCount: number            // Total rows across all tables
  duration: number            // Execution time in milliseconds
  summary: InsertionSummary   // Detailed insertion results
}

type Row = Record<string, unknown>
```

**Full options:**

```typescript
interface SeedOptions {
  count?: number              // Rows per table (default: 50)
  seed?: number               // PRNG seed for deterministic output
  exclude?: string[]          // Tables to skip
  schema?: string             // Database schema (default: 'public')
  dryRun?: boolean            // Preview without executing
  output?: string             // Write SQL to file
  fast?: boolean              // PostgreSQL COPY mode
  batchSize?: number          // Rows per INSERT (default: 500)
  quiet?: boolean             // Suppress output (default: true)
  skipProductionCheck?: boolean // Skip safety prompts (default: true)
  prisma?: string             // Prisma schema path
  drizzle?: string            // Drizzle schema path
  jpa?: string                // JPA entity directory
  typeorm?: string            // TypeORM entity directory
}
```

### Tier 2: createSeeder() Stateful Seeder

A persistent connection that supports per-table seeding, transaction isolation, and the fluent builder API. Ideal when you need to seed multiple tables with different counts or need row-level access to generated data.

```typescript
import { createSeeder } from '@otg-dev/seedforge'

const seeder = await createSeeder('postgres://localhost/testdb', {
  seed: 42,
  transaction: true, // wrap everything in a transaction
})

// Seed tables in dependency order (parents first)
const users = await seeder.seed('users', 10)
const posts = await seeder.seed('posts', 50)
const comments = await seeder.seed('comments', 200)

// Access generated data
console.log(users[0]) // { id: 1, first_name: 'Marcus', email: 'marcus@example.com', ... }

// Rollback all changes (only when transaction: true)
await seeder.teardown()

// Or commit and disconnect
// await seeder.disconnect()
```

**Per-table overrides:**

```typescript
const users = await seeder.seed('users', 10, {
  columns: {
    role: {
      values: ['admin', 'user', 'moderator'],
      weights: [0.1, 0.8, 0.1],
    },
  },
})

const orders = await seeder.seed('orders', 50, {
  relationship: {
    user_id: {
      cardinality: { min: 1, max: 5, distribution: 'zipf' },
    },
  },
})
```

**Options:**

```typescript
interface SeederOptions {
  seed?: number           // PRNG seed
  transaction?: boolean   // Enable transaction mode (default: false)
  schema?: string         // Database schema (default: 'public')
  quiet?: boolean         // Suppress output (default: true)
  skipProductionCheck?: boolean // Skip safety prompts (default: true)
  batchSize?: number      // Rows per INSERT (default: 500)
}
```

### Tier 3: TableChain Fluent Builder

Chain multiple table seeds in a single fluent expression. Tables are seeded in chain order, so FK references resolve automatically when you chain parents before children.

```typescript
import { createSeeder } from '@otg-dev/seedforge'

const seeder = await createSeeder('postgres://localhost/testdb', {
  seed: 42,
  transaction: true,
})

const result = await seeder
  .table('users', 10)
  .table('categories', 5)
  .table('products', 20)
  .table('orders', 50)
  .table('order_items', 150)
  .execute()

// result.users = [{ id: 1, first_name: 'Marcus', ... }, ...]
// result.orders = [{ id: 1, user_id: 3, ... }, ...]
// result.order_items = [{ id: 1, order_id: 7, product_id: 12, ... }, ...]

await seeder.teardown()
```

**With per-table overrides:**

```typescript
const result = await seeder
  .table('users', 10, {
    columns: {
      role: { values: ['admin', 'user'] },
    },
  })
  .table('posts', 50)
  .execute()
```

### Tier 4: withSeed() Test Helper

Designed for test suites. Returns `seed` and `teardown` functions with lazy connection establishment and automatic transaction cleanup.

```typescript
import { withSeed } from '@otg-dev/seedforge'
import { describe, it, afterAll, expect } from 'vitest'

describe('user API', () => {
  const { seed, teardown } = withSeed('postgres://localhost/testdb', {
    seed: 42,
    transaction: true,
  })

  afterAll(teardown)

  it('lists users', async () => {
    const users = await seed('users', 10)
    const res = await fetch('/api/users')
    const body = await res.json()
    expect(body).toHaveLength(10)
  })

  it('creates orders for users', async () => {
    const users = await seed('users', 5)
    const orders = await seed('orders', 20)
    // orders have valid user_id references to the 5 users
    expect(orders.every(o => o.user_id != null)).toBe(true)
  })
})
```

**Options:**

```typescript
interface WithSeedOptions {
  seed?: number           // PRNG seed
  transaction?: boolean   // Auto-cleanup via rollback (default: true)
  schema?: string         // Database schema (default: 'public')
  quiet?: boolean         // Suppress output (default: true)
}
```

---

## Configuration Reference

### Config File Format

seedforge looks for `.seedforge.yml` in the current directory by default. Use `--config` to specify a different path.

```yaml
# Connection settings
connection:
  url: ${DATABASE_URL}        # Database connection string (supports env vars)
  schema: public              # Schema to introspect (default: public)

# Global generation settings
count: 100                    # Default rows per table (default: 50)
seed: 42                      # PRNG seed for deterministic output
locale: en                    # Faker.js locale (default: en)

# Existing data behavior
existingData: augment         # augment | truncate | error (default: augment)

# Per-table configuration
tables:
  users:
    count: 200                # Override row count for this table
    columns:
      email:
        generator: faker.internet.email
        unique: true
      role:
        values: [admin, user, moderator]
        weights: [0.05, 0.9, 0.05]
      bio:
        nullable: 0.3         # 30% chance of NULL
    relationships:
      orders:
        cardinality: "1..5"
        distribution: zipf

  products:
    columns:
      price:
        generator: faker.commerce.price
      category:
        values: [Electronics, Books, Clothing, Home, Sports]

# Tables to skip
exclude:
  - schema_migrations
  - _prisma_migrations
  - pg_*                       # Glob patterns supported

# Virtual foreign keys (for tables without formal FK constraints)
virtualForeignKeys:
  - from: { table: orders, column: customer_id }
    to: { table: users, column: id }
```

### Column Overrides

Control how individual columns are generated:

```yaml
tables:
  users:
    columns:
      # Use a specific Faker.js generator
      email:
        generator: faker.internet.email
        unique: true

      # Fixed values with optional weights
      status:
        values: [active, inactive, suspended]
        weights: [0.8, 0.15, 0.05]

      # Control NULL probability (0 = never null, 1 = always null)
      bio:
        nullable: 0.3

      # Fixed values cycle through rows
      department:
        values: [Engineering, Marketing, Sales, Support]
```

### Relationship Cardinality

Control how many child rows are generated per parent row:

```yaml
tables:
  orders:
    relationships:
      # Range notation: each user gets 1-5 orders
      user_id:
        cardinality: "1..5"
        distribution: uniform   # uniform | zipf | normal

      # Zipf distribution: most users get few orders, some get many
      user_id:
        cardinality: "1..10"
        distribution: zipf

      # Normal distribution: most users get ~3 orders
      user_id:
        cardinality: "1..5"
        distribution: normal

      # Fixed list with weights
      user_id:
        cardinality: [1, 2, 3, 5, 10]
        weights: [0.3, 0.3, 0.2, 0.1, 0.1]
```

**Distribution types:**

| Distribution | Description | Use Case |
|-------------|-------------|----------|
| `uniform` | Equal probability across range | Even data distribution |
| `zipf` | Power-law: few items get most of the weight | Realistic user activity (80/20 rule) |
| `normal` | Bell curve centered on midpoint | Natural variation |

### Table Exclusion

Exclude tables from seeding using exact names or glob patterns:

```yaml
exclude:
  - schema_migrations
  - _prisma_migrations
  - pg_*                  # All tables starting with pg_
  - _*                    # All tables starting with underscore
  - "*_backup"            # All tables ending with _backup
```

Or via CLI:

```bash
seedforge --db postgres://localhost/mydb --exclude schema_migrations audit_log
```

### Environment Variables

Config files support `${VAR}` syntax for environment variable interpolation:

```yaml
connection:
  url: ${DATABASE_URL}

tables:
  users:
    count: ${USER_COUNT}
```

### Virtual Foreign Keys

For tables that use foreign key patterns without formal FK constraints (common in some ORMs and legacy systems):

```yaml
virtualForeignKeys:
  - from: { table: orders, column: customer_id }
    to: { table: users, column: id }

  - from: { table: comments, column: post_id }
    to: { table: posts, column: id }
```

This tells seedforge to treat these columns as foreign keys for dependency ordering and reference pool population.

---

## Recipes

### CI/CD Seeding

Seed a test database in CI with deterministic data:

```bash
# In your CI pipeline
seedforge --db $DATABASE_URL --count 50 --seed 42 --quiet --yes
```

Or generate a SQL file once and apply it:

```bash
seedforge --db postgres://localhost/mydb --output seed.sql --seed 42
psql $DATABASE_URL < seed.sql
```

### Test Suite Integration

Use `withSeed()` for automatic cleanup in test suites:

```typescript
import { withSeed } from '@otg-dev/seedforge'
import { describe, it, afterAll } from 'vitest'

describe('order service', () => {
  const { seed, teardown } = withSeed(process.env.TEST_DATABASE_URL!, {
    seed: 42,
    transaction: true,
  })

  afterAll(teardown)

  it('calculates order totals', async () => {
    await seed('users', 5)
    await seed('products', 10)
    const orders = await seed('orders', 20)
    const items = await seed('order_items', 50)

    // Test your order total calculation logic
    for (const order of orders) {
      const total = await orderService.calculateTotal(order.id)
      expect(total).toBeGreaterThan(0)
    }
  })
})
```

### Schema-Only Seeding (No Live DB)

Generate SQL from ORM schemas without a running database:

```typescript
import { seed } from '@otg-dev/seedforge'

// Prisma -> SQL file
await seed({
  prisma: './prisma/schema.prisma',
  output: './test-data/seed.sql',
  count: 100,
  seed: 42,
})

// Drizzle -> SQL file
await seed({
  drizzle: './src/db/schema.ts',
  output: './test-data/seed.sql',
  count: 100,
})
```

### Large Dataset Generation

For generating thousands or millions of rows:

```bash
# PostgreSQL COPY mode: 10x+ faster than regular inserts
seedforge --db postgres://localhost/mydb --count 100000 --fast --seed 42

# Export to file for even larger datasets (no memory constraints from DB connection)
seedforge --db postgres://localhost/mydb --count 1000000 --output bulk-seed.sql --seed 42
```

Programmatically:

```typescript
const result = await seed('postgres://localhost/testdb', {
  count: 100000,
  fast: true,
  seed: 42,
  batchSize: 1000, // Larger batches for better throughput
})
```

### Weighted Enum Values

Generate realistic distributions of enum-like columns:

```yaml
# .seedforge.yml
tables:
  users:
    columns:
      role:
        values: [user, admin, moderator]
        weights: [0.9, 0.05, 0.05]   # 90% users, 5% admins, 5% mods

      subscription:
        values: [free, basic, premium, enterprise]
        weights: [0.6, 0.25, 0.1, 0.05]

      country:
        values: [US, GB, DE, FR, JP, BR, IN, AU]
        weights: [0.35, 0.15, 0.1, 0.1, 0.08, 0.08, 0.07, 0.07]
```

Or via the programmatic API:

```typescript
const users = await seeder.seed('users', 1000, {
  columns: {
    role: {
      values: ['user', 'admin', 'moderator'],
      weights: [0.9, 0.05, 0.05],
    },
  },
})
```

### Controlling FK Cardinality

Create realistic one-to-many distributions:

```yaml
# .seedforge.yml
tables:
  orders:
    relationships:
      user_id:
        cardinality: "1..10"
        distribution: zipf    # Most users have few orders, some power users have many

  order_items:
    relationships:
      order_id:
        cardinality: "1..5"
        distribution: normal  # Most orders have 2-3 items

  comments:
    relationships:
      post_id:
        cardinality: "0..20"
        distribution: zipf    # Viral posts get many comments, most get few
```

Programmatically:

```typescript
const orders = await seeder.seed('orders', 500, {
  relationship: {
    user_id: {
      cardinality: { min: 1, max: 10, distribution: 'zipf' },
    },
  },
})
```
