import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { introspect } from '../../introspect/index.js'
import { introspectMysql } from '../../introspect/mysql/introspect.js'
import { buildInsertPlan } from '../../graph/index.js'
import { executeFastPgPipeline } from '../../output/executors/pg-copy-streaming.js'
import { executeFastMysqlPipeline } from '../../output/executors/mysql-load-data.js'
import { ProgressReporter } from '../../output/progress.js'

const SEED = 7

// ─── PostgreSQL fast streaming ────────────────────────────────────────

describe('PG --fast streaming (executeFastPgPipeline)', () => {
  let container: StartedPostgreSqlContainer
  let client: pg.Client

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    client = new pg.Client({ connectionString: container.getConnectionUri() })
    await client.connect()

    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        body TEXT,
        score INTEGER
      );
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        parent_id INTEGER REFERENCES categories(id)
      );
    `)
  }, 120_000)

  afterAll(async () => {
    await client?.end()
    await container?.stop()
  })

  it('streams rows directly into PG via COPY with FK propagation', async () => {
    const schema = await introspect(client, 'public')
    const plan = buildInsertPlan(schema)
    const progress = new ProgressReporter({ quiet: true, showProgress: false })

    const summary = await executeFastPgPipeline(
      schema,
      plan,
      client,
      { globalRowCount: 500, seed: SEED },
      progress,
    )

    expect(summary.totalRowsInserted).toBeGreaterThanOrEqual(500 * 3)
    expect(summary.rowsPerTable.get('public.users')).toBe(500)
    expect(summary.rowsPerTable.get('public.posts')).toBe(500)
    expect(summary.rowsPerTable.get('public.categories')).toBe(500)

    // Row counts are real in the database
    const { rows: userCount } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*)::int AS cnt FROM users',
    )
    expect(Number(userCount[0].cnt)).toBe(500)

    // FK integrity: every post.user_id points at a real user
    const { rows: orphanPosts } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*)::int AS cnt FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL',
    )
    expect(Number(orphanPosts[0].cnt)).toBe(0)

    // Self-ref deferred updates: some category rows get a non-null parent_id
    // after the deferred update pass, and all such parents must exist.
    const { rows: orphanCats } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*)::int AS cnt FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.parent_id IS NOT NULL AND p.id IS NULL',
    )
    expect(Number(orphanCats[0].cnt)).toBe(0)

    // At least some deferred updates should have run (non-null parent_id rows)
    const { rows: linked } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*)::int AS cnt FROM categories WHERE parent_id IS NOT NULL',
    )
    expect(Number(linked[0].cnt)).toBeGreaterThan(0)

    // Sequences reset: inserting a new row should pick a fresh id, not collide
    const { rows: inserted } = await client.query<{ id: number }>(
      "INSERT INTO users(email, name) VALUES ('post-seed@example.com', 'after') RETURNING id",
    )
    expect(inserted[0].id).toBeGreaterThan(500)
  }, 120_000)

  it('scales to 10k rows with flat memory usage (no materialization)', async () => {
    // Drop and re-create to reset row counts
    await client.query('TRUNCATE posts, users, categories RESTART IDENTITY CASCADE')

    const schema = await introspect(client, 'public')
    const plan = buildInsertPlan(schema)
    const progress = new ProgressReporter({ quiet: true, showProgress: false })

    const rssBefore = process.memoryUsage().rss
    const summary = await executeFastPgPipeline(
      schema,
      plan,
      client,
      { globalRowCount: 10_000, seed: SEED },
      progress,
    )
    const rssAfter = process.memoryUsage().rss

    expect(summary.rowsPerTable.get('public.users')).toBe(10_000)
    expect(summary.rowsPerTable.get('public.posts')).toBe(10_000)

    // Flat memory claim: <150MB growth for 30k rows across 3 tables. A
    // materializing generator for the same workload grew by several hundred
    // MB in earlier measurements, so this is a generous ceiling that still
    // catches regressions toward array-backed generation.
    const growthMb = (rssAfter - rssBefore) / 1024 / 1024
    expect(growthMb).toBeLessThan(150)

    const { rows } = await client.query<{ cnt: string }>('SELECT COUNT(*)::int AS cnt FROM posts')
    expect(Number(rows[0].cnt)).toBe(10_000)
  }, 180_000)
})

// ─── MySQL fast streaming ─────────────────────────────────────────────

describe('MySQL --fast streaming (executeFastMysqlPipeline)', () => {
  let container: StartedMySqlContainer
  let connection: mysql.Connection
  let dbName: string

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8.0')
      // Enable LOAD DATA LOCAL INFILE on the server
      .withCommand(['mysqld', '--local-infile=1'])
      .start()
    dbName = container.getDatabase()
    connection = await mysql.createConnection({
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getUserPassword(),
      database: dbName,
    })

    await connection.query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        metadata JSON
      ) ENGINE=InnoDB;
    `)
    await connection.query(`
      CREATE TABLE posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        score INT,
        CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB;
    `)
    await connection.query(`
      CREATE TABLE categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        parent_id INT NULL,
        CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
      ) ENGINE=InnoDB;
    `)
  }, 180_000)

  afterAll(async () => {
    await connection?.end()
    await container?.stop()
  })

  it('streams rows directly into MySQL via LOAD DATA LOCAL INFILE', async () => {
    const schema = await introspectMysql(connection, dbName)
    const plan = buildInsertPlan(schema)
    const progress = new ProgressReporter({ quiet: true, showProgress: false })

    const summary = await executeFastMysqlPipeline(
      schema,
      plan,
      connection,
      { globalRowCount: 500, seed: SEED },
      progress,
    )

    expect(summary.rowsPerTable.get(`${dbName}.users`)).toBe(500)
    expect(summary.rowsPerTable.get(`${dbName}.posts`)).toBe(500)
    expect(summary.rowsPerTable.get(`${dbName}.categories`)).toBe(500)

    const [[userCount]] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM users',
    )
    expect(Number(userCount.cnt)).toBe(500)

    // FK integrity: no orphan posts
    const [[orphanPosts]] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL',
    )
    expect(Number(orphanPosts.cnt)).toBe(0)

    // Self-ref deferred updates: all non-null parent_ids point at real categories
    const [[orphanCats]] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.parent_id IS NOT NULL AND p.id IS NULL',
    )
    expect(Number(orphanCats.cnt)).toBe(0)

    // AUTO_INCREMENT reset: new row picks a fresh id beyond the loaded range
    const [insertResult] = await connection.query<mysql.ResultSetHeader>(
      "INSERT INTO users(email, name) VALUES ('post-seed@example.com', 'after')",
    )
    expect(insertResult.insertId).toBeGreaterThan(500)
  }, 180_000)
})
