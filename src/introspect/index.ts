export { introspect } from './introspect.js'
export { connect, disconnect, type ConnectOptions } from './connection.js'
export { isProductionHost, confirmProductionAccess, extractHostFromConnectionString } from './safety.js'
export { mapNativeType, isSerialType, isGeneratedColumn } from './type-map.js'
export { extractEnumLikeValues } from './queries/check-constraints.js'

// SQLite support
export {
  connectSqlite,
  disconnectSqlite,
  isSqliteConnection,
  extractSqlitePath,
  introspectSqlite,
  mapSqliteType,
  isSqliteAutoIncrement,
} from './sqlite/index.js'
export type { SqliteDatabase } from './sqlite/index.js'
