// ============================================================================
// GET /api/digest — Query pending drafts, group by contentItemId, enrich
// with ContentItem + HotTake data, return ApprovalDigest[]
// ============================================================================

import type { DynamoDBClientWrapper } from '@insight-engine/core';
import type {
  ApprovalDigest,
  ContentItem,
  DraftContent,
  HotTake,
} from '@insight-engine/core';
import { TABLE_NAMES, createLogger } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

/**
 * Fetch all pending drafts from DynamoDB, group by contentItemId,
 * and enrich each group with the parent ContentItem and HotTake.
 */
export async function handleGetDigest(
  db: DynamoDBClientWrapper,
): Promise<{ statusCode: number; body: string }> {
  try {
    // Query DraftContent GSI for all items with status = 'pending_approval'
    const pendingDrafts = await db.queryByIndex<DraftContent & Record<string, unknown>>(
      TABLE_NAMES.draftContent,
      'status-createdAt-index',
      '#status = :status',
      { ':status': 'pending_approval' },
      { '#status': 'status' },
    );

    if (pendingDrafts.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify([]),
      };
    }

    // Group drafts by contentItemId
    const groupedByContent = new Map<string, DraftContent[]>();
    for (const draft of pendingDrafts) {
      const existing = groupedByContent.get(draft.contentItemId) ?? [];
      existing.push(draft as DraftContent);
      groupedByContent.set(draft.contentItemId, existing);
    }

    // Fetch all unique ContentItems and HotTakes
    const digests: ApprovalDigest[] = [];

    for (const [contentItemId, drafts] of groupedByContent) {
      const contentItem = await db.getItem<ContentItem & Record<string, unknown>>(
        TABLE_NAMES.contentItems,
        { id: contentItemId },
      );

      if (!contentItem) {
        logger.warn('ContentItem not found for pending draft', { contentItemId });
        continue;
      }

      // All drafts in a group reference the same hotTakeId
      const hotTakeId = drafts[0]?.hotTakeId;
      if (!hotTakeId) {
        logger.warn('Draft missing hotTakeId', { contentItemId });
        continue;
      }

      const hotTake = await db.getItem<HotTake & Record<string, unknown>>(
        TABLE_NAMES.hotTakes,
        { id: hotTakeId },
      );

      if (!hotTake) {
        logger.warn('HotTake not found for pending draft', { hotTakeId, contentItemId });
        continue;
      }

      digests.push({
        contentItem: contentItem as ContentItem,
        hotTake: hotTake as HotTake,
        drafts,
      });
    }

    logger.info('Digest compiled', { itemCount: digests.length });

    return {
      statusCode: 200,
      body: JSON.stringify(digests),
    };
  } catch (error: unknown) {
    logger.error('Failed to compile digest', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to compile digest' }),
    };
  }
}
