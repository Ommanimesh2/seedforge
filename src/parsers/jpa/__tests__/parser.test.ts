import { describe, it, expect } from 'vitest'
import { parseJavaSource, parseJavaEnums, toSnakeCase } from '../parser.js'
import { NormalizedType, FKAction } from '../../../types/schema.js'

// ─── Helper ──────────────────────────────────────────────────────────────────

function col(result: ReturnType<typeof parseJavaSource>, name: string) {
  return result!.table.columns.get(name)!
}

// ─── toSnakeCase ─────────────────────────────────────────────────────────────

describe('toSnakeCase', () => {
  it('converts camelCase', () => {
    expect(toSnakeCase('createdAt')).toBe('created_at')
  })

  it('converts PascalCase', () => {
    expect(toSnakeCase('UserRole')).toBe('user_role')
  })

  it('handles consecutive uppercase letters', () => {
    expect(toSnakeCase('HTMLParser')).toBe('html_parser')
  })

  it('leaves already snake_case unchanged', () => {
    expect(toSnakeCase('already_snake')).toBe('already_snake')
  })

  it('handles single word', () => {
    expect(toSnakeCase('id')).toBe('id')
  })
})

// ─── Basic entity parsing ────────────────────────────────────────────────────

describe('basic entity parsing', () => {
  it('parses a simple @Entity class', () => {
    const source = `
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()
    expect(result!.table.name).toBe('user')
    expect(result!.table.columns.size).toBe(2)
  })

  it('uses @Table(name = ...) for table name', () => {
    const source = `
@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.name).toBe('users')
  })

  it('defaults table name to snake_case of class name', () => {
    const source = `
@Entity
public class OrderItem {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.name).toBe('order_item')
  })

  it('returns null for non-entity classes', () => {
    const source = `
public class NotAnEntity {
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result).toBeNull()
  })
})

// ─── @Id and @GeneratedValue ─────────────────────────────────────────────────

describe('@Id and @GeneratedValue', () => {
  it('marks @Id field as primary key', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.primaryKey).not.toBeNull()
    expect(result!.table.primaryKey!.columns).toEqual(['id'])
  })

  it('marks @GeneratedValue(IDENTITY) as auto-increment', () => {
    const source = `
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
}
`
    const result = parseJavaSource(source)
    const idCol = col(result, 'id')
    expect(idCol.isAutoIncrement).toBe(true)
  })

  it('marks @GeneratedValue(AUTO) as auto-increment', () => {
    const source = `
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
}
`
    const result = parseJavaSource(source)
    const idCol = col(result, 'id')
    expect(idCol.isAutoIncrement).toBe(true)
  })

  it('marks @GeneratedValue(SEQUENCE) as auto-increment', () => {
    const source = `
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;
}
`
    const result = parseJavaSource(source)
    const idCol = col(result, 'id')
    expect(idCol.isAutoIncrement).toBe(true)
  })

  it('@Id field is not nullable', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    const idCol = col(result, 'id')
    expect(idCol.isNullable).toBe(false)
  })
})

// ─── @Column attributes ─────────────────────────────────────────────────────

describe('@Column attributes', () => {
  it('uses @Column(name = ...) for column name', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Column(name = "email_address")
    private String email;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.columns.has('email_address')).toBe(true)
  })

  it('defaults column name to snake_case of field name', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    private String firstName;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.columns.has('first_name')).toBe(true)
  })

  it('parses nullable = false', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Column(nullable = false)
    private String email;
}
`
    const result = parseJavaSource(source)
    const emailCol = col(result, 'email')
    expect(emailCol.isNullable).toBe(false)
  })

  it('parses unique = true', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Column(unique = true)
    private String email;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.uniqueConstraints.length).toBe(1)
    expect(result!.table.uniqueConstraints[0].columns).toEqual(['email'])
  })

  it('parses length attribute', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Column(length = 100)
    private String name;
}
`
    const result = parseJavaSource(source)
    const nameCol = col(result, 'name')
    expect(nameCol.maxLength).toBe(100)
  })

  it('parses precision and scale', () => {
    const source = `
@Entity
public class Product {
    @Id
    private Long id;

    @Column(precision = 10, scale = 2)
    private BigDecimal price;
}
`
    const result = parseJavaSource(source)
    const priceCol = col(result, 'price')
    expect(priceCol.numericPrecision).toBe(10)
    expect(priceCol.numericScale).toBe(2)
  })

  it('handles multiple @Column attributes together', () => {
    const source = `
@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;
}
`
    const result = parseJavaSource(source)
    const emailCol = col(result, 'email')
    expect(emailCol.isNullable).toBe(false)
    expect(emailCol.maxLength).toBe(255)
    expect(result!.table.uniqueConstraints.length).toBe(1)
  })

  it('defaults VARCHAR maxLength to 255 when no length specified', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    private String name;
}
`
    const result = parseJavaSource(source)
    const nameCol = col(result, 'name')
    expect(nameCol.maxLength).toBe(255)
  })
})

// ─── Java type mapping ──────────────────────────────────────────────────────

describe('Java type mapping', () => {
  it.each([
    ['String', NormalizedType.VARCHAR],
    ['Integer', NormalizedType.INTEGER],
    ['int', NormalizedType.INTEGER],
    ['Long', NormalizedType.BIGINT],
    ['long', NormalizedType.BIGINT],
    ['Short', NormalizedType.SMALLINT],
    ['short', NormalizedType.SMALLINT],
    ['Double', NormalizedType.DOUBLE],
    ['double', NormalizedType.DOUBLE],
    ['Float', NormalizedType.REAL],
    ['float', NormalizedType.REAL],
    ['BigDecimal', NormalizedType.DECIMAL],
    ['Boolean', NormalizedType.BOOLEAN],
    ['boolean', NormalizedType.BOOLEAN],
    ['LocalDateTime', NormalizedType.TIMESTAMPTZ],
    ['Instant', NormalizedType.TIMESTAMPTZ],
    ['ZonedDateTime', NormalizedType.TIMESTAMPTZ],
    ['LocalDate', NormalizedType.DATE],
    ['LocalTime', NormalizedType.TIME],
    ['UUID', NormalizedType.UUID],
  ])('maps %s to %s', (javaType, expectedType) => {
    // Use field modifiers without @Column to test pure type mapping
    const source = `
@Entity
public class TestEntity {
    @Id
    private Long id;

    private ${javaType} testField;
}
`
    const result = parseJavaSource(source)
    const testCol = col(result, 'test_field')
    expect(testCol.dataType).toBe(expectedType)
  })

  it('maps byte[] to BYTEA', () => {
    const source = `
@Entity
public class TestEntity {
    @Id
    private Long id;

    private byte[] data;
}
`
    const result = parseJavaSource(source)
    const dataCol = col(result, 'data')
    expect(dataCol.dataType).toBe(NormalizedType.BYTEA)
  })
})

// ─── Timestamp annotations ──────────────────────────────────────────────────

describe('timestamp annotations', () => {
  it('marks @CreationTimestamp field as generated', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
`
    const result = parseJavaSource(source)
    const createdAtCol = col(result, 'created_at')
    expect(createdAtCol.isGenerated).toBe(true)
    expect(createdAtCol.hasDefault).toBe(true)
    expect(createdAtCol.defaultValue).toBe('CURRENT_TIMESTAMP')
  })

  it('marks @UpdateTimestamp field as generated', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
`
    const result = parseJavaSource(source)
    const updatedAtCol = col(result, 'updated_at')
    expect(updatedAtCol.isGenerated).toBe(true)
    expect(updatedAtCol.hasDefault).toBe(true)
  })
})

// ─── Enum parsing ────────────────────────────────────────────────────────────

describe('enum parsing', () => {
  it('parses @Enumerated field as ENUM type', () => {
    const source = `
public enum UserRole { ADMIN, USER, EDITOR }

@Entity
public class User {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private UserRole role;
}
`
    const result = parseJavaSource(source)
    const roleCol = col(result, 'role')
    expect(roleCol.dataType).toBe(NormalizedType.ENUM)
    expect(roleCol.enumValues).toEqual(['ADMIN', 'USER', 'EDITOR'])
  })

  it('creates EnumDef entries', () => {
    const source = `
public enum UserRole { ADMIN, USER, EDITOR }

@Entity
public class User {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private UserRole role;
}
`
    const result = parseJavaSource(source)
    expect(result!.enums.length).toBe(1)
    expect(result!.enums[0].name).toBe('user_role')
    expect(result!.enums[0].values).toEqual(['ADMIN', 'USER', 'EDITOR'])
  })

  it('guesses enum values when enum class not found', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private UserRole role;
}
`
    const result = parseJavaSource(source)
    const roleCol = col(result, 'role')
    expect(roleCol.dataType).toBe(NormalizedType.ENUM)
    expect(roleCol.enumValues).not.toBeNull()
    expect(roleCol.enumValues!.length).toBeGreaterThan(0)
  })

  it('parses Java enum with semicolons and methods', () => {
    const enums = parseJavaEnums(`
public enum Status {
    ACTIVE,
    INACTIVE,
    PENDING;

    public String getLabel() { return name().toLowerCase(); }
}
`)
    expect(enums).toHaveLength(1)
    expect(enums[0].name).toBe('Status')
    expect(enums[0].values).toEqual(['ACTIVE', 'INACTIVE', 'PENDING'])
  })

  it('parses multiple enums from one file', () => {
    const enums = parseJavaEnums(`
public enum Color { RED, GREEN, BLUE }
public enum Size { SMALL, MEDIUM, LARGE }
`)
    expect(enums).toHaveLength(2)
    expect(enums[0].name).toBe('Color')
    expect(enums[1].name).toBe('Size')
  })

  it('applies @Enumerated with @Column(nullable = false)', () => {
    const source = `
public enum UserRole { ADMIN, USER }

@Entity
public class User {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;
}
`
    const result = parseJavaSource(source)
    const roleCol = col(result, 'role')
    expect(roleCol.dataType).toBe(NormalizedType.ENUM)
    expect(roleCol.isNullable).toBe(false)
  })
})

// ─── Relation parsing: @ManyToOne ────────────────────────────────────────────

describe('@ManyToOne relations', () => {
  it('creates FK column from @ManyToOne + @JoinColumn', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "department_id")
    private Department department;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.columns.has('department_id')).toBe(true)
    expect(result!.table.foreignKeys.length).toBe(1)

    const fk = result!.table.foreignKeys[0]
    expect(fk.columns).toEqual(['department_id'])
    expect(fk.referencedTable).toBe('department')
    expect(fk.referencedColumns).toEqual(['id'])
  })

  it('respects nullable = false on @JoinColumn', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "department_id", nullable = false)
    private Department department;
}
`
    const result = parseJavaSource(source)
    const deptCol = col(result, 'department_id')
    expect(deptCol.isNullable).toBe(false)
  })

  it('defaults join column name when @JoinColumn has no name', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne
    private Department department;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.columns.has('department_id')).toBe(true)
  })

  it('sets CASCADE on delete when cascade = ALL', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "department_id")
    private Department department;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.foreignKeys[0].onDelete).toBe(FKAction.CASCADE)
  })

  it('sets CASCADE on delete when cascade = REMOVE', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne(cascade = CascadeType.REMOVE)
    @JoinColumn(name = "department_id")
    private Department department;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.foreignKeys[0].onDelete).toBe(FKAction.CASCADE)
  })
})

// ─── Relation parsing: @OneToOne ─────────────────────────────────────────────

describe('@OneToOne relations', () => {
  it('creates FK from @OneToOne + @JoinColumn', () => {
    const source = `
@Entity
public class UserProfile {
    @Id
    private Long id;

    @OneToOne
    @JoinColumn(name = "user_id")
    private User user;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.columns.has('user_id')).toBe(true)
    expect(result!.table.foreignKeys.length).toBe(1)
    expect(result!.table.foreignKeys[0].referencedTable).toBe('user')
  })
})

// ─── @OneToMany (inverse) ────────────────────────────────────────────────────

describe('@OneToMany (inverse side)', () => {
  it('skips @OneToMany(mappedBy = ...) fields', () => {
    const source = `
@Entity
public class Department {
    @Id
    private Long id;

    private String name;

    @OneToMany(mappedBy = "department")
    private List<Employee> employees;
}
`
    const result = parseJavaSource(source)
    // Should not create a column for the employees list
    expect(result!.table.columns.has('employees')).toBe(false)
    expect(result!.table.columns.size).toBe(2) // id + name
  })
})

// ─── @ManyToMany + @JoinTable ────────────────────────────────────────────────

describe('@ManyToMany relations', () => {
  it('creates a join table from @ManyToMany + @JoinTable', () => {
    const source = `
@Entity
@Table(name = "posts")
public class Post {
    @Id
    private Long id;

    @ManyToMany
    @JoinTable(
        name = "post_tags",
        joinColumns = @JoinColumn(name = "post_id"),
        inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    private Set<Tag> tags;
}
`
    const result = parseJavaSource(source)
    expect(result!.joinTables.length).toBe(1)

    const joinTable = result!.joinTables[0]
    expect(joinTable.name).toBe('post_tags')
    expect(joinTable.columns.has('post_id')).toBe(true)
    expect(joinTable.columns.has('tag_id')).toBe(true)
    expect(joinTable.foreignKeys.length).toBe(2)
    expect(joinTable.primaryKey!.columns).toEqual(['post_id', 'tag_id'])
  })

  it('skips @ManyToMany(mappedBy = ...)', () => {
    const source = `
@Entity
public class Tag {
    @Id
    private Long id;

    @ManyToMany(mappedBy = "tags")
    private Set<Post> posts;
}
`
    const result = parseJavaSource(source)
    expect(result!.joinTables.length).toBe(0)
  })

  it('defaults join table name when @JoinTable has no name', () => {
    const source = `
@Entity
@Table(name = "articles")
public class Article {
    @Id
    private Long id;

    @ManyToMany
    private Set<Tag> tags;
}
`
    const result = parseJavaSource(source)
    expect(result!.joinTables.length).toBe(1)
    expect(result!.joinTables[0].name).toBe('articles_tag')
  })

  it('join table FKs have CASCADE on delete', () => {
    const source = `
@Entity
@Table(name = "posts")
public class Post {
    @Id
    private Long id;

    @ManyToMany
    @JoinTable(
        name = "post_tags",
        joinColumns = @JoinColumn(name = "post_id"),
        inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    private Set<Tag> tags;
}
`
    const result = parseJavaSource(source)
    const joinTable = result!.joinTables[0]
    for (const fk of joinTable.foreignKeys) {
      expect(fk.onDelete).toBe(FKAction.CASCADE)
    }
  })
})

// ─── Realistic multi-entity schema ──────────────────────────────────────────

describe('realistic multi-entity schema', () => {
  it('parses a complete User entity with all features', () => {
    const source = `
public enum UserRole { ADMIN, USER, EDITOR }

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;

    @Column(precision = 10, scale = 2)
    private BigDecimal salary;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "department_id", nullable = false)
    private Department department;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()
    const table = result!.table

    // Table metadata
    expect(table.name).toBe('users')
    expect(table.primaryKey!.columns).toEqual(['id'])

    // Columns
    expect(table.columns.size).toBe(7)

    // id column
    const idCol = col(result, 'id')
    expect(idCol.dataType).toBe(NormalizedType.BIGINT)
    expect(idCol.isAutoIncrement).toBe(true)
    expect(idCol.isNullable).toBe(false)

    // email column
    const emailCol = col(result, 'email')
    expect(emailCol.dataType).toBe(NormalizedType.VARCHAR)
    expect(emailCol.isNullable).toBe(false)
    expect(emailCol.maxLength).toBe(255)

    // salary column
    const salaryCol = col(result, 'salary')
    expect(salaryCol.dataType).toBe(NormalizedType.DECIMAL)
    expect(salaryCol.numericPrecision).toBe(10)
    expect(salaryCol.numericScale).toBe(2)

    // role column
    const roleCol = col(result, 'role')
    expect(roleCol.dataType).toBe(NormalizedType.ENUM)
    expect(roleCol.isNullable).toBe(false)
    expect(roleCol.enumValues).toEqual(['ADMIN', 'USER', 'EDITOR'])

    // department FK
    const deptCol = col(result, 'department_id')
    expect(deptCol.dataType).toBe(NormalizedType.BIGINT)
    expect(deptCol.isNullable).toBe(false)
    expect(table.foreignKeys.length).toBe(1)
    expect(table.foreignKeys[0].referencedTable).toBe('department')

    // timestamps
    const createdCol = col(result, 'created_at')
    expect(createdCol.isGenerated).toBe(true)
    expect(createdCol.dataType).toBe(NormalizedType.TIMESTAMPTZ)

    const updatedCol = col(result, 'updated_at')
    expect(updatedCol.isGenerated).toBe(true)

    // unique constraints
    expect(table.uniqueConstraints.length).toBe(1)
    expect(table.uniqueConstraints[0].columns).toEqual(['email'])

    // enums
    expect(result!.enums.length).toBe(1)
    expect(result!.enums[0].name).toBe('user_role')
  })

  it('handles entity with multiple relations', () => {
    const source = `
@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String orderNumber;

    @ManyToOne
    @JoinColumn(name = "customer_id", nullable = false)
    private Customer customer;

    @ManyToOne
    @JoinColumn(name = "shipping_address_id")
    private Address shippingAddress;

    @Column(precision = 12, scale = 2)
    private BigDecimal totalAmount;

    @CreationTimestamp
    private LocalDateTime orderDate;

    @OneToMany(mappedBy = "order")
    private List<OrderItem> items;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()
    const table = result!.table

    expect(table.name).toBe('orders')
    // Should have: id, order_number, customer_id, shipping_address_id, total_amount, order_date
    // Should NOT have: items (mappedBy inverse)
    expect(table.columns.size).toBe(6)
    expect(table.columns.has('items')).toBe(false)

    expect(table.foreignKeys.length).toBe(2)
    const customerFk = table.foreignKeys.find(fk => fk.columns[0] === 'customer_id')
    expect(customerFk).toBeDefined()
    expect(customerFk!.referencedTable).toBe('customer')

    const addressFk = table.foreignKeys.find(fk => fk.columns[0] === 'shipping_address_id')
    expect(addressFk).toBeDefined()
    expect(addressFk!.referencedTable).toBe('address')
  })

  it('handles entity with UUID primary key', () => {
    const source = `
@Entity
public class Document {
    @Id
    private UUID id;

    @Column(nullable = false)
    private String title;

    private Boolean isPublished;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()

    const idCol = col(result, 'id')
    expect(idCol.dataType).toBe(NormalizedType.UUID)

    const titleCol = col(result, 'title')
    expect(titleCol.isNullable).toBe(false)

    const pubCol = col(result, 'is_published')
    expect(pubCol.dataType).toBe(NormalizedType.BOOLEAN)
    expect(pubCol.isNullable).toBe(true)
  })

  it('handles entity with various numeric types', () => {
    const source = `
@Entity
public class Metrics {
    @Id
    private Long id;

    private Integer count;
    private Short priority;
    private Double ratio;
    private Float score;
    private BigDecimal amount;
}
`
    const result = parseJavaSource(source)
    expect(col(result, 'count').dataType).toBe(NormalizedType.INTEGER)
    expect(col(result, 'priority').dataType).toBe(NormalizedType.SMALLINT)
    expect(col(result, 'ratio').dataType).toBe(NormalizedType.DOUBLE)
    expect(col(result, 'score').dataType).toBe(NormalizedType.REAL)
    expect(col(result, 'amount').dataType).toBe(NormalizedType.DECIMAL)
  })

  it('handles entity with date/time types', () => {
    const source = `
@Entity
public class Event {
    @Id
    private Long id;

    private LocalDate eventDate;
    private LocalTime startTime;
    private LocalDateTime scheduledAt;
    private Instant createdInstant;
    private ZonedDateTime zonedTime;
}
`
    const result = parseJavaSource(source)
    expect(col(result, 'event_date').dataType).toBe(NormalizedType.DATE)
    expect(col(result, 'start_time').dataType).toBe(NormalizedType.TIME)
    expect(col(result, 'scheduled_at').dataType).toBe(NormalizedType.TIMESTAMPTZ)
    expect(col(result, 'created_instant').dataType).toBe(NormalizedType.TIMESTAMPTZ)
    expect(col(result, 'zoned_time').dataType).toBe(NormalizedType.TIMESTAMPTZ)
  })

  it('sets schema name from options', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source, { schemaName: 'myschema' })
    expect(result!.table.schema).toBe('myschema')
  })

  it('defaults schema name to public', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result!.table.schema).toBe('public')
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles entity with no fields besides @Id', () => {
    const source = `
@Entity
public class EmptyEntity {
    @Id
    private Long id;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()
    expect(result!.table.columns.size).toBe(1)
  })

  it('handles class without public modifier', () => {
    const source = `
@Entity
class InternalEntity {
    @Id
    private Long id;

    private String name;
}
`
    const result = parseJavaSource(source)
    expect(result).not.toBeNull()
    expect(result!.table.name).toBe('internal_entity')
  })

  it('handles @JoinColumn with referencedColumnName', () => {
    const source = `
@Entity
public class Employee {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "dept_code", referencedColumnName = "code")
    private Department department;
}
`
    const result = parseJavaSource(source)
    const fk = result!.table.foreignKeys[0]
    expect(fk.referencedColumns).toEqual(['code'])
  })

  it('handles primitive types (int, long, etc.)', () => {
    const source = `
@Entity
public class Stats {
    @Id
    private long id;

    private int viewCount;
    private short rating;
    private double average;
    private float percentage;
    private boolean active;
}
`
    const result = parseJavaSource(source)
    expect(col(result, 'id').dataType).toBe(NormalizedType.BIGINT)
    expect(col(result, 'view_count').dataType).toBe(NormalizedType.INTEGER)
    expect(col(result, 'rating').dataType).toBe(NormalizedType.SMALLINT)
    expect(col(result, 'average').dataType).toBe(NormalizedType.DOUBLE)
    expect(col(result, 'percentage').dataType).toBe(NormalizedType.REAL)
    expect(col(result, 'active').dataType).toBe(NormalizedType.BOOLEAN)
  })

  it('uses provided enum map for resolution', () => {
    const source = `
@Entity
public class User {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private Permission permission;
}
`
    const enumMap = new Map([
      ['Permission', { name: 'Permission', values: ['READ', 'WRITE', 'ADMIN'] }],
    ])
    const result = parseJavaSource(source, {}, enumMap)
    const permCol = col(result, 'permission')
    expect(permCol.enumValues).toEqual(['READ', 'WRITE', 'ADMIN'])
  })
})
