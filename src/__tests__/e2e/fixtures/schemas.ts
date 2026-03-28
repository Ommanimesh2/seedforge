/**
 * SQL fixtures for e2e tests.
 * Each schema exercises different features of seedforge.
 */

/** Test 1: Basic types — covers all common column types */
export const BASIC_TYPES = `
CREATE TABLE basic_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  age INTEGER,
  salary DECIMAL(10,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

/** Test 2: Enum types — PG native enums */
export const ENUM_TYPES = `
CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE status AS ENUM ('active', 'inactive', 'suspended');

CREATE TABLE enum_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'viewer',
  status status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

/** Test 3: CHECK constraints — enum-like values via CHECK */
export const CHECK_CONSTRAINTS = `
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'discontinued')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0)
);`

/** Test 4: Simple FK — parent/child relationship */
export const SIMPLE_FK = `
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE
);`

/** Test 5: Multi-level FK chain — 3+ tables deep */
export const FK_CHAIN = `
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  code CHAR(2) NOT NULL UNIQUE
);

CREATE TABLE cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  country_id INTEGER NOT NULL REFERENCES countries(id)
);

CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  street VARCHAR(200) NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  zip_code VARCHAR(20)
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  address_id INTEGER NOT NULL REFERENCES addresses(id)
);`

/** Test 6: Self-referencing FK — tree structure */
export const SELF_REF = `
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT
);`

/** Test 7: UUID primary keys + JSON columns */
export const UUID_JSON = `
CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

/** Test 8: Composite PK + multiple FKs */
export const COMPOSITE_PK = `
CREATE TABLE authors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL
);

CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  title VARCHAR(300) NOT NULL,
  author_id INTEGER NOT NULL REFERENCES authors(id)
);

CREATE TABLE book_reviews (
  book_id INTEGER NOT NULL REFERENCES books(id),
  reviewer_name VARCHAR(200) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, reviewer_name)
);`

/** Test 9: Generated columns (STORED + IDENTITY) */
export const GENERATED_COLUMNS = `
CREATE TABLE invoices (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subtotal DECIMAL(10,2) NOT NULL,
  tax_rate DECIMAL(5,4) NOT NULL DEFAULT 0.08,
  tax_amount DECIMAL(10,2) GENERATED ALWAYS AS (subtotal * tax_rate) STORED,
  total DECIMAL(10,2) GENERATED ALWAYS AS (subtotal + subtotal * tax_rate) STORED,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

/** Test 10: Full e-commerce — realistic multi-table schema */
export const ECOMMERCE = `
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(50),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES product_categories(id)
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  category_id INTEGER NOT NULL REFERENCES product_categories(id),
  sku VARCHAR(50) NOT NULL UNIQUE,
  in_stock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status order_status NOT NULL DEFAULT 'pending',
  total DECIMAL(12,2) NOT NULL,
  shipping_address JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id BIGINT NOT NULL REFERENCES orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id UUID NOT NULL REFERENCES products(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`
