import { describe, it, expect } from 'vitest'
import { parseDrizzleSchema } from '../parser.js'
import { NormalizedType, FKAction } from '../../../types/index.js'

describe('Drizzle schema parser', () => {
  describe('table parsing', () => {
    it('parses a simple table with various column types', () => {
      const source = `
        import { pgTable, serial, text, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
          email: varchar('email', { length: 255 }).notNull().unique(),
          age: integer('age'),
          active: boolean('active').default(true),
          createdAt: timestamp('created_at').defaultNow().notNull(),
        });
      `

      const schema = parseDrizzleSchema(source)

      expect(schema.tables.size).toBe(1)
      const users = schema.tables.get('users')!
      expect(users).toBeDefined()
      expect(users.name).toBe('users')
      expect(users.schema).toBe('public')
      expect(users.columns.size).toBe(6)

      // id column
      const id = users.columns.get('id')!
      expect(id.dataType).toBe(NormalizedType.INTEGER)
      expect(id.isAutoIncrement).toBe(true)
      expect(id.isNullable).toBe(false)
      expect(id.hasDefault).toBe(true)

      // name column
      const name = users.columns.get('name')!
      expect(name.dataType).toBe(NormalizedType.TEXT)
      expect(name.isNullable).toBe(false)
      expect(name.isAutoIncrement).toBe(false)

      // email column
      const email = users.columns.get('email')!
      expect(email.dataType).toBe(NormalizedType.VARCHAR)
      expect(email.maxLength).toBe(255)
      expect(email.isNullable).toBe(false)

      // age column
      const age = users.columns.get('age')!
      expect(age.dataType).toBe(NormalizedType.INTEGER)
      expect(age.isNullable).toBe(true)

      // active column
      const active = users.columns.get('active')!
      expect(active.dataType).toBe(NormalizedType.BOOLEAN)
      expect(active.hasDefault).toBe(true)

      // createdAt column
      const createdAt = users.columns.get('created_at')!
      expect(createdAt.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(createdAt.hasDefault).toBe(true)
      expect(createdAt.isNullable).toBe(false)
    })

    it('parses primary key', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const users = schema.tables.get('users')!
      expect(users.primaryKey).toEqual({ columns: ['id'], name: null })
    })

    it('parses unique constraints', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          email: text('email').unique(),
          username: varchar('username', { length: 100 }).unique(),
        });
      `

      const schema = parseDrizzleSchema(source)
      const users = schema.tables.get('users')!
      expect(users.uniqueConstraints).toHaveLength(2)
      expect(users.uniqueConstraints[0].columns).toEqual(['email'])
      expect(users.uniqueConstraints[1].columns).toEqual(['username'])
    })
  })

  describe('column type mapping', () => {
    it('maps serial types with auto-increment', () => {
      const source = `
        export const t = pgTable('t', {
          a: serial('a').primaryKey(),
          b: bigserial('b'),
          c: smallserial('c'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      const a = t.columns.get('a')!
      expect(a.dataType).toBe(NormalizedType.INTEGER)
      expect(a.isAutoIncrement).toBe(true)

      const b = t.columns.get('b')!
      expect(b.dataType).toBe(NormalizedType.BIGINT)
      expect(b.isAutoIncrement).toBe(true)

      const c = t.columns.get('c')!
      expect(c.dataType).toBe(NormalizedType.SMALLINT)
      expect(c.isAutoIncrement).toBe(true)
    })

    it('maps integer types', () => {
      const source = `
        export const t = pgTable('t', {
          a: integer('a'),
          b: bigint('b'),
          c: smallint('c'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.dataType).toBe(NormalizedType.INTEGER)
      expect(t.columns.get('b')!.dataType).toBe(NormalizedType.BIGINT)
      expect(t.columns.get('c')!.dataType).toBe(NormalizedType.SMALLINT)
    })

    it('maps string types', () => {
      const source = `
        export const t = pgTable('t', {
          a: text('a'),
          b: varchar('b', { length: 100 }),
          c: char('c'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.dataType).toBe(NormalizedType.TEXT)
      expect(t.columns.get('b')!.dataType).toBe(NormalizedType.VARCHAR)
      expect(t.columns.get('b')!.maxLength).toBe(100)
      expect(t.columns.get('c')!.dataType).toBe(NormalizedType.CHAR)
    })

    it('maps float/decimal types', () => {
      const source = `
        export const t = pgTable('t', {
          a: real('a'),
          b: doublePrecision('b'),
          c: numeric('c'),
          d: decimal('d'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.dataType).toBe(NormalizedType.REAL)
      expect(t.columns.get('b')!.dataType).toBe(NormalizedType.DOUBLE)
      expect(t.columns.get('c')!.dataType).toBe(NormalizedType.DECIMAL)
      expect(t.columns.get('d')!.dataType).toBe(NormalizedType.DECIMAL)
    })

    it('maps date/time types', () => {
      const source = `
        export const t = pgTable('t', {
          a: timestamp('a'),
          b: date('b'),
          c: time('c'),
          d: interval('d'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(t.columns.get('b')!.dataType).toBe(NormalizedType.DATE)
      expect(t.columns.get('c')!.dataType).toBe(NormalizedType.TIME)
      expect(t.columns.get('d')!.dataType).toBe(NormalizedType.INTERVAL)
    })

    it('maps JSON types', () => {
      const source = `
        export const t = pgTable('t', {
          a: json('a'),
          b: jsonb('b'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.dataType).toBe(NormalizedType.JSON)
      expect(t.columns.get('b')!.dataType).toBe(NormalizedType.JSONB)
    })

    it('maps uuid type', () => {
      const source = `
        export const t = pgTable('t', {
          id: uuid('id').primaryKey(),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('id')!.dataType).toBe(NormalizedType.UUID)
    })

    it('maps boolean type', () => {
      const source = `
        export const t = pgTable('t', {
          active: boolean('active').default(false),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('active')!.dataType).toBe(NormalizedType.BOOLEAN)
      expect(t.columns.get('active')!.hasDefault).toBe(true)
    })
  })

  describe('enum parsing', () => {
    it('parses pgEnum definitions', () => {
      const source = `
        import { pgEnum } from 'drizzle-orm/pg-core';

        export const userRoleEnum = pgEnum('user_role', ['admin', 'user', 'editor']);
      `

      const schema = parseDrizzleSchema(source)

      expect(schema.enums.size).toBe(1)
      const enumDef = schema.enums.get('user_role')!
      expect(enumDef).toBeDefined()
      expect(enumDef.name).toBe('user_role')
      expect(enumDef.values).toEqual(['admin', 'user', 'editor'])
    })

    it('parses multiple enums', () => {
      const source = `
        export const statusEnum = pgEnum('status', ['active', 'inactive', 'pending']);
        export const roleEnum = pgEnum('role', ['admin', 'user']);
      `

      const schema = parseDrizzleSchema(source)

      expect(schema.enums.size).toBe(2)
      expect(schema.enums.get('status')!.values).toEqual(['active', 'inactive', 'pending'])
      expect(schema.enums.get('role')!.values).toEqual(['admin', 'user'])
    })

    it('maps enum column type to ENUM with values', () => {
      const source = `
        export const userRoleEnum = pgEnum('user_role', ['admin', 'user', 'editor']);

        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          role: userRoleEnum('role').default('user'),
        });
      `

      const schema = parseDrizzleSchema(source)
      const users = schema.tables.get('users')!
      const role = users.columns.get('role')!

      expect(role.dataType).toBe(NormalizedType.ENUM)
      expect(role.enumValues).toEqual(['admin', 'user', 'editor'])
      expect(role.nativeType).toBe('user_role')
      expect(role.hasDefault).toBe(true)
    })
  })

  describe('foreign key parsing from .references()', () => {
    it('parses simple FK reference', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          authorId: integer('author_id').references(() => users.id),
        });
      `

      const schema = parseDrizzleSchema(source)
      const posts = schema.tables.get('posts')!

      expect(posts.foreignKeys).toHaveLength(1)
      const fk = posts.foreignKeys[0]
      expect(fk.columns).toEqual(['author_id'])
      expect(fk.referencedTable).toBe('users')
      expect(fk.referencedColumns).toEqual(['id'])
      expect(fk.onDelete).toBe(FKAction.NO_ACTION)
      expect(fk.onUpdate).toBe(FKAction.NO_ACTION)
    })

    it('parses FK with onDelete cascade', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          authorId: integer('author_id').references(() => users.id, { onDelete: 'cascade' }),
        });
      `

      const schema = parseDrizzleSchema(source)
      const posts = schema.tables.get('posts')!

      expect(posts.foreignKeys).toHaveLength(1)
      const fk = posts.foreignKeys[0]
      expect(fk.onDelete).toBe(FKAction.CASCADE)
    })

    it('parses FK with onDelete and onUpdate', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          authorId: integer('author_id').references(() => users.id, { onDelete: 'cascade', onUpdate: 'restrict' }),
        });
      `

      const schema = parseDrizzleSchema(source)
      const posts = schema.tables.get('posts')!

      const fk = posts.foreignKeys[0]
      expect(fk.onDelete).toBe(FKAction.CASCADE)
      expect(fk.onUpdate).toBe(FKAction.RESTRICT)
    })

    it('parses multiple FK references on one table', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });

        export const categories = pgTable('categories', {
          id: serial('id').primaryKey(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          authorId: integer('author_id').references(() => users.id),
          categoryId: integer('category_id').references(() => categories.id),
        });
      `

      const schema = parseDrizzleSchema(source)
      const posts = schema.tables.get('posts')!

      expect(posts.foreignKeys).toHaveLength(2)
      expect(posts.foreignKeys[0].referencedTable).toBe('users')
      expect(posts.foreignKeys[1].referencedTable).toBe('categories')
    })

    it('generates FK constraint name', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          authorId: integer('author_id').references(() => users.id),
        });
      `

      const schema = parseDrizzleSchema(source)
      const posts = schema.tables.get('posts')!
      expect(posts.foreignKeys[0].name).toBe('posts_author_id_fkey')
    })
  })

  describe('multi-dialect support', () => {
    it('detects MySQL dialect from mysqlTable', () => {
      const source = `
        import { mysqlTable, serial, varchar, int } from 'drizzle-orm/mysql-core';

        export const users = mysqlTable('users', {
          id: serial('id').primaryKey(),
          name: varchar('name', { length: 255 }),
          age: int('age'),
        });
      `

      const schema = parseDrizzleSchema(source)
      expect(schema.tables.size).toBe(1)

      const users = schema.tables.get('users')!
      expect(users.columns.size).toBe(3)
    })

    it('detects SQLite dialect from sqliteTable', () => {
      const source = `
        import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

        export const users = sqliteTable('users', {
          id: integer('id').primaryKey(),
          name: text('name'),
        });
      `

      const schema = parseDrizzleSchema(source)
      expect(schema.tables.size).toBe(1)

      const users = schema.tables.get('users')!
      const id = users.columns.get('id')!
      expect(id.dataType).toBe(NormalizedType.INTEGER)
    })
  })

  describe('realistic multi-table schema', () => {
    it('parses a complete blog schema', () => {
      const source = `
        import { pgTable, serial, text, varchar, integer, boolean, timestamp, pgEnum, uuid } from 'drizzle-orm/pg-core';
        import { relations } from 'drizzle-orm';

        export const roleEnum = pgEnum('role', ['admin', 'user', 'moderator']);

        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
          email: varchar('email', { length: 255 }).notNull().unique(),
          role: roleEnum('role').default('user'),
          bio: text('bio'),
          createdAt: timestamp('created_at').defaultNow().notNull(),
        });

        export const categories = pgTable('categories', {
          id: serial('id').primaryKey(),
          name: varchar('name', { length: 100 }).notNull(),
          slug: varchar('slug', { length: 100 }).notNull().unique(),
        });

        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          title: varchar('title', { length: 500 }).notNull(),
          body: text('body').notNull(),
          published: boolean('published').default(false),
          authorId: integer('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
          categoryId: integer('category_id').references(() => categories.id),
          createdAt: timestamp('created_at').defaultNow().notNull(),
          updatedAt: timestamp('updated_at'),
        });

        export const comments = pgTable('comments', {
          id: serial('id').primaryKey(),
          body: text('body').notNull(),
          postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
          userId: integer('user_id').notNull().references(() => users.id),
          createdAt: timestamp('created_at').defaultNow().notNull(),
        });

        export const tags = pgTable('tags', {
          id: serial('id').primaryKey(),
          name: varchar('name', { length: 50 }).notNull().unique(),
        });

        export const postTags = pgTable('post_tags', {
          postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
          tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
        });

        // Relations (metadata only, not parsed for FKs)
        export const usersRelations = relations(users, ({ many }) => ({
          posts: many(posts),
          comments: many(comments),
        }));
      `

      const schema = parseDrizzleSchema(source)

      // Tables
      expect(schema.tables.size).toBe(6)
      expect(schema.tables.has('users')).toBe(true)
      expect(schema.tables.has('categories')).toBe(true)
      expect(schema.tables.has('posts')).toBe(true)
      expect(schema.tables.has('comments')).toBe(true)
      expect(schema.tables.has('tags')).toBe(true)
      expect(schema.tables.has('post_tags')).toBe(true)

      // Enums
      expect(schema.enums.size).toBe(1)
      expect(schema.enums.get('role')!.values).toEqual(['admin', 'user', 'moderator'])

      // Users table
      const users = schema.tables.get('users')!
      expect(users.columns.size).toBe(6)
      expect(users.primaryKey).toEqual({ columns: ['id'], name: null })
      expect(users.uniqueConstraints).toHaveLength(1)
      expect(users.uniqueConstraints[0].columns).toEqual(['email'])
      const roleCol = users.columns.get('role')!
      expect(roleCol.dataType).toBe(NormalizedType.ENUM)
      expect(roleCol.enumValues).toEqual(['admin', 'user', 'moderator'])

      // Posts table
      const posts = schema.tables.get('posts')!
      expect(posts.columns.size).toBe(8)
      expect(posts.foreignKeys).toHaveLength(2)
      const authorFk = posts.foreignKeys.find(fk => fk.columns[0] === 'author_id')!
      expect(authorFk.referencedTable).toBe('users')
      expect(authorFk.onDelete).toBe(FKAction.CASCADE)
      const categoryFk = posts.foreignKeys.find(fk => fk.columns[0] === 'category_id')!
      expect(categoryFk.referencedTable).toBe('categories')

      // Comments table
      const comments = schema.tables.get('comments')!
      expect(comments.foreignKeys).toHaveLength(2)

      // Post tags (junction table)
      const postTags = schema.tables.get('post_tags')!
      expect(postTags.foreignKeys).toHaveLength(2)
      expect(postTags.foreignKeys[0].onDelete).toBe(FKAction.CASCADE)
      expect(postTags.foreignKeys[1].onDelete).toBe(FKAction.CASCADE)
    })
  })

  describe('default values', () => {
    it('parses .default() with various value types', () => {
      const source = `
        export const t = pgTable('t', {
          a: boolean('a').default(true),
          b: integer('b').default(0),
          c: text('c').default('hello'),
          d: timestamp('d').defaultNow(),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!

      expect(t.columns.get('a')!.hasDefault).toBe(true)
      expect(t.columns.get('b')!.hasDefault).toBe(true)
      expect(t.columns.get('c')!.hasDefault).toBe(true)
      expect(t.columns.get('d')!.hasDefault).toBe(true)
      expect(t.columns.get('d')!.defaultValue).toBe('now()')
    })
  })

  describe('schema name', () => {
    it('uses custom schema name', () => {
      const source = `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });
      `

      const schema = parseDrizzleSchema(source, 'custom_schema')
      expect(schema.name).toBe('custom_schema')
      expect(schema.schemas).toEqual(['custom_schema'])
      expect(schema.tables.get('users')!.schema).toBe('custom_schema')
    })
  })

  describe('numeric precision and scale', () => {
    it('extracts precision and scale from options', () => {
      const source = `
        export const t = pgTable('t', {
          price: numeric('price', { precision: 10, scale: 2 }),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!
      const price = t.columns.get('price')!

      expect(price.dataType).toBe(NormalizedType.DECIMAL)
      expect(price.numericPrecision).toBe(10)
      expect(price.numericScale).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('handles empty source', () => {
      const schema = parseDrizzleSchema('')
      expect(schema.tables.size).toBe(0)
      expect(schema.enums.size).toBe(0)
    })

    it('handles source with no exports', () => {
      const source = `
        const x = 5;
        function foo() { return x; }
      `
      const schema = parseDrizzleSchema(source)
      expect(schema.tables.size).toBe(0)
    })

    it('handles .$defaultFn() modifier', () => {
      const source = `
        export const t = pgTable('t', {
          id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
        });
      `

      const schema = parseDrizzleSchema(source)
      const t = schema.tables.get('t')!
      const id = t.columns.get('id')!
      expect(id.hasDefault).toBe(true)
      expect(id.dataType).toBe(NormalizedType.UUID)
    })

    it('self-referencing FK works', () => {
      const source = `
        export const categories = pgTable('categories', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
          parentId: integer('parent_id').references(() => categories.id),
        });
      `

      const schema = parseDrizzleSchema(source)
      const categories = schema.tables.get('categories')!
      expect(categories.foreignKeys).toHaveLength(1)
      expect(categories.foreignKeys[0].referencedTable).toBe('categories')
      expect(categories.foreignKeys[0].columns).toEqual(['parent_id'])
    })
  })
})
