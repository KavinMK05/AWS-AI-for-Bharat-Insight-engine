// ============================================================================
// Sync Lambda Handler — DynamoDB Streams → RDS PostgreSQL (Phase 8)
//
// Triggered by DynamoDB Streams on ContentItems and DraftContent tables.
// Upserts records into the corresponding RDS PostgreSQL tables and updates
// the full-text search vector for content_items.
// ============================================================================

import {
  createLogger,
  createRdsClient,
  runMigrations,
} from '@insight-engine/core';
import type { IRdsClient } from '@insight-engine/core';

const logger = createLogger('Sync');

// ---------------------------------------------------------------------------
// Cold-start initialisation
// ---------------------------------------------------------------------------

let rdsClient: IRdsClient | null = null;
let migrationsRun = false;

function getRdsClient(): IRdsClient {
  if (!rdsClient) {
    const connectionString = process.env['RDS_CONNECTION_STRING'];
    if (!connectionString) {
      throw new Error('Missing required env var: RDS_CONNECTION_STRING');
    }
    rdsClient = createRdsClient({ connectionString });
  }
  return rdsClient;
}

// ---------------------------------------------------------------------------
// DynamoDB Streams event types
// ---------------------------------------------------------------------------

interface DynamoDBStreamImage {
  [key: string]: { S?: string; N?: string; BOOL?: boolean; NULL?: boolean };
}

interface DynamoDBStreamRecord {
  eventID: string;
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  eventSourceARN: string;
  dynamodb: {
    Keys: DynamoDBStreamImage;
    NewImage?: DynamoDBStreamImage;
    OldImage?: DynamoDBStreamImage;
  };
}

interface DynamoDBStreamEvent {
  Records: DynamoDBStreamRecord[];
}

/**
 * Extract a plain string value from a DynamoDB Stream image attribute.
 */
function attr(image: DynamoDBStreamImage, key: string): string | null {
  const val = image[key];
  if (!val) return null;
  if (val.S !== undefined) return val.S;
  if (val.N !== undefined) return val.N;
  if (val.BOOL !== undefined) return String(val.BOOL);
  return null;
}

/**
 * Determine the source table from the event source ARN.
 */
function getTableType(arn: string): 'ContentItems' | 'DraftContent' | 'unknown' {
  if (arn.includes('ContentItems')) return 'ContentItems';
  if (arn.includes('DraftContent')) return 'DraftContent';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Upsert handlers
// ---------------------------------------------------------------------------

async function upsertContentItem(
  rds: IRdsClient,
  image: DynamoDBStreamImage,
): Promise<void> {
  const id = attr(image, 'id');
  if (!id) return;

  await rds.query(
    `INSERT INTO content_items (id, title, source_url, ingested_at, relevance_score, is_duplicate, full_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       source_url = EXCLUDED.source_url,
       ingested_at = EXCLUDED.ingested_at,
       relevance_score = EXCLUDED.relevance_score,
       is_duplicate = EXCLUDED.is_duplicate,
       full_text = EXCLUDED.full_text`,
    [
      id,
      attr(image, 'title'),
      attr(image, 'sourceUrl'),
      attr(image, 'ingestedAt'),
      attr(image, 'relevanceScore') ? parseInt(attr(image, 'relevanceScore')!, 10) : null,
      attr(image, 'isDuplicate') === 'true',
      attr(image, 'fullText'),
    ],
  );
}

async function upsertDraftContent(
  rds: IRdsClient,
  image: DynamoDBStreamImage,
): Promise<void> {
  const id = attr(image, 'id');
  if (!id) return;

  // First ensure the hot_take record exists (upsert a placeholder if needed)
  const hotTakeId = attr(image, 'hotTakeId');
  if (hotTakeId) {
    await rds.query(
      `INSERT INTO hot_takes (id, content_item_id, text, word_count, variation_index, created_at)
       VALUES ($1, '', '', 0, 0, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [hotTakeId],
    );
  }

  await rds.query(
    `INSERT INTO draft_content (id, hot_take_id, platform, status, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       platform = EXCLUDED.platform,
       status = EXCLUDED.status`,
    [
      id,
      hotTakeId,
      attr(image, 'platform'),
      attr(image, 'status'),
      attr(image, 'createdAt'),
    ],
  );
}

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const rds = getRdsClient();

  // Run migrations once per cold start
  if (!migrationsRun) {
    try {
      await runMigrations(rds);
      migrationsRun = true;
    } catch (error: unknown) {
      logger.error('Migration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue processing — migrations may have already been applied
      migrationsRun = true;
    }
  }

  let processed = 0;
  let errors = 0;

  for (const record of event.Records) {
    if (record.eventName === 'REMOVE') {
      continue; // We don't sync deletes
    }

    const newImage = record.dynamodb.NewImage;
    if (!newImage) {
      continue;
    }

    const tableType = getTableType(record.eventSourceARN);

    try {
      switch (tableType) {
        case 'ContentItems':
          await upsertContentItem(rds, newImage);
          break;
        case 'DraftContent':
          await upsertDraftContent(rds, newImage);
          break;
        default:
          logger.warn('Unknown table source', { arn: record.eventSourceARN });
          continue;
      }
      processed++;
    } catch (error: unknown) {
      errors++;
      logger.error('Failed to sync record', {
        eventId: record.eventID,
        eventName: record.eventName,
        table: tableType,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw — prevents infinite retry loops for bad records
    }
  }

  logger.info('Sync batch complete', {
    totalRecords: event.Records.length,
    processed,
    errors,
  });
}
