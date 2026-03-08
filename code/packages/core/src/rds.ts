// ============================================================================
// RDS Client Wrapper — PostgreSQL via pg.Pool (Phase 8)
//
// Provides a connection-pooled PostgreSQL client for the Insight Engine.
// Connection string is loaded from SSM Parameter Store at runtime.
// ============================================================================

import pg from 'pg';
import { createLogger } from './logger.js';

const { Pool } = pg;

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
 * Creates a real PostgreSQL RDS client backed by pg.Pool.
 */
export function createRdsClient(config: RdsConfig): IRdsClient {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5000,
    ssl: {
      rejectUnauthorized: false, // Required for publicly accessible RDS
    },
  });

  pool.on('error', (err: Error) => {
    logger.error('Unexpected pool error', {
      error: err.message,
    });
  });

  return {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      try {
        const result = await pool.query(sql, params);
        return {
          rows: result.rows as T[],
          rowCount: result.rowCount ?? 0,
        };
      } catch (error: unknown) {
        logger.error('RDS query failed', {
          sql: sql.substring(0, 200),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1');
          return true;
        } finally {
          client.release();
        }
      } catch (error: unknown) {
        logger.warn('RDS health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },

    async disconnect(): Promise<void> {
      try {
        await pool.end();
        logger.info('RDS connection pool closed');
      } catch (error: unknown) {
        logger.error('Failed to close RDS pool', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
