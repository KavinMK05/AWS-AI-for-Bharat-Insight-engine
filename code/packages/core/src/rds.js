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
export function createRdsClient(_config) {
    return {
        async query() {
            logger.warn('RDS client is not implemented — RDS is disabled in Phase 1');
            return { rows: [], rowCount: 0 };
        },
        async healthCheck() {
            logger.warn('RDS health check skipped — RDS is disabled in Phase 1');
            return false;
        },
        async disconnect() {
            // No-op in stub
        },
    };
}
//# sourceMappingURL=rds.js.map