/**
 * Schema fixtures used by the benchmark suite. Each fixture exposes
 * a PG and MySQL flavor of the same shape so the --fast PG COPY and
 * --fast MySQL LOAD DATA paths can be measured against comparable work.
 */

export interface BenchSchemaFixture {
  name: string
  description: string
  pgSql: string
  mysqlSql: string
  /**
   * Root table name used to verify row counts after each run.
   * For multi-table fixtures we check every inserted table.
   */
  tables: string[]
}

/**
 * 1 narrow table — baseline for raw throughput.
 */
const narrow: BenchSchemaFixture = {
  name: 'narrow',
  description: '1 table × 5 columns — raw throughput baseline',
  tables: ['events'],
  pgSql: `
    CREATE TABLE events (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      payload TEXT,
      amount NUMERIC(10,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `,
  mysqlSql: `
    CREATE TABLE events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      payload TEXT,
      amount DECIMAL(10,2),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `,
}

/**
 * 1 wide table — stresses serialization / format cost per row.
 */
const wide: BenchSchemaFixture = {
  name: 'wide',
  description: '1 table × 24 columns — per-row serialization cost',
  tables: ['customers'],
  pgSql: `
    CREATE TABLE customers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      first_name VARCHAR(80) NOT NULL,
      last_name VARCHAR(80) NOT NULL,
      phone VARCHAR(40),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      city VARCHAR(120),
      state VARCHAR(80),
      postal_code VARCHAR(20),
      country VARCHAR(80),
      company VARCHAR(120),
      job_title VARCHAR(120),
      department VARCHAR(80),
      tier VARCHAR(20),
      lifetime_value NUMERIC(12,2),
      credit_score INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT true,
      marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
      birth_date DATE,
      last_login TIMESTAMPTZ,
      notes TEXT,
      tags TEXT,
      metadata TEXT
    );
  `,
  mysqlSql: `
    CREATE TABLE customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      first_name VARCHAR(80) NOT NULL,
      last_name VARCHAR(80) NOT NULL,
      phone VARCHAR(40),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      city VARCHAR(120),
      state VARCHAR(80),
      postal_code VARCHAR(20),
      country VARCHAR(80),
      company VARCHAR(120),
      job_title VARCHAR(120),
      department VARCHAR(80),
      tier VARCHAR(20),
      lifetime_value DECIMAL(12,2),
      credit_score INT,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0,
      birth_date DATE,
      last_login TIMESTAMP NULL,
      notes TEXT,
      tags TEXT,
      metadata TEXT
    ) ENGINE=InnoDB;
  `,
}

/**
 * 4-table schema with FKs and a self-ref — exercises the streaming orchestrator
 * path that retains rows only for tables with deferred updates.
 */
const complex: BenchSchemaFixture = {
  name: 'complex',
  description: '4 tables with FK chain and self-ref — orchestrator overhead',
  tables: ['users', 'categories', 'products', 'orders'],
  pgSql: `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      parent_id INTEGER REFERENCES categories(id)
    );
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name VARCHAR(200) NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      total NUMERIC(12,2) NOT NULL,
      placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `,
  mysqlSql: `
    CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
    CREATE TABLE categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      parent_id INT NULL,
      CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
    ) ENGINE=InnoDB;
    CREATE TABLE products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES categories(id)
    ) ENGINE=InnoDB;
    CREATE TABLE orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      total DECIMAL(12,2) NOT NULL,
      placed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_ord_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_ord_prod FOREIGN KEY (product_id) REFERENCES products(id)
    ) ENGINE=InnoDB;
  `,
}

export const FIXTURES: BenchSchemaFixture[] = [narrow, wide, complex]
