import { describe, it, expect } from 'vitest'
import { parseTypeORMSource, parseTypeORMEntities } from '../parser.js'
import { NormalizedType, FKAction } from '../../../types/schema.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseOne(source: string) {
  const schema = parseTypeORMEntities([{ path: 'test.ts', content: source }])
  return schema
}

function getTable(source: string, tableName: string) {
  const schema = parseOne(source)
  return schema.tables.get(tableName)
}

function getColumn(source: string, tableName: string, colName: string) {
  const table = getTable(source, tableName)
  return table?.columns.get(colName)
}

// ─── Entity Decorator ───────────────────────────────────────────────────────

describe('TypeORM Entity Parser', () => {
  describe('@Entity decorator', () => {
    it('parses @Entity with string name', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const schema = parseOne(source)
      expect(schema.tables.has('users')).toBe(true)
    })

    it('parses @Entity with object name option', () => {
      const source = `
        @Entity({ name: 'app_users' })
        class User {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const schema = parseOne(source)
      expect(schema.tables.has('app_users')).toBe(true)
    })

    it('falls back to snake_case class name when @Entity has no args', () => {
      const source = `
        @Entity()
        class UserProfile {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const schema = parseOne(source)
      expect(schema.tables.has('user_profile')).toBe(true)
    })

    it('parses @Entity with double-quoted name', () => {
      const source = `
        @Entity("my_table")
        class MyEntity {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const schema = parseOne(source)
      expect(schema.tables.has('my_table')).toBe(true)
    })
  })

  // ─── PrimaryGeneratedColumn ─────────────────────────────────────────────

  describe('@PrimaryGeneratedColumn', () => {
    it('creates auto-increment integer PK by default', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const col = getColumn(source, 'items', 'id')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.INTEGER)
      expect(col!.isAutoIncrement).toBe(true)
      expect(col!.isGenerated).toBe(true)
      expect(col!.hasDefault).toBe(true)

      const table = getTable(source, 'items')
      expect(table!.primaryKey).toEqual({
        columns: ['id'],
        name: 'PK_items',
      })
    })

    it('creates UUID PK with "uuid" arg', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn('uuid')
          id: string;
        }
      `
      const col = getColumn(source, 'items', 'id')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.UUID)
      expect(col!.nativeType).toBe('uuid')
      expect(col!.isAutoIncrement).toBe(false)
      expect(col!.isGenerated).toBe(true)
    })

    it('creates integer PK with "increment" arg', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn('increment')
          id: number;
        }
      `
      const col = getColumn(source, 'items', 'id')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.INTEGER)
      expect(col!.isAutoIncrement).toBe(true)
    })
  })

  // ─── PrimaryColumn ─────────────────────────────────────────────────────

  describe('@PrimaryColumn', () => {
    it('marks column as primary key', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryColumn()
          id: number;
        }
      `
      const table = getTable(source, 'items')
      expect(table!.primaryKey).toBeDefined()
      expect(table!.primaryKey!.columns).toContain('id')
    })
  })

  // ─── @Column types ────────────────────────────────────────────────────

  describe('@Column type mapping', () => {
    it('maps varchar type', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', length: 255 })
          name: string;
        }
      `
      const col = getColumn(source, 'users', 'name')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.VARCHAR)
      expect(col!.maxLength).toBe(255)
    })

    it('maps text type', () => {
      const source = `
        @Entity('posts')
        class Post {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'text' })
          body: string;
        }
      `
      const col = getColumn(source, 'posts', 'body')
      expect(col!.dataType).toBe(NormalizedType.TEXT)
    })

    it('maps integer type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'integer' })
          count: number;
        }
      `
      const col = getColumn(source, 'items', 'count')
      expect(col!.dataType).toBe(NormalizedType.INTEGER)
    })

    it('maps bigint type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'bigint' })
          bigNum: number;
        }
      `
      const col = getColumn(source, 'items', 'big_num')
      expect(col!.dataType).toBe(NormalizedType.BIGINT)
    })

    it('maps boolean type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'boolean' })
          isActive: boolean;
        }
      `
      const col = getColumn(source, 'items', 'is_active')
      expect(col!.dataType).toBe(NormalizedType.BOOLEAN)
    })

    it('maps json type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'jsonb' })
          metadata: object;
        }
      `
      const col = getColumn(source, 'items', 'metadata')
      expect(col!.dataType).toBe(NormalizedType.JSONB)
    })

    it('maps uuid type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'uuid' })
          externalId: string;
        }
      `
      const col = getColumn(source, 'items', 'external_id')
      expect(col!.dataType).toBe(NormalizedType.UUID)
    })

    it('maps decimal with precision and scale', () => {
      const source = `
        @Entity('products')
        class Product {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'decimal', precision: 10, scale: 2 })
          price: number;
        }
      `
      const col = getColumn(source, 'products', 'price')
      expect(col!.dataType).toBe(NormalizedType.DECIMAL)
      expect(col!.numericPrecision).toBe(10)
      expect(col!.numericScale).toBe(2)
    })

    it('maps timestamp types', () => {
      const source = `
        @Entity('events')
        class Event {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'timestamp' })
          startTime: Date;

          @Column({ type: 'timestamptz' })
          endTime: Date;
        }
      `
      const col1 = getColumn(source, 'events', 'start_time')
      expect(col1!.dataType).toBe(NormalizedType.TIMESTAMP)

      const col2 = getColumn(source, 'events', 'end_time')
      expect(col2!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
    })

    it('infers TEXT from TypeScript string type when no @Column type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          title: string;
        }
      `
      const col = getColumn(source, 'items', 'title')
      expect(col!.dataType).toBe(NormalizedType.TEXT)
    })

    it('infers INTEGER from TypeScript number type when no @Column type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          quantity: number;
        }
      `
      const col = getColumn(source, 'items', 'quantity')
      expect(col!.dataType).toBe(NormalizedType.INTEGER)
    })

    it('infers BOOLEAN from TypeScript boolean type when no @Column type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          active: boolean;
        }
      `
      const col = getColumn(source, 'items', 'active')
      expect(col!.dataType).toBe(NormalizedType.BOOLEAN)
    })

    it('infers TIMESTAMPTZ from TypeScript Date type when no @Column type', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          dueDate: Date;
        }
      `
      const col = getColumn(source, 'items', 'due_date')
      expect(col!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
    })
  })

  // ─── Column Options ────────────────────────────────────────────────────

  describe('@Column options', () => {
    it('parses nullable: true', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', nullable: true })
          bio: string;
        }
      `
      const col = getColumn(source, 'users', 'bio')
      expect(col!.isNullable).toBe(true)
    })

    it('parses nullable: false (default)', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', nullable: false })
          name: string;
        }
      `
      const col = getColumn(source, 'users', 'name')
      expect(col!.isNullable).toBe(false)
    })

    it('parses unique: true into unique constraints', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', unique: true })
          email: string;
        }
      `
      const table = getTable(source, 'users')
      expect(table!.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
      expect(table!.uniqueConstraints[0].columns).toContain('email')
    })

    it('parses default value', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'boolean', default: true })
          isActive: boolean;
        }
      `
      const col = getColumn(source, 'users', 'is_active')
      expect(col!.hasDefault).toBe(true)
      expect(col!.defaultValue).toBe('true')
    })

    it('parses string default value', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', default: 'anonymous' })
          nickname: string;
        }
      `
      const col = getColumn(source, 'users', 'nickname')
      expect(col!.hasDefault).toBe(true)
      expect(col!.defaultValue).toBe('anonymous')
    })

    it('parses column name override', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', name: 'display_name' })
          displayName: string;
        }
      `
      const table = getTable(source, 'users')
      expect(table!.columns.has('display_name')).toBe(true)
    })
  })

  // ─── Date columns ─────────────────────────────────────────────────────

  describe('Date columns', () => {
    it('parses @CreateDateColumn', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @CreateDateColumn()
          createdAt: Date;
        }
      `
      const col = getColumn(source, 'items', 'created_at')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(col!.hasDefault).toBe(true)
    })

    it('parses @UpdateDateColumn', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @UpdateDateColumn()
          updatedAt: Date;
        }
      `
      const col = getColumn(source, 'items', 'updated_at')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(col!.hasDefault).toBe(true)
    })

    it('parses @DeleteDateColumn as nullable timestamptz', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @DeleteDateColumn()
          deletedAt: Date;
        }
      `
      const col = getColumn(source, 'items', 'deleted_at')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(col!.isNullable).toBe(true)
    })
  })

  // ─── Enum Detection ────────────────────────────────────────────────────

  describe('Enum detection', () => {
    it('parses inline enum array values', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'enum', enum: ['admin', 'user', 'moderator'] })
          role: string;
        }
      `
      const col = getColumn(source, 'users', 'role')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.ENUM)
      expect(col!.enumValues).toEqual(['admin', 'user', 'moderator'])
    })

    it('parses TypeScript enum reference', () => {
      const source = `
        enum UserRole {
          ADMIN = 'admin',
          USER = 'user',
          MOD = 'moderator',
        }

        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'enum', enum: UserRole })
          role: UserRole;
        }
      `
      const col = getColumn(source, 'users', 'role')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.ENUM)
      expect(col!.enumValues).toEqual(['admin', 'user', 'moderator'])
    })

    it('registers TypeScript enum as EnumDef in schema', () => {
      const source = `
        enum Status {
          ACTIVE = 'active',
          INACTIVE = 'inactive',
        }

        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'enum', enum: Status })
          status: Status;
        }
      `
      const schema = parseOne(source)
      expect(schema.enums.has('Status')).toBe(true)
      expect(schema.enums.get('Status')!.values).toEqual(['active', 'inactive'])
    })

    it('parses enum with default value', () => {
      const source = `
        enum UserRole {
          ADMIN = 'admin',
          USER = 'user',
        }

        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
          role: UserRole;
        }
      `
      const col = getColumn(source, 'users', 'role')
      expect(col!.hasDefault).toBe(true)
    })
  })

  // ─── Relation Parsing ─────────────────────────────────────────────────

  describe('Relation parsing', () => {
    describe('ManyToOne', () => {
      it('creates FK with @JoinColumn name', () => {
        const source = `
          @Entity('departments')
          class Department {
            @PrimaryGeneratedColumn()
            id: number;

            @Column({ type: 'varchar' })
            name: string;
          }

          @Entity('users')
          class User {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToOne(() => Department, { onDelete: 'CASCADE' })
            @JoinColumn({ name: 'department_id' })
            department: Department;
          }
        `
        const schema = parseOne(source)
        const usersTable = schema.tables.get('users')
        expect(usersTable).toBeDefined()

        // Should have FK column
        expect(usersTable!.columns.has('department_id')).toBe(true)

        // Should have FK def
        expect(usersTable!.foreignKeys.length).toBe(1)
        const fk = usersTable!.foreignKeys[0]
        expect(fk.columns).toEqual(['department_id'])
        expect(fk.referencedTable).toBe('departments')
        expect(fk.referencedColumns).toEqual(['id'])
        expect(fk.onDelete).toBe(FKAction.CASCADE)
      })

      it('auto-generates FK column name without @JoinColumn', () => {
        const source = `
          @Entity('categories')
          class Category {
            @PrimaryGeneratedColumn()
            id: number;
          }

          @Entity('products')
          class Product {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToOne(() => Category)
            category: Category;
          }
        `
        const table = getTable(source, 'products')
        expect(table!.columns.has('category_id')).toBe(true)
        expect(table!.foreignKeys.length).toBe(1)
        expect(table!.foreignKeys[0].columns).toEqual(['category_id'])
        expect(table!.foreignKeys[0].referencedTable).toBe('categories')
      })

      it('parses onUpdate action', () => {
        const source = `
          @Entity('parents')
          class Parent {
            @PrimaryGeneratedColumn()
            id: number;
          }

          @Entity('children')
          class Child {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToOne(() => Parent, { onDelete: 'SET NULL', onUpdate: 'CASCADE' })
            @JoinColumn({ name: 'parent_id' })
            parent: Parent;
          }
        `
        const table = getTable(source, 'children')
        const fk = table!.foreignKeys[0]
        expect(fk.onDelete).toBe(FKAction.SET_NULL)
        expect(fk.onUpdate).toBe(FKAction.CASCADE)
      })
    })

    describe('OneToOne', () => {
      it('creates FK with @JoinColumn', () => {
        const source = `
          @Entity('profiles')
          class Profile {
            @PrimaryGeneratedColumn()
            id: number;
          }

          @Entity('users')
          class User {
            @PrimaryGeneratedColumn()
            id: number;

            @OneToOne(() => Profile)
            @JoinColumn({ name: 'profile_id' })
            profile: Profile;
          }
        `
        const table = getTable(source, 'users')
        expect(table!.columns.has('profile_id')).toBe(true)
        expect(table!.foreignKeys.length).toBe(1)
        expect(table!.foreignKeys[0].referencedTable).toBe('profiles')
      })
    })

    describe('OneToMany (inverse side)', () => {
      it('does not create FK on inverse side', () => {
        const source = `
          @Entity('departments')
          class Department {
            @PrimaryGeneratedColumn()
            id: number;

            @OneToMany(() => User, (user) => user.department)
            users: User[];
          }
        `
        // OneToMany is inverse side - no FK should be created
        const table = getTable(source, 'departments')
        expect(table!.foreignKeys.length).toBe(0)
      })
    })

    describe('ManyToMany', () => {
      it('creates join table with @JoinTable', () => {
        const source = `
          @Entity('students')
          class Student {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToMany(() => Course)
            @JoinTable({ name: 'student_courses' })
            courses: Course[];
          }

          @Entity('courses')
          class Course {
            @PrimaryGeneratedColumn()
            id: number;

            @Column({ type: 'varchar' })
            title: string;
          }
        `
        const schema = parseOne(source)

        // Join table should exist
        const joinTable = schema.tables.get('student_courses')
        expect(joinTable).toBeDefined()

        // Should have two FK columns
        expect(joinTable!.columns.has('student_id')).toBe(true)
        expect(joinTable!.columns.has('course_id')).toBe(true)

        // Should have two FKs
        expect(joinTable!.foreignKeys.length).toBe(2)

        // Should have composite PK
        expect(joinTable!.primaryKey).toBeDefined()
        expect(joinTable!.primaryKey!.columns).toEqual(['student_id', 'course_id'])
      })

      it('creates join table with default name when no name specified', () => {
        const source = `
          @Entity('tags')
          class Tag {
            @PrimaryGeneratedColumn()
            id: number;
          }

          @Entity('articles')
          class Article {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToMany(() => Tag)
            @JoinTable()
            tags: Tag[];
          }
        `
        const schema = parseOne(source)
        // Default name is alphabetical: article_tag
        const joinTable = schema.tables.get('article_tag')
        expect(joinTable).toBeDefined()
      })

      it('creates join table with custom column names', () => {
        const source = `
          @Entity('users')
          class User {
            @PrimaryGeneratedColumn()
            id: number;

            @ManyToMany(() => Role)
            @JoinTable({
              name: 'user_roles',
              joinColumn: { name: 'uid' },
              inverseJoinColumn: { name: 'rid' }
            })
            roles: Role[];
          }

          @Entity('roles')
          class Role {
            @PrimaryGeneratedColumn()
            id: number;
          }
        `
        const schema = parseOne(source)
        const joinTable = schema.tables.get('user_roles')
        expect(joinTable).toBeDefined()
        expect(joinTable!.columns.has('uid')).toBe(true)
        expect(joinTable!.columns.has('rid')).toBe(true)
      })
    })
  })

  // ─── Realistic Multi-Entity Schema ────────────────────────────────────

  describe('Realistic multi-entity schema', () => {
    it('parses a full blog schema', () => {
      const source = `
        enum UserRole {
          ADMIN = 'admin',
          EDITOR = 'editor',
          USER = 'user',
        }

        enum PostStatus {
          DRAFT = 'draft',
          PUBLISHED = 'published',
          ARCHIVED = 'archived',
        }

        @Entity('users')
        class User {
          @PrimaryGeneratedColumn('uuid')
          id: string;

          @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
          email: string;

          @Column({ type: 'varchar', length: 100 })
          firstName: string;

          @Column({ type: 'varchar', length: 100 })
          lastName: string;

          @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
          role: UserRole;

          @Column({ type: 'boolean', default: true })
          isActive: boolean;

          @CreateDateColumn()
          createdAt: Date;

          @UpdateDateColumn()
          updatedAt: Date;

          @DeleteDateColumn()
          deletedAt: Date;
        }

        @Entity('categories')
        class Category {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', length: 100, unique: true })
          name: string;

          @Column({ type: 'varchar', length: 200, nullable: true })
          slug: string;

          @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
          @JoinColumn({ name: 'parent_id' })
          parent: Category;
        }

        @Entity('posts')
        class Post {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', length: 200 })
          title: string;

          @Column({ type: 'text' })
          body: string;

          @Column({ type: 'enum', enum: PostStatus, default: PostStatus.DRAFT })
          status: PostStatus;

          @Column({ type: 'jsonb', nullable: true })
          metadata: object;

          @ManyToOne(() => User, { onDelete: 'CASCADE' })
          @JoinColumn({ name: 'author_id' })
          author: User;

          @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
          @JoinColumn({ name: 'category_id' })
          category: Category;

          @ManyToMany(() => Tag)
          @JoinTable({ name: 'post_tags' })
          tags: Tag[];

          @CreateDateColumn()
          createdAt: Date;

          @UpdateDateColumn()
          updatedAt: Date;
        }

        @Entity('tags')
        class Tag {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar', length: 50, unique: true })
          name: string;
        }

        @Entity('comments')
        class Comment {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'text' })
          content: string;

          @ManyToOne(() => User, { onDelete: 'CASCADE' })
          @JoinColumn({ name: 'user_id' })
          user: User;

          @ManyToOne(() => Post, { onDelete: 'CASCADE' })
          @JoinColumn({ name: 'post_id' })
          post: Post;

          @CreateDateColumn()
          createdAt: Date;
        }
      `

      const schema = parseOne(source)

      // Should have all tables
      expect(schema.tables.has('users')).toBe(true)
      expect(schema.tables.has('categories')).toBe(true)
      expect(schema.tables.has('posts')).toBe(true)
      expect(schema.tables.has('tags')).toBe(true)
      expect(schema.tables.has('comments')).toBe(true)
      expect(schema.tables.has('post_tags')).toBe(true)

      // Users table
      const users = schema.tables.get('users')!
      expect(users.primaryKey?.columns).toEqual(['id'])
      expect(users.columns.get('id')!.dataType).toBe(NormalizedType.UUID)
      expect(users.columns.get('email')!.dataType).toBe(NormalizedType.VARCHAR)
      expect(users.columns.get('email')!.maxLength).toBe(255)
      expect(users.columns.get('role')!.dataType).toBe(NormalizedType.ENUM)
      expect(users.columns.get('role')!.enumValues).toEqual(['admin', 'editor', 'user'])
      expect(users.columns.get('is_active')!.hasDefault).toBe(true)
      expect(users.columns.get('created_at')!.dataType).toBe(NormalizedType.TIMESTAMPTZ)
      expect(users.columns.get('deleted_at')!.isNullable).toBe(true)
      expect(users.uniqueConstraints.some(u => u.columns.includes('email'))).toBe(true)

      // Categories table (self-referencing)
      const categories = schema.tables.get('categories')!
      expect(categories.foreignKeys.length).toBe(1)
      expect(categories.foreignKeys[0].referencedTable).toBe('categories')
      expect(categories.foreignKeys[0].columns).toEqual(['parent_id'])

      // Posts table
      const posts = schema.tables.get('posts')!
      expect(posts.foreignKeys.length).toBe(2)
      const authorFK = posts.foreignKeys.find(fk => fk.columns[0] === 'author_id')
      expect(authorFK).toBeDefined()
      expect(authorFK!.referencedTable).toBe('users')
      expect(authorFK!.onDelete).toBe(FKAction.CASCADE)

      const categoryFK = posts.foreignKeys.find(fk => fk.columns[0] === 'category_id')
      expect(categoryFK).toBeDefined()
      expect(categoryFK!.referencedTable).toBe('categories')

      // Join table
      const postTags = schema.tables.get('post_tags')!
      expect(postTags.foreignKeys.length).toBe(2)
      expect(postTags.primaryKey?.columns).toEqual(['post_id', 'tag_id'])

      // Comments table
      const comments = schema.tables.get('comments')!
      expect(comments.foreignKeys.length).toBe(2)

      // Enums
      expect(schema.enums.has('UserRole')).toBe(true)
      expect(schema.enums.has('PostStatus')).toBe(true)
    })
  })

  // ─── Multiple files ───────────────────────────────────────────────────

  describe('Multi-file parsing', () => {
    it('resolves cross-file FK references', () => {
      const userFile = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar' })
          name: string;
        }
      `
      const orderFile = `
        @Entity('orders')
        class Order {
          @PrimaryGeneratedColumn()
          id: number;

          @ManyToOne(() => User, { onDelete: 'CASCADE' })
          @JoinColumn({ name: 'user_id' })
          user: User;
        }
      `
      const schema = parseTypeORMEntities([
        { path: 'user.ts', content: userFile },
        { path: 'order.ts', content: orderFile },
      ])

      const orders = schema.tables.get('orders')!
      expect(orders.foreignKeys.length).toBe(1)
      expect(orders.foreignKeys[0].referencedTable).toBe('users')
      expect(orders.foreignKeys[0].referencedColumns).toEqual(['id'])
    })
  })

  // ─── parseTypeORMSource ───────────────────────────────────────────────

  describe('parseTypeORMSource', () => {
    it('returns parsed entity array', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ type: 'varchar' })
          name: string;
        }
      `
      const entities = parseTypeORMSource(source)
      expect(entities.length).toBe(1)
      expect(entities[0].className).toBe('User')
      expect(entities[0].tableName).toBe('users')
      expect(entities[0].columns.length).toBe(2)
    })

    it('handles multiple entities in one file', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn()
          id: number;
        }

        @Entity('posts')
        class Post {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const entities = parseTypeORMSource(source)
      expect(entities.length).toBe(2)
    })
  })

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles shorthand @Column type string', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column('varchar')
          name: string;
        }
      `
      const col = getColumn(source, 'items', 'name')
      expect(col!.dataType).toBe(NormalizedType.VARCHAR)
    })

    it('handles @Column with no arguments', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @Column()
          description: string;
        }
      `
      const col = getColumn(source, 'items', 'description')
      expect(col).toBeDefined()
      expect(col!.dataType).toBe(NormalizedType.TEXT)
    })

    it('handles FK to UUID PK entity', () => {
      const source = `
        @Entity('users')
        class User {
          @PrimaryGeneratedColumn('uuid')
          id: string;
        }

        @Entity('posts')
        class Post {
          @PrimaryGeneratedColumn()
          id: number;

          @ManyToOne(() => User)
          @JoinColumn({ name: 'author_id' })
          author: User;
        }
      `
      const posts = getTable(source, 'posts')
      // FK column type should match referenced PK type (UUID)
      expect(posts!.columns.get('author_id')!.dataType).toBe(NormalizedType.UUID)
    })

    it('handles @CreateDateColumn with custom name', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;

          @CreateDateColumn({ name: 'date_created' })
          createdAt: Date;
        }
      `
      const table = getTable(source, 'items')
      expect(table!.columns.has('date_created')).toBe(true)
    })

    it('DatabaseSchema structure is correct', () => {
      const source = `
        @Entity('items')
        class Item {
          @PrimaryGeneratedColumn()
          id: number;
        }
      `
      const schema = parseOne(source)
      expect(schema.name).toBe('typeorm')
      expect(schema.schemas).toEqual(['public'])
      expect(schema.tables).toBeInstanceOf(Map)
      expect(schema.enums).toBeInstanceOf(Map)
    })
  })
})
