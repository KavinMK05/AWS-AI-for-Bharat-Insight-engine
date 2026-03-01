// ============================================================================
// Deduplication — Checks DynamoDB ContentItems GSI on sourceUrl to prevent
// storing duplicate content items.
// ============================================================================

import type { DynamoDBClientWrapper } from '@insight-engine/core';
import { TABLE_NAMES, createLogger } from '@insight-engine/core';

const logger = createLogger('Watchtower');

/**
 * Check whether a content item with the given sourceUrl already exists
 * in the DynamoDB ContentItems table.
 *
 * Uses the `sourceUrl-index` GSI to perform the lookup efficiently.
 *
 * @returns `true` if a duplicate exists, `false` otherwise.
 */
export async function checkDuplicate(
  db: DynamoDBClientWrapper,
  sourceUrl: string,
): Promise<boolean> {
  try {
    const existing = await db.queryByIndex<Record<string, unknown>>(
      TABLE_NAMES.contentItems,
      'sourceUrl-index',
      'sourceUrl = :url',
      { ':url': sourceUrl },
    );

    if (existing.length > 0) {
      logger.debug('Duplicate detected', {
        sourceUrl,
        existingId: existing[0]?.['id'] as string,
      });
      return true;
    }

    return false;
  } catch (error: unknown) {
    logger.error('Deduplication check failed', {
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    // On dedup check failure, assume not duplicate — safer to ingest
    // a potential duplicate than to silently drop unique content
    return false;
  }
}
