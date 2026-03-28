import { describe, it, expect } from 'vitest'
import { parsePrismaSchema } from '../parser.js'
import { NormalizedType, FKAction } from '../../../types/schema.js'

// ---------------------------------------------------------------------------
// Helper to get a column from a parsed schema
// ---------------------------------------------------------------------------

function getTable(schema: ReturnType<typeof parsePrismaSchema>, name: string) {
  const t = schema.tables.get(name)
  if (!t) throw new Error(`Table "${name}" not found. Available: ${[...schema.tables.keys()].join(', ')}`)
  return t
}

function getColumn(schema: ReturnType<typeof parsePrismaSchema>, table: string, col: string) {
  const t = getTable(schema, table)
  const c = t.columns.get(col)
  if (!c) throw new Error(`Column "${col}" not found in "${table}". Available: ${[...t.columns.keys()].join(', ')}`)
  return c
}

// ===========================================================================
// 1. Model Parsing
// ===========================================================================

describe('Prisma Parser — Model Parsing', () => {
  it('parses a simple model', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        name  String
        email String @unique
      }
    `)

    const table = getTable(schema, 'User')
    expect(table.name).toBe('User')
    expect(table.schema).toBe('public')
    expect(table.columns.size).toBe(3)
    expect(table.columns.has('id')).toBe(true)
    expect(table.columns.has('name')).toBe(true)
    expect(table.columns.has('email')).toBe(true)
  })

  it('uses @@map to override table name', () => {
    const schema = parsePrismaSchema(`
      model UserProfile {
        id   Int    @id @default(autoincrement())
        name String

        @@map("user_profiles")
      }
    `)

    expect(schema.tables.has('user_profiles')).toBe(true)
    expect(schema.tables.has('UserProfile')).toBe(false)

    const table = getTable(schema, 'user_profiles')
    expect(table.name).toBe('user_profiles')
  })

  it('uses @map on fields to override column names', () => {
    const schema = parsePrismaSchema(`
      model User {
        id        Int    @id @default(autoincrement())
        firstName String @map("first_name")
        lastName  String @map("last_name")
      }
    `)

    const table = getTable(schema, 'User')
    expect(table.columns.has('first_name')).toBe(true)
    expect(table.columns.has('last_name')).toBe(true)
    // The original field names should NOT appear as column names
    expect(table.columns.has('firstName')).toBe(false)
    expect(table.columns.has('lastName')).toBe(false)
  })

  it('parses multiple models', () => {
    const schema = parsePrismaSchema(`
      model User {
        id   Int    @id @default(autoincrement())
        name String
      }

      model Post {
        id    Int    @id @default(autoincrement())
        title String
      }
    `)

    expect(schema.tables.size).toBe(2)
    expect(schema.tables.has('User')).toBe(true)
    expect(schema.tables.has('Post')).toBe(true)
  })
})

// ===========================================================================
// 2. Field Type Mapping
// ===========================================================================

describe('Prisma Parser — Field Type Mapping', () => {
  const schema = parsePrismaSchema(`
    model TypeTest {
      id       Int      @id @default(autoincrement())
      str      String
      integer  Int
      bigint   BigInt
      float    Float
      decimal  Decimal
      bool     Boolean
      dateTime DateTime
      json     Json
      bytes    Bytes
    }
  `)

  const cases: [string, NormalizedType][] = [
    ['str', NormalizedType.TEXT],
    ['integer', NormalizedType.INTEGER],
    ['bigint', NormalizedType.BIGINT],
    ['float', NormalizedType.DOUBLE],
    ['decimal', NormalizedType.DECIMAL],
    ['bool', NormalizedType.BOOLEAN],
    ['dateTime', NormalizedType.TIMESTAMPTZ],
    ['json', NormalizedType.JSON],
    ['bytes', NormalizedType.BYTEA],
  ]

  for (const [colName, expectedType] of cases) {
    it(`maps ${colName} to ${expectedType}`, () => {
      const col = getColumn(schema, 'TypeTest', colName)
      expect(col.dataType).toBe(expectedType)
    })
  }

  it('maps @id autoincrement field correctly', () => {
    const col = getColumn(schema, 'TypeTest', 'id')
    expect(col.dataType).toBe(NormalizedType.INTEGER)
    expect(col.isAutoIncrement).toBe(true)
    expect(col.hasDefault).toBe(true)
  })

  it('handles optional fields (String?)', () => {
    const schema = parsePrismaSchema(`
      model User {
        id   Int     @id @default(autoincrement())
        bio  String?
        name String
      }
    `)

    expect(getColumn(schema, 'User', 'bio').isNullable).toBe(true)
    expect(getColumn(schema, 'User', 'name').isNullable).toBe(false)
  })

  it('maps @default(uuid()) to UUID type', () => {
    const schema = parsePrismaSchema(`
      model User {
        id String @id @default(uuid())
      }
    `)

    const col = getColumn(schema, 'User', 'id')
    expect(col.dataType).toBe(NormalizedType.UUID)
    expect(col.hasDefault).toBe(true)
  })
})

// ===========================================================================
// 3. Defaults
// ===========================================================================

describe('Prisma Parser — Defaults', () => {
  it('handles @default(autoincrement())', () => {
    const schema = parsePrismaSchema(`
      model T {
        id Int @id @default(autoincrement())
      }
    `)
    const col = getColumn(schema, 'T', 'id')
    expect(col.isAutoIncrement).toBe(true)
    expect(col.hasDefault).toBe(true)
  })

  it('handles @default(now())', () => {
    const schema = parsePrismaSchema(`
      model T {
        id        Int      @id @default(autoincrement())
        createdAt DateTime @default(now())
      }
    `)
    const col = getColumn(schema, 'T', 'createdAt')
    expect(col.hasDefault).toBe(true)
    expect(col.defaultValue).toBe('now()')
  })

  it('handles @default("value")', () => {
    const schema = parsePrismaSchema(`
      model T {
        id     Int    @id @default(autoincrement())
        status String @default("active")
      }
    `)
    const col = getColumn(schema, 'T', 'status')
    expect(col.hasDefault).toBe(true)
    expect(col.defaultValue).toBe('active')
  })

  it('handles @default(true/false)', () => {
    const schema = parsePrismaSchema(`
      model T {
        id     Int     @id @default(autoincrement())
        active Boolean @default(true)
      }
    `)
    const col = getColumn(schema, 'T', 'active')
    expect(col.hasDefault).toBe(true)
    expect(col.defaultValue).toBe('true')
  })

  it('handles @default with numeric value', () => {
    const schema = parsePrismaSchema(`
      model T {
        id    Int @id @default(autoincrement())
        count Int @default(0)
      }
    `)
    const col = getColumn(schema, 'T', 'count')
    expect(col.hasDefault).toBe(true)
    expect(col.defaultValue).toBe('0')
  })

  it('handles @updatedAt as hasDefault', () => {
    const schema = parsePrismaSchema(`
      model T {
        id        Int      @id @default(autoincrement())
        updatedAt DateTime @updatedAt
      }
    `)
    const col = getColumn(schema, 'T', 'updatedAt')
    expect(col.hasDefault).toBe(true)
  })
})

// ===========================================================================
// 4. Primary Keys
// ===========================================================================

describe('Prisma Parser — Primary Keys', () => {
  it('detects @id on a single field', () => {
    const schema = parsePrismaSchema(`
      model User {
        id   Int    @id @default(autoincrement())
        name String
      }
    `)

    const table = getTable(schema, 'User')
    expect(table.primaryKey).not.toBeNull()
    expect(table.primaryKey!.columns).toEqual(['id'])
  })

  it('detects @@id composite primary key', () => {
    const schema = parsePrismaSchema(`
      model PostTag {
        postId Int
        tagId  Int

        @@id([postId, tagId])
      }
    `)

    const table = getTable(schema, 'PostTag')
    expect(table.primaryKey).not.toBeNull()
    expect(table.primaryKey!.columns).toEqual(['postId', 'tagId'])
  })

  it('resolves @@id column names through @map', () => {
    const schema = parsePrismaSchema(`
      model PostTag {
        postId Int @map("post_id")
        tagId  Int @map("tag_id")

        @@id([postId, tagId])
      }
    `)

    const table = getTable(schema, 'PostTag')
    expect(table.primaryKey!.columns).toEqual(['post_id', 'tag_id'])
  })
})

// ===========================================================================
// 5. Unique Constraints
// ===========================================================================

describe('Prisma Parser — Unique Constraints', () => {
  it('detects @unique on a field', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        email String @unique
      }
    `)

    const table = getTable(schema, 'User')
    expect(table.uniqueConstraints.length).toBe(1)
    expect(table.uniqueConstraints[0].columns).toEqual(['email'])
  })

  it('detects @@unique composite constraint', () => {
    const schema = parsePrismaSchema(`
      model Subscription {
        id     Int @id @default(autoincrement())
        userId Int
        planId Int

        @@unique([userId, planId])
      }
    `)

    const table = getTable(schema, 'Subscription')
    expect(table.uniqueConstraints.length).toBe(1)
    expect(table.uniqueConstraints[0].columns).toEqual(['userId', 'planId'])
  })
})

// ===========================================================================
// 6. Relation Parsing
// ===========================================================================

describe('Prisma Parser — Relations', () => {
  it('parses one-to-many relation (owning side)', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        name  String
        posts Post[]
      }

      model Post {
        id       Int    @id @default(autoincrement())
        title    String
        userId   Int
        author   User   @relation(fields: [userId], references: [id])
      }
    `)

    const postTable = getTable(schema, 'Post')
    // The relation field "author" should NOT be a column
    expect(postTable.columns.has('author')).toBe(false)
    // userId IS a column
    expect(postTable.columns.has('userId')).toBe(true)
    // FK should exist
    expect(postTable.foreignKeys.length).toBe(1)
    expect(postTable.foreignKeys[0].columns).toEqual(['userId'])
    expect(postTable.foreignKeys[0].referencedTable).toBe('User')
    expect(postTable.foreignKeys[0].referencedColumns).toEqual(['id'])
  })

  it('parses one-to-one relation', () => {
    const schema = parsePrismaSchema(`
      model User {
        id      Int      @id @default(autoincrement())
        profile Profile?
      }

      model Profile {
        id     Int  @id @default(autoincrement())
        userId Int  @unique
        user   User @relation(fields: [userId], references: [id])
        bio    String
      }
    `)

    const profileTable = getTable(schema, 'Profile')
    expect(profileTable.columns.has('user')).toBe(false)
    expect(profileTable.columns.has('userId')).toBe(true)
    expect(profileTable.foreignKeys.length).toBe(1)
    expect(profileTable.foreignKeys[0].columns).toEqual(['userId'])
    expect(profileTable.foreignKeys[0].referencedTable).toBe('User')
  })

  it('parses onDelete and onUpdate actions', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        posts Post[]
      }

      model Post {
        id     Int    @id @default(autoincrement())
        userId Int
        author User   @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: SetNull)
      }
    `)

    const fk = getTable(schema, 'Post').foreignKeys[0]
    expect(fk.onDelete).toBe(FKAction.CASCADE)
    expect(fk.onUpdate).toBe(FKAction.SET_NULL)
  })

  it('defaults FK actions to NO_ACTION', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        posts Post[]
      }

      model Post {
        id     Int    @id @default(autoincrement())
        userId Int
        author User   @relation(fields: [userId], references: [id])
      }
    `)

    const fk = getTable(schema, 'Post').foreignKeys[0]
    expect(fk.onDelete).toBe(FKAction.NO_ACTION)
    expect(fk.onUpdate).toBe(FKAction.NO_ACTION)
  })

  it('resolves FK referenced table through @@map', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        posts Post[]

        @@map("users")
      }

      model Post {
        id     Int    @id @default(autoincrement())
        userId Int
        author User   @relation(fields: [userId], references: [id])

        @@map("posts")
      }
    `)

    const fk = getTable(schema, 'posts').foreignKeys[0]
    expect(fk.referencedTable).toBe('users')
  })

  it('handles many-to-many implicit relation', () => {
    const schema = parsePrismaSchema(`
      model Post {
        id   Int    @id @default(autoincrement())
        tags Tag[]
      }

      model Tag {
        id    Int    @id @default(autoincrement())
        posts Post[]
      }
    `)

    // Should create a join table
    const joinTable = schema.tables.get('_PostToTag')
    expect(joinTable).toBeDefined()
    expect(joinTable!.columns.has('A')).toBe(true)
    expect(joinTable!.columns.has('B')).toBe(true)
    expect(joinTable!.foreignKeys.length).toBe(2)

    // FK A -> Post, FK B -> Tag
    const fkA = joinTable!.foreignKeys.find((fk) => fk.columns[0] === 'A')!
    const fkB = joinTable!.foreignKeys.find((fk) => fk.columns[0] === 'B')!
    expect(fkA.referencedTable).toBe('Post')
    expect(fkB.referencedTable).toBe('Tag')
  })

  it('does not create M2M join table for explicit relations', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        posts Post[]
      }

      model Post {
        id     Int  @id @default(autoincrement())
        userId Int
        author User @relation(fields: [userId], references: [id])
      }
    `)

    // No join table should be created: Post[] has an explicit @relation on the other side
    // Only User and Post tables should exist
    expect(schema.tables.size).toBe(2)
    expect(schema.tables.has('_PostToUser')).toBe(false)
  })

  it('skips the virtual relation field (not a DB column)', () => {
    const schema = parsePrismaSchema(`
      model User {
        id    Int    @id @default(autoincrement())
        posts Post[]
      }

      model Post {
        id     Int    @id @default(autoincrement())
        userId Int
        author User   @relation(fields: [userId], references: [id])
      }
    `)

    const userTable = getTable(schema, 'User')
    // 'posts' is a virtual relation field, should not appear as column
    expect(userTable.columns.has('posts')).toBe(false)
    expect(userTable.columns.size).toBe(1) // only id

    const postTable = getTable(schema, 'Post')
    expect(postTable.columns.has('author')).toBe(false)
    expect(postTable.columns.size).toBe(2) // id, userId
  })

  it('maps all FKAction values', () => {
    const schema = parsePrismaSchema(`
      model Parent {
        id Int @id @default(autoincrement())
        c1 Child1[]
        c2 Child2[]
        c3 Child3[]
        c4 Child4[]
        c5 Child5[]
      }

      model Child1 {
        id       Int    @id @default(autoincrement())
        parentId Int
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: Cascade)
      }

      model Child2 {
        id       Int    @id @default(autoincrement())
        parentId Int
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: SetNull)
      }

      model Child3 {
        id       Int    @id @default(autoincrement())
        parentId Int
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: SetDefault)
      }

      model Child4 {
        id       Int    @id @default(autoincrement())
        parentId Int
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: Restrict)
      }

      model Child5 {
        id       Int    @id @default(autoincrement())
        parentId Int
        parent   Parent @relation(fields: [parentId], references: [id], onDelete: NoAction)
      }
    `)

    expect(getTable(schema, 'Child1').foreignKeys[0].onDelete).toBe(FKAction.CASCADE)
    expect(getTable(schema, 'Child2').foreignKeys[0].onDelete).toBe(FKAction.SET_NULL)
    expect(getTable(schema, 'Child3').foreignKeys[0].onDelete).toBe(FKAction.SET_DEFAULT)
    expect(getTable(schema, 'Child4').foreignKeys[0].onDelete).toBe(FKAction.RESTRICT)
    expect(getTable(schema, 'Child5').foreignKeys[0].onDelete).toBe(FKAction.NO_ACTION)
  })
})

// ===========================================================================
// 7. Enum Parsing
// ===========================================================================

describe('Prisma Parser — Enum Parsing', () => {
  it('parses a simple enum', () => {
    const schema = parsePrismaSchema(`
      enum Role {
        ADMIN
        USER
        EDITOR
      }
    `)

    expect(schema.enums.size).toBe(1)
    const roleEnum = schema.enums.get('Role')!
    expect(roleEnum).toBeDefined()
    expect(roleEnum.values).toEqual(['ADMIN', 'USER', 'EDITOR'])
    expect(roleEnum.schema).toBe('public')
  })

  it('parses multiple enums', () => {
    const schema = parsePrismaSchema(`
      enum Role {
        ADMIN
        USER
      }

      enum Status {
        ACTIVE
        INACTIVE
        PENDING
      }
    `)

    expect(schema.enums.size).toBe(2)
    expect(schema.enums.get('Role')!.values).toEqual(['ADMIN', 'USER'])
    expect(schema.enums.get('Status')!.values).toEqual(['ACTIVE', 'INACTIVE', 'PENDING'])
  })

  it('maps enum field type to ENUM with enumValues', () => {
    const schema = parsePrismaSchema(`
      enum Role {
        ADMIN
        USER
      }

      model User {
        id   Int  @id @default(autoincrement())
        role Role @default(USER)
      }
    `)

    const col = getColumn(schema, 'User', 'role')
    expect(col.dataType).toBe(NormalizedType.ENUM)
    expect(col.enumValues).toEqual(['ADMIN', 'USER'])
    expect(col.hasDefault).toBe(true)
  })

  it('handles enum with @@map', () => {
    const schema = parsePrismaSchema(`
      enum UserRole {
        ADMIN
        USER
        @@map("user_role")
      }
    `)

    expect(schema.enums.has('user_role')).toBe(true)
    expect(schema.enums.has('UserRole')).toBe(false)
    expect(schema.enums.get('user_role')!.values).toEqual(['ADMIN', 'USER'])
  })
})

// ===========================================================================
// 8. Comments are stripped
// ===========================================================================

describe('Prisma Parser — Comments', () => {
  it('ignores single-line comments', () => {
    const schema = parsePrismaSchema(`
      // This is a comment
      model User {
        id   Int    @id @default(autoincrement()) // PK
        name String // user name
      }
    `)

    const table = getTable(schema, 'User')
    expect(table.columns.size).toBe(2)
  })

  it('ignores datasource and generator blocks', () => {
    const schema = parsePrismaSchema(`
      datasource db {
        provider = "postgresql"
        url      = env("DATABASE_URL")
      }

      generator client {
        provider = "prisma-client-js"
      }

      model User {
        id   Int    @id @default(autoincrement())
        name String
      }
    `)

    // datasource and generator are not model/enum, should be ignored
    expect(schema.tables.size).toBe(1)
    expect(schema.tables.has('User')).toBe(true)
  })
})

// ===========================================================================
// 9. Realistic Multi-Model Schema
// ===========================================================================

describe('Prisma Parser — Realistic Multi-Model Schema', () => {
  const prismaSchema = `
    datasource db {
      provider = "postgresql"
      url      = env("DATABASE_URL")
    }

    generator client {
      provider = "prisma-client-js"
    }

    enum Role {
      ADMIN
      USER
      MODERATOR
    }

    enum PostStatus {
      DRAFT
      PUBLISHED
      ARCHIVED
    }

    model User {
      id        Int      @id @default(autoincrement())
      email     String   @unique
      name      String?
      role      Role     @default(USER)
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
      posts     Post[]
      profile   Profile?
      comments  Comment[]

      @@map("users")
    }

    model Profile {
      id     Int    @id @default(autoincrement())
      bio    String
      userId Int    @unique @map("user_id")
      user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

      @@map("profiles")
    }

    model Post {
      id        Int        @id @default(autoincrement())
      title     String
      content   String?
      status    PostStatus @default(DRAFT)
      authorId  Int        @map("author_id")
      author    User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
      createdAt DateTime   @default(now()) @map("created_at")
      tags      Tag[]
      comments  Comment[]

      @@map("posts")
    }

    model Tag {
      id    Int    @id @default(autoincrement())
      name  String @unique
      posts Post[]

      @@map("tags")
    }

    model Comment {
      id        Int      @id @default(autoincrement())
      text      String
      postId    Int      @map("post_id")
      post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
      authorId  Int      @map("author_id")
      author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
      createdAt DateTime @default(now()) @map("created_at")

      @@map("comments")
    }
  `

  const schema = parsePrismaSchema(prismaSchema)

  it('parses all tables', () => {
    // 5 models + 1 implicit M2M join table (_PostToTag)
    expect(schema.tables.has('users')).toBe(true)
    expect(schema.tables.has('profiles')).toBe(true)
    expect(schema.tables.has('posts')).toBe(true)
    expect(schema.tables.has('tags')).toBe(true)
    expect(schema.tables.has('comments')).toBe(true)
    expect(schema.tables.has('_PostToTag')).toBe(true)
    expect(schema.tables.size).toBe(6)
  })

  it('parses all enums', () => {
    expect(schema.enums.size).toBe(2)
    expect(schema.enums.has('Role')).toBe(true)
    expect(schema.enums.has('PostStatus')).toBe(true)
  })

  it('users table has correct columns', () => {
    const users = getTable(schema, 'users')
    expect(users.columns.size).toBe(6) // id, email, name, role, createdAt, updatedAt
    expect(users.columns.has('id')).toBe(true)
    expect(users.columns.has('email')).toBe(true)
    expect(users.columns.has('name')).toBe(true)
    expect(users.columns.has('role')).toBe(true)
    expect(users.columns.has('createdAt')).toBe(true)
    expect(users.columns.has('updatedAt')).toBe(true)
    // Virtual relation fields should NOT be columns
    expect(users.columns.has('posts')).toBe(false)
    expect(users.columns.has('profile')).toBe(false)
    expect(users.columns.has('comments')).toBe(false)
  })

  it('users.name is nullable', () => {
    expect(getColumn(schema, 'users', 'name').isNullable).toBe(true)
  })

  it('users.email is unique', () => {
    const users = getTable(schema, 'users')
    expect(users.uniqueConstraints.some((u) => u.columns.includes('email'))).toBe(true)
  })

  it('users.role is an enum with correct values', () => {
    const col = getColumn(schema, 'users', 'role')
    expect(col.dataType).toBe(NormalizedType.ENUM)
    expect(col.enumValues).toEqual(['ADMIN', 'USER', 'MODERATOR'])
    expect(col.hasDefault).toBe(true)
  })

  it('profiles has FK to users with Cascade', () => {
    const profiles = getTable(schema, 'profiles')
    expect(profiles.foreignKeys.length).toBe(1)
    expect(profiles.foreignKeys[0].columns).toEqual(['user_id'])
    expect(profiles.foreignKeys[0].referencedTable).toBe('users')
    expect(profiles.foreignKeys[0].onDelete).toBe(FKAction.CASCADE)
  })

  it('posts has FK to users via author_id', () => {
    const posts = getTable(schema, 'posts')
    const fk = posts.foreignKeys.find((f) => f.columns[0] === 'author_id')
    expect(fk).toBeDefined()
    expect(fk!.referencedTable).toBe('users')
    expect(fk!.onDelete).toBe(FKAction.CASCADE)
  })

  it('posts.created_at has default and @map', () => {
    const col = getColumn(schema, 'posts', 'created_at')
    expect(col.hasDefault).toBe(true)
    expect(col.defaultValue).toBe('now()')
  })

  it('comments has two FKs', () => {
    const comments = getTable(schema, 'comments')
    expect(comments.foreignKeys.length).toBe(2)

    const postFK = comments.foreignKeys.find((f) => f.columns[0] === 'post_id')
    expect(postFK).toBeDefined()
    expect(postFK!.referencedTable).toBe('posts')

    const authorFK = comments.foreignKeys.find((f) => f.columns[0] === 'author_id')
    expect(authorFK).toBeDefined()
    expect(authorFK!.referencedTable).toBe('users')
  })

  it('implicit M2M join table _PostToTag has correct FKs', () => {
    const join = getTable(schema, '_PostToTag')
    expect(join.foreignKeys.length).toBe(2)

    const fkA = join.foreignKeys.find((fk) => fk.columns[0] === 'A')!
    const fkB = join.foreignKeys.find((fk) => fk.columns[0] === 'B')!
    expect(fkA.referencedTable).toBe('posts')
    expect(fkB.referencedTable).toBe('tags')
    expect(fkA.onDelete).toBe(FKAction.CASCADE)
    expect(fkB.onDelete).toBe(FKAction.CASCADE)
  })

  it('join table has unique constraint on [A, B]', () => {
    const join = getTable(schema, '_PostToTag')
    expect(join.uniqueConstraints.length).toBe(1)
    expect(join.uniqueConstraints[0].columns).toEqual(['A', 'B'])
  })

  it('schemas is ["public"]', () => {
    expect(schema.schemas).toEqual(['public'])
  })

  it('schema name is "prisma"', () => {
    expect(schema.name).toBe('prisma')
  })
})

// ===========================================================================
// 10. Edge cases
// ===========================================================================

describe('Prisma Parser — Edge Cases', () => {
  it('handles empty schema', () => {
    const schema = parsePrismaSchema('')
    expect(schema.tables.size).toBe(0)
    expect(schema.enums.size).toBe(0)
  })

  it('handles schema with only datasource/generator blocks', () => {
    const schema = parsePrismaSchema(`
      datasource db {
        provider = "postgresql"
        url      = env("DATABASE_URL")
      }

      generator client {
        provider = "prisma-client-js"
      }
    `)
    expect(schema.tables.size).toBe(0)
    expect(schema.enums.size).toBe(0)
  })

  it('handles model with no @id (no primary key)', () => {
    const schema = parsePrismaSchema(`
      model View {
        col1 String
        col2 Int
      }
    `)
    const table = getTable(schema, 'View')
    expect(table.primaryKey).toBeNull()
  })

  it('handles @default(cuid())', () => {
    const schema = parsePrismaSchema(`
      model T {
        id String @id @default(cuid())
      }
    `)
    const col = getColumn(schema, 'T', 'id')
    expect(col.hasDefault).toBe(true)
  })
})
