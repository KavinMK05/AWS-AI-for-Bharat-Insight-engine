// ============================================================================
// RDS Client Wrapper — Scaffold Only (Phase 1)
//
// This module provides the interface and types for the RDS (PostgreSQL) client.
// The actual implementation using `pg` and `pg-pool` is deferred to Phase 8
// when `enable_rds` is turned on in Terraform.
//
// The `pg` and `pg-pool` packages are NOT installed in Phase 1 to keep
// dependencies minimal.
// ============================================================================

import { createLogger } from './logger.js';

const logger = createLogger('RDS');

/**
 * RDS connection configuration.
 * Connection string is loaded from SSM Parameter Store at runtime.
 */
export interface RdsConfig {
  /** PostgreSQL connection string from SSM */
  connectionString: string;
  /** Maximum number of connections in the pool */
  maxConnections?: number;
  /** Idle timeout in milliseconds */
  idleTimeoutMs?: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;
}

/**
 * Result of a database query.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * Interface for the RDS client.
 * Implemented in Phase 8 when RDS is enabled.
 */
export interface IRdsClient {
  /** Execute a parameterized SQL query */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Check if the database connection is healthy */
  healthCheck(): Promise<boolean>;
  /** Close all connections in the pool */
  disconnect(): Promise<void>;
}

/**
 * Stub RDS client that logs warnings when called.
 * Used in Phase 1 when RDS is disabled.
 *
 * Replace with real implementation in Phase 8:
 * ```ts
 * import { Pool } from 'pg';
 *
 * export function createRdsClient(config: RdsConfig): IRdsClient {
 *   const pool = new Pool({
 *     connectionString: config.connectionString,
 *     max: config.maxConnections ?? 10,
 *     idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
 *     connectionTimeoutMillis: config.connectionTimeoutMs ?? 5000,
 *   });
 *   // ... implement query, healthCheck, disconnect
 * }
 * ```
 */
export function createRdsClient(_config?: RdsConfig): IRdsClient {
  return {
    async query<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
      logger.warn('RDS client is not implemented — RDS is disabled in Phase 1');
      return { rows: [], rowCount: 0 };
    },

    async healthCheck(): Promise<boolean> {
      logger.warn('RDS health check skipped — RDS is disabled in Phase 1');
      return false;
    },

    async disconnect(): Promise<void> {
      // No-op in stub
    },
  };
}
