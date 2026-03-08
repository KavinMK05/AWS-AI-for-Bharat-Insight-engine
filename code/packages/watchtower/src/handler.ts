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
  createRdsClient,
  generateEmbedding,
  checkSemanticDuplicate,
  storeEmbedding,
} from '@insight-engine/core';
import type { ContentItem, PersonaFile, IRdsClient } from '@insight-engine/core';

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

// RDS client — only initialised if RDS_CONNECTION_STRING is set (Phase 8)
let rdsClient: IRdsClient | null = null;
function getRdsClient(): IRdsClient | null {
  if (rdsClient) return rdsClient;
  const connStr = process.env['RDS_CONNECTION_STRING'];
  if (!connStr) return null;
  rdsClient = createRdsClient({ connectionString: connStr });
  return rdsClient;
}

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
  const rds = getRdsClient();

  if (rds) {
    logger.info('RDS available — semantic duplicate detection enabled');
  }

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

  // ── Read source configuration from persona with env var fallback ──────
  const rssFeedUrls = persona?.rssFeedUrls?.length
    ? persona.rssFeedUrls
    : parseCommaSeparated('RSS_FEED_URLS');

  const arxivCategories = persona?.arxivCategories?.length
    ? persona.arxivCategories
    : parseCommaSeparated('ARXIV_CATEGORIES');

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
  let semanticDuplicates = 0;
  let errors = 0;

  for (const candidate of allCandidates) {
    try {
      // 1. URL-based dedup (DynamoDB GSI)
      let isDuplicate = await checkDuplicate(db, candidate.sourceUrl);

      // 2. Semantic dedup (RDS + Bedrock Titan) — only if not a URL duplicate
      if (!isDuplicate && rds) {
        try {
          const textForEmbedding = `${candidate.title} ${candidate.fullText}`;
          const embedding = await generateEmbedding(textForEmbedding, region);

          const semanticResult = await checkSemanticDuplicate(embedding, rds);
          if (semanticResult.isDuplicate) {
            isDuplicate = true;
            semanticDuplicates++;
            logger.info('Semantic duplicate detected', {
              sourceUrl: candidate.sourceUrl,
              matchingContentItemId: semanticResult.matchingContentItemId,
              similarityScore: semanticResult.similarityScore?.toFixed(4),
            });
          }

          // Store embedding regardless of duplicate status (for future checks)
          const contentId = randomUUID();
          await storeEmbedding(rds, contentId, embedding);
        } catch (embeddingError: unknown) {
          logger.warn('Semantic dedup check failed — continuing with URL dedup only', {
            sourceUrl: candidate.sourceUrl,
            error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
          });
        }
      }

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
    semanticDuplicates,
    errors,
    sources: {
      rss: rssFeedUrls.length,
      arxiv: arxivCategories.length,
    },
    personaLoaded: persona !== null,
    rdsEnabled: rds !== null,
  });
}
