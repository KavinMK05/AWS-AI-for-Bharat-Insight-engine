// ============================================================================
// GET /api/history — Searchable publishing history (Phase 8)
//
// Queries RDS PostgreSQL for published content with full-text search,
// platform filtering, and date range support. Returns paginated results.
// ============================================================================

import { createLogger } from '@insight-engine/core';
import type { IRdsClient, HistoryResult, HistoryItem, Platform } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

/**
 * Parse query string into a key-value map.
 */
function parseQueryString(rawQueryString: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!rawQueryString) return params;

  for (const pair of rawQueryString.split('&')) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return params;
}

/**
 * Handle GET /api/history — search and filter published content history.
 */
export async function handleGetHistory(
  rdsClient: IRdsClient,
  rawQueryString: string,
): Promise<{ statusCode: number; body: string }> {
  const params = parseQueryString(rawQueryString);

  const topic = params['topic'] || undefined;
  const platform = (params['platform'] as Platform) || undefined;
  const from = params['from'] || undefined;
  const to = params['to'] || undefined;
  const page = Math.max(1, parseInt(params['page'] ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(params['limit'] ?? '20', 10)));
  const offset = (page - 1) * limit;

  // Validate platform if provided
  if (platform && platform !== 'twitter' && platform !== 'linkedin') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid platform. Must be "twitter" or "linkedin".' }),
    };
  }

  try {
    // Build the query dynamically
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (topic) {
      conditions.push(`ci.fts_vector @@ plainto_tsquery('english', $${paramIndex})`);
      queryParams.push(topic);
      paramIndex++;
    }

    if (platform) {
      conditions.push(`pp.platform = $${paramIndex}`);
      queryParams.push(platform);
      paramIndex++;
    }

    if (from) {
      conditions.push(`pp.published_at >= $${paramIndex}::timestamptz`);
      queryParams.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`pp.published_at <= $${paramIndex}::timestamptz`);
      queryParams.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total results
    const countResult = await rdsClient.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM published_posts pp
       LEFT JOIN content_items ci ON pp.content_item_id = ci.id
       ${whereClause}`,
      queryParams,
    );

    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    // Fetch paginated results - need to add LIMIT and OFFSET params
    const dataParams = [...queryParams, limit, offset];
    const limitParamIndex = queryParams.length + 1;
    const offsetParamIndex = queryParams.length + 2;
    const dataResult = await rdsClient.query<{
      id: string;
      title: string;
      platform: Platform;
      platform_url: string;
      published_at: string;
      content_item_id: string;
      content_snippet: string;
    }>(
      `SELECT
         pp.id,
         COALESCE(ci.title, '') as title,
         pp.platform,
         COALESCE(pp.platform_url, '') as platform_url,
         pp.published_at,
         COALESCE(pp.content_item_id, '') as content_item_id,
         COALESCE(pp.content_snippet, '') as content_snippet
       FROM published_posts pp
       LEFT JOIN content_items ci ON pp.content_item_id = ci.id
       ${whereClause}
       ORDER BY pp.published_at DESC
       LIMIT ${limitParamIndex} OFFSET ${offsetParamIndex}`,
      dataParams,
    );

    const results: HistoryItem[] = dataResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      platform: row.platform,
      platformUrl: row.platform_url,
      publishedAt: row.published_at,
      contentItemId: row.content_item_id,
      contentSnippet: row.content_snippet,
    }));

    const response: HistoryResult = { total, page, results };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    logger.error('Failed to query history', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to query publishing history' }),
    };
  }
}
