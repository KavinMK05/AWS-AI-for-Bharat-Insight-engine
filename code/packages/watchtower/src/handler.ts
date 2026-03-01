// ============================================================================
// Watchtower Lambda Handler — Content Ingestion Orchestrator
//
// Triggered by EventBridge on the configured monitoring_interval.
// Fetches content from RSS feeds and arXiv, deduplicates against DynamoDB,
// persists new ContentItem records, and enqueues IDs to SQS for the Analyst.
// ============================================================================

import { randomUUID } from 'node:crypto';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createDynamoDBClient,
  DynamoDBClientWrapper,
  TABLE_NAMES,
  loadPersona,
} from '@insight-engine/core';
import type { ContentItem, PersonaFile } from '@insight-engine/core';

import { fetchRssItems } from './rss-monitor.js';
import { fetchArxivItems } from './arxiv-monitor.js';
import { checkDuplicate } from './dedup.js';
import type { IngestionCandidate } from './rss-monitor.js';

const logger = createLogger('Watchtower');

// ---------------------------------------------------------------------------
// Cold-start initialisation (reused across warm invocations)
// ---------------------------------------------------------------------------

const region = process.env['AWS_REGION'] ?? 'ap-south-1';
const sqsClient = new SQSClient({ region });
const dynamoClient = createDynamoDBClient(region);

/**
 * Read a required env var or throw.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Parse a comma-separated env var into a trimmed string array.
 * Returns an empty array if the var is unset or empty.
 */
function parseCommaSeparated(name: string): string[] {
  const raw = process.env[name] ?? '';
  if (raw.trim() === '') return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Convert an IngestionCandidate into a full ContentItem ready for DynamoDB.
 */
function toContentItem(candidate: IngestionCandidate, isDuplicate: boolean): ContentItem {
  return {
    id: randomUUID(),
    title: candidate.title,
    author: candidate.author,
    publicationDate: candidate.publicationDate,
    sourceUrl: candidate.sourceUrl,
    fullText: candidate.fullText,
    source: candidate.source,
    ingestedAt: new Date().toISOString(),
    isDuplicate,
    status: 'ingested',
  };
}

/**
 * Store a ContentItem in DynamoDB and — if it is not a duplicate — publish
 * its ID to the SQS ingestion queue for the Analyst Lambda.
 */
async function persistAndEnqueue(
  db: DynamoDBClientWrapper,
  item: ContentItem,
  queueUrl: string,
): Promise<{ enqueued: boolean }> {
  // Store in DynamoDB
  await db.putItem(TABLE_NAMES.contentItems, item as unknown as Record<string, unknown>);

  // Only enqueue non-duplicates for downstream processing
  if (!item.isDuplicate) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ contentItemId: item.id }),
      }),
    );
    return { enqueued: true };
  }

  return { enqueued: false };
}

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

/**
 * EventBridge-triggered Lambda handler.
 *
 * Orchestrates content ingestion from all configured sources, deduplicates
 * each item against the DynamoDB ContentItems table, persists new items,
 * and enqueues non-duplicate IDs to SQS for the Analyst.
 */
export async function handler(): Promise<void> {
  const tablePrefix = requireEnv('TABLE_PREFIX');
  const ingestionQueueUrl = requireEnv('INGESTION_QUEUE_URL');
  const personaBucket = requireEnv('PERSONA_FILES_BUCKET');

  const db = new DynamoDBClientWrapper(dynamoClient, tablePrefix);

  // ── Load persona (for future use / logging context) ──────────────────
  let persona: PersonaFile | null = null;
  try {
    persona = await loadPersona('S3', 'persona.json', { bucketName: personaBucket });
    logger.info('Persona loaded', { tone: persona.tone, topics: persona.expertiseTopics.length });
  } catch (error: unknown) {
    logger.warn('Failed to load persona — continuing with env-var config only', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── Read source configuration from env vars ──────────────────────────
  const rssFeedUrls = parseCommaSeparated('RSS_FEED_URLS');
  const arxivCategories = parseCommaSeparated('ARXIV_CATEGORIES');
  const arxivMaxResults = parseInt(process.env['ARXIV_MAX_RESULTS'] ?? '10', 10);

  // ── Fetch from all sources ───────────────────────────────────────────
  const allCandidates: IngestionCandidate[] = [];

  // RSS feeds
  try {
    const rssItems = await fetchRssItems(rssFeedUrls);
    allCandidates.push(...rssItems);
    logger.info(`RSS ingestion complete: ${rssItems.length} items`);
  } catch (error: unknown) {
    logger.error('RSS source failed completely', {
      component: 'Watchtower',
      source: 'rss',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // arXiv
  try {
    const arxivItems = await fetchArxivItems(arxivCategories, arxivMaxResults);
    allCandidates.push(...arxivItems);
    logger.info(`arXiv ingestion complete: ${arxivItems.length} items`);
  } catch (error: unknown) {
    logger.error('arXiv source failed completely', {
      component: 'Watchtower',
      source: 'arxiv',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── Dedup, persist, and enqueue ──────────────────────────────────────
  let itemsIngested = 0;
  let duplicatesSkipped = 0;
  let errors = 0;

  for (const candidate of allCandidates) {
    try {
      const isDuplicate = await checkDuplicate(db, candidate.sourceUrl);

      const contentItem = toContentItem(candidate, isDuplicate);
      const { enqueued } = await persistAndEnqueue(db, contentItem, ingestionQueueUrl);

      if (isDuplicate) {
        duplicatesSkipped++;
        logger.debug('Duplicate item stored but not enqueued', {
          sourceUrl: candidate.sourceUrl,
          id: contentItem.id,
        });
      } else {
        itemsIngested++;
        logger.debug('New item ingested and enqueued', {
          sourceUrl: candidate.sourceUrl,
          id: contentItem.id,
          enqueued,
        });
      }
    } catch (error: unknown) {
      errors++;
      logger.error('Failed to process candidate item', {
        sourceUrl: candidate.sourceUrl,
        source: candidate.source,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue processing remaining items
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  logger.info('Watchtower ingestion run complete', {
    totalCandidates: allCandidates.length,
    itemsIngested,
    duplicatesSkipped,
    errors,
    sources: {
      rss: rssFeedUrls.length,
      arxiv: arxivCategories.length,
    },
    personaLoaded: persona !== null,
  });
}
