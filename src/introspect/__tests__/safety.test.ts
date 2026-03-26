import { describe, it, expect } from 'vitest'
import { isProductionHost, extractHostFromConnectionString } from '../safety.js'

describe('isProductionHost', () => {
  const productionHosts = [
    'my-db.rds.amazonaws.com',
    'mydb.cloud.google.com',
    'mydb.cloudsql.google.com',
    'db-xyz.database.azure.com',
    'abc.supabase.co',
    'ep-cool-rain.neon.tech',
    'my-app.render.com',
    'db.elephantsql.com',
    'pg-123.aiven.io',
    'cluster.cockroachlabs.cloud',
    'db.digitalocean.com',
    'my-db.db.ondigitalocean.com',
  ]

  for (const host of productionHosts) {
    it(`detects ${host} as production`, () => {
      expect(isProductionHost(host)).toBe(true)
    })
  }

  const localHosts = [
    'localhost',
    '127.0.0.1',
    'db.local',
    'postgres',
    'my-custom-host.internal',
    '192.168.1.100',
    'dev-db.company.com',
  ]

  for (const host of localHosts) {
    it(`does NOT detect ${host} as production`, () => {
      expect(isProductionHost(host)).toBe(false)
    })
  }
})

describe('extractHostFromConnectionString', () => {
  it('extracts host from standard URL', () => {
    expect(extractHostFromConnectionString('postgres://user:pass@myhost:5432/db'))
      .toBe('myhost')
  })

  it('extracts host without port', () => {
    expect(extractHostFromConnectionString('postgres://user@myhost/db'))
      .toBe('myhost')
  })

  it('extracts cloud host', () => {
    expect(extractHostFromConnectionString('postgres://user:pass@my-db.rds.amazonaws.com:5432/db'))
      .toBe('my-db.rds.amazonaws.com')
  })

  it('returns null for malformed string', () => {
    expect(extractHostFromConnectionString('not-a-url')).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(extractHostFromConnectionString('')).toBe(null)
  })
})
