// ============================================================================
// Trend Detection — 48-hour topic clustering via keyword overlap
// Identifies trending topics when 3+ recent items share significant overlap.
// ============================================================================

import { createLogger, DynamoDBClientWrapper, TABLE_NAMES } from '@insight-engine/core';
import type { ContentItem } from '@insight-engine/core';

const logger = createLogger('Analyst');

/** Number of hours to look back for trending detection */
const TREND_WINDOW_HOURS = 48;

/** Minimum number of overlapping items (including the current one) to flag as trending */
const TREND_CLUSTER_THRESHOLD = 3;

/** Minimum Jaccard similarity to consider two items as topically related */
const SIMILARITY_THRESHOLD = 0.2;

/** Common stop words to exclude from keyword extraction */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'as', 'was', 'are',
  'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
  'these', 'those', 'not', 'no', 'nor', 'so', 'if', 'then', 'than',
  'too', 'very', 'just', 'about', 'above', 'after', 'again', 'all',
  'also', 'am', 'any', 'because', 'before', 'below', 'between', 'both',
  'each', 'few', 'more', 'most', 'other', 'our', 'out', 'own', 'same',
  'she', 'he', 'her', 'him', 'his', 'how', 'i', 'into', 'me', 'my',
  'new', 'now', 'off', 'only', 'over', 'such', 'up', 'us', 'we',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'you', 'your', 'using', 'via', 'based', 'through',
]);

/**
 * Extract significant keywords from a text string.
 * Filters out stop words and short tokens; lowercases everything.
 */
export function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(words);
}

/**
 * Compute the Jaccard similarity coefficient between two sets.
 * Returns a value between 0 (no overlap) and 1 (identical sets).
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const item of smaller) {
    if (larger.has(item)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect whether the given ContentItem is part of a trending topic cluster.
 *
 * Queries DynamoDB for ContentItems ingested in the last 48 hours, extracts
 * keywords from titles, and checks if 3 or more recent items share significant
 * topic overlap (Jaccard similarity >= 0.2) with the current item.
 *
 * @returns `true` if 3+ recent items (including the current one) share a topic cluster
 */
export async function detectTrend(
  item: ContentItem,
  db: DynamoDBClientWrapper,
  tablePrefix: string,
): Promise<boolean> {
  try {
    const windowStart = new Date(
      Date.now() - TREND_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Query recent items using the ingestedAt GSI
    const recentItems = await db.queryByIndex<ContentItem & Record<string, unknown>>(
      TABLE_NAMES.contentItems,
      'ingestedAt-index',
      'ingestedAt >= :windowStart',
      { ':windowStart': windowStart },
    );

    if (recentItems.length === 0) {
      return false;
    }

    // Extract keywords from the current item (title + first 200 chars of text)
    const currentKeywords = extractKeywords(
      `${item.title} ${item.fullText.slice(0, 200)}`,
    );

    if (currentKeywords.size === 0) {
      return false;
    }

    // Count how many recent items have significant topic overlap
    let overlapCount = 0;

    for (const recentItem of recentItems) {
      // Skip the current item itself
      if (recentItem.id === item.id) continue;

      const recentKeywords = extractKeywords(
        `${recentItem.title} ${recentItem.fullText.slice(0, 200)}`,
      );

      const similarity = jaccardSimilarity(currentKeywords, recentKeywords);

      if (similarity >= SIMILARITY_THRESHOLD) {
        overlapCount++;
      }
    }

    // Include the current item itself in the cluster count
    // So if 2 other items overlap → cluster of 3 (including current) → trending
    const isTrending = overlapCount + 1 >= TREND_CLUSTER_THRESHOLD;

    if (isTrending) {
      logger.info('Trending topic detected', {
        contentItemId: item.id,
        title: item.title,
        overlappingItems: overlapCount,
        clusterSize: overlapCount + 1,
      });
    }

    return isTrending;
  } catch (error: unknown) {
    // Trend detection failure is non-critical — log and continue
    logger.warn('Trend detection failed — defaulting to not trending', {
      contentItemId: item.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
