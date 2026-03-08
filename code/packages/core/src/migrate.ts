// ============================================================================
// Migration Runner — executes SQL migrations against RDS PostgreSQL (Phase 8)
//
// Reads .sql files from the migrations directory and applies them in order.
// Tracks applied migrations in a schema_migrations table.
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.js';
import type { IRdsClient } from './rds.js';

const logger = createLogger('Migrate');

/**
 * Run all pending SQL migrations against the database.
 *
 * Migrations are .sql files in the `migrations/` directory, sorted by filename.
 * Each migration is applied in a transaction. Already-applied migrations are skipped.
 */
export async function runMigrations(rdsClient: IRdsClient): Promise<void> {
  const migrationsDir = join(__dirname, 'migrations');

  // Ensure schema_migrations table exists
  await rdsClient.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already applied migrations
  const applied = await rdsClient.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedSet = new Set(applied.rows.map((r) => r.version));

  // Read migration files
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    logger.warn('No migrations directory found — skipping migrations');
    return;
  }

  let appliedCount = 0;

  for (const file of files) {
    const version = file.replace('.sql', '');

    if (appliedSet.has(version)) {
      logger.debug(`Migration ${version} already applied — skipping`);
      continue;
    }

    logger.info(`Applying migration: ${version}`);

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    try {
      await rdsClient.query('BEGIN');
      await rdsClient.query(sql);
      await rdsClient.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await rdsClient.query('COMMIT');
      appliedCount++;
      logger.info(`Migration ${version} applied successfully`);
    } catch (error: unknown) {
      await rdsClient.query('ROLLBACK');
      logger.error(`Migration ${version} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.info(`Migrations complete: ${appliedCount} applied, ${files.length} total`);
}
