// ============================================================================
// GET /api/digest — Query pending drafts, group by contentItemId, enrich
// with ContentItem + HotTake data, return paginated ApprovalDigest[]
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

const DEFAULT_PAGE_SIZE = 30;

/**
 * Fetch all pending drafts from DynamoDB, group by contentItemId,
 * enrich each group with the parent ContentItem and HotTake,
 * and return a paginated slice.
 */
export async function handleGetDigest(
  db: DynamoDBClientWrapper,
  queryString?: string,
): Promise<{ statusCode: number; body: string }> {
  try {
    // Parse pagination params from query string
    const params: Record<string, string> = {};
    if (queryString) {
      for (const pair of queryString.split('&')) {
        const [key, value] = pair.split('=');
        if (key && value) {
          params[key] = decodeURIComponent(value);
        }
      }
    }
    const page = Math.max(1, parseInt(params['page'] ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params['limit'] ?? String(DEFAULT_PAGE_SIZE), 10)));

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
        body: JSON.stringify({ items: [], total: 0, page, limit }),
      };
    }

    // Group drafts by contentItemId
    const groupedByContent = new Map<string, DraftContent[]>();
    for (const draft of pendingDrafts) {
      const existing = groupedByContent.get(draft.contentItemId) ?? [];
      existing.push(draft as DraftContent);
      groupedByContent.set(draft.contentItemId, existing);
    }

    // Collect all unique IDs for batch lookup
    const contentItemIds = [...groupedByContent.keys()];
    const hotTakeIds = [...new Set(pendingDrafts.map((d) => d.hotTakeId).filter(Boolean))];

    // Batch get all ContentItems and HotTakes in parallel
    const [contentItemResults, hotTakeResults] = await Promise.all([
      contentItemIds.length > 0
        ? db.batchGet<ContentItem & Record<string, unknown>>(
            TABLE_NAMES.contentItems,
            contentItemIds.map((id) => ({ id })),
          )
        : [],
      hotTakeIds.length > 0
        ? db.batchGet<HotTake & Record<string, unknown>>(
            TABLE_NAMES.hotTakes,
            hotTakeIds.map((id) => ({ id })),
          )
        : [],
    ]);

    // Build lookup maps for O(1) access
    const contentItemMap = new Map<string, ContentItem>();
    for (const item of contentItemResults) {
      if (item) {
        contentItemMap.set(item.id, item as ContentItem);
      }
    }

    const hotTakeMap = new Map<string, HotTake>();
    for (const item of hotTakeResults) {
      if (item) {
        hotTakeMap.set(item.id, item as HotTake);
      }
    }

    // Build digest entries using the lookup maps
    const allDigests: ApprovalDigest[] = [];

    for (const [contentItemId, drafts] of groupedByContent) {
      const contentItem = contentItemMap.get(contentItemId);

      if (!contentItem) {
        logger.warn('ContentItem not found for pending draft', { contentItemId });
        continue;
      }

      const hotTakeId = drafts[0]?.hotTakeId;
      if (!hotTakeId) {
        logger.warn('Draft missing hotTakeId', { contentItemId });
        continue;
      }

      const hotTake = hotTakeMap.get(hotTakeId);

      if (!hotTake) {
        logger.warn('HotTake not found for pending draft', { hotTakeId, contentItemId });
        continue;
      }

      allDigests.push({
        contentItem,
        hotTake,
        drafts,
      });
    }

    const sortDirection = params['sort'] === 'asc' ? 'asc' : 'desc';

    // Sort by ingestedAt before paginating
    allDigests.sort((a, b) => {
      const timeA = new Date(a.contentItem.ingestedAt).getTime();
      const timeB = new Date(b.contentItem.ingestedAt).getTime();
      return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
    });

    // Paginate
    const total = allDigests.length;
    const startIndex = (page - 1) * limit;
    const paginatedDigests = allDigests.slice(startIndex, startIndex + limit);

    logger.info('Digest compiled', { total, page, limit, returned: paginatedDigests.length });

    return {
      statusCode: 200,
      body: JSON.stringify({
        items: paginatedDigests,
        total,
        page,
        limit,
      }),
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
