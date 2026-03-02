// ============================================================================
// Ghostwriter Lambda Handler — SQS-triggered content generation pipeline
// Reads HotTake IDs from the generation-queue, generates platform-specific
// drafts (Twitter thread + LinkedIn post) via Bedrock, and persists them
// as DraftContent records in DynamoDB.
// ============================================================================

import { randomUUID } from 'node:crypto';

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  createLogger,
  createDynamoDBClient,
  DynamoDBClientWrapper,
  TABLE_NAMES,
  loadPersona,
} from '@insight-engine/core';
import type { ContentItem, PersonaFile, HotTake, DraftContent } from '@insight-engine/core';

import { generateTwitterThread } from './twitter-generator.js';
import { generateLinkedInPost } from './linkedin-generator.js';

const logger = createLogger('Ghostwriter');

// ---------------------------------------------------------------------------
// Types matching the AWS Lambda SQS event shape
// ---------------------------------------------------------------------------

interface SQSRecord {
  messageId: string;
  body: string;
  receiptHandle: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, unknown>;
  md5OfBody: string;
  eventSource: string;
  eventSourceARN: string;
  awsRegion: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSBatchItemFailure {
  itemIdentifier: string;
}

interface SQSBatchResponse {
  batchItemFailures: SQSBatchItemFailure[];
}

/** Shape of the SQS message body from Analyst */
interface GenerationMessage {
  hotTakeId: string;
}

// ---------------------------------------------------------------------------
// Cold-start initialisation — reused across warm invocations
// ---------------------------------------------------------------------------

const AWS_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

let bedrockClient: BedrockRuntimeClient | undefined;
let dbWrapper: DynamoDBClientWrapper | undefined;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
  }
  return bedrockClient;
}

function getDBWrapper(): DynamoDBClientWrapper {
  if (!dbWrapper) {
    const tablePrefix = process.env['TABLE_PREFIX'] ?? 'dev-';
    const docClient = createDynamoDBClient(AWS_REGION);
    dbWrapper = new DynamoDBClientWrapper(docClient, tablePrefix);
  }
  return dbWrapper;
}

// ---------------------------------------------------------------------------
// Helper: require env var or throw
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * SQS-triggered Lambda handler for the Ghostwriter.
 *
 * For each SQS record (batch size 1 recommended for predictable error handling):
 * 1. Parse the hotTakeId from the message body
 * 2. Fetch the HotTake from DynamoDB
 * 3. Fetch the parent ContentItem from DynamoDB
 * 4. Load the PersonaFile from S3
 * 5. Generate Twitter thread and LinkedIn post via Bedrock
 * 6. Store DraftContent records in DynamoDB with status 'pending_approval'
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const personaBucket = requireEnv('PERSONA_FILES_BUCKET');

  const db = getDBWrapper();
  const bedrock = getBedrockClient();

  const batchItemFailures: SQSBatchItemFailure[] = [];

  // Load persona once for the entire batch
  let persona: PersonaFile;
  try {
    persona = await loadPersona('S3', 'persona.json', {
      bucketName: personaBucket,
    });
  } catch (error: unknown) {
    logger.error('Failed to load persona file — cannot process batch', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail all records so they return to the queue for retry
    return {
      batchItemFailures: event.Records.map((r) => ({
        itemIdentifier: r.messageId,
      })),
    };
  }

  for (const record of event.Records) {
    try {
      await processRecord(record, db, bedrock, persona);
    } catch (error: unknown) {
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

// ---------------------------------------------------------------------------
// Per-record processing
// ---------------------------------------------------------------------------

async function processRecord(
  record: SQSRecord,
  db: DynamoDBClientWrapper,
  bedrock: BedrockRuntimeClient,
  persona: PersonaFile,
): Promise<void> {
  // 1. Parse message body
  const message: GenerationMessage = JSON.parse(record.body) as GenerationMessage;
  const { hotTakeId } = message;

  if (!hotTakeId) {
    logger.warn('SQS message missing hotTakeId', { body: record.body });
    return; // Drop the message — no point retrying
  }

  logger.info('Processing hot take for content generation', { hotTakeId });

  // 2. Fetch HotTake from DynamoDB
  const hotTake = await db.getItem<HotTake & Record<string, unknown>>(
    TABLE_NAMES.hotTakes,
    { id: hotTakeId },
  );

  if (!hotTake) {
    logger.warn('HotTake not found in DynamoDB', { hotTakeId });
    return; // Item was deleted — drop the message
  }

  // 3. Fetch parent ContentItem from DynamoDB
  const contentItem = await db.getItem<ContentItem & Record<string, unknown>>(
    TABLE_NAMES.contentItems,
    { id: hotTake.contentItemId },
  );

  if (!contentItem) {
    logger.warn('Parent ContentItem not found in DynamoDB', {
      hotTakeId,
      contentItemId: hotTake.contentItemId,
    });
    return; // Parent deleted — drop the message
  }

  const now = new Date().toISOString();
  let draftsCreated = 0;

  // 4. Generate Twitter thread
  try {
    const tweets = await generateTwitterThread(
      hotTake as HotTake,
      contentItem as ContentItem,
      persona,
      bedrock,
    );

    if (tweets.length > 0) {
      const twitterDraft: DraftContent = {
        id: randomUUID(),
        hotTakeId: hotTake.id,
        contentItemId: hotTake.contentItemId,
        platform: 'twitter',
        content: JSON.stringify(tweets),
        status: 'pending_approval',
        createdAt: now,
      };

      await db.putItem(
        TABLE_NAMES.draftContent,
        twitterDraft as unknown as Record<string, unknown>,
      );

      draftsCreated++;

      logger.info('Stored Twitter draft', {
        draftId: twitterDraft.id,
        hotTakeId,
        tweetCount: tweets.length,
      });
    } else {
      logger.warn('Twitter thread generation returned no tweets — skipping', {
        hotTakeId,
      });
    }
  } catch (error: unknown) {
    logger.error('Twitter draft generation failed — continuing with LinkedIn', {
      hotTakeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 5. Generate LinkedIn post
  try {
    const linkedInPost = await generateLinkedInPost(
      hotTake as HotTake,
      contentItem as ContentItem,
      persona,
      bedrock,
    );

    if (linkedInPost.length > 0) {
      const linkedInDraft: DraftContent = {
        id: randomUUID(),
        hotTakeId: hotTake.id,
        contentItemId: hotTake.contentItemId,
        platform: 'linkedin',
        content: JSON.stringify(linkedInPost),
        status: 'pending_approval',
        createdAt: now,
      };

      await db.putItem(
        TABLE_NAMES.draftContent,
        linkedInDraft as unknown as Record<string, unknown>,
      );

      draftsCreated++;

      logger.info('Stored LinkedIn draft', {
        draftId: linkedInDraft.id,
        hotTakeId,
        charCount: linkedInPost.length,
      });
    } else {
      logger.warn('LinkedIn post generation returned empty — skipping', {
        hotTakeId,
      });
    }
  } catch (error: unknown) {
    logger.error('LinkedIn draft generation failed', {
      hotTakeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Completed content generation for hot take', {
    hotTakeId,
    contentItemId: hotTake.contentItemId,
    draftsCreated,
  });
}
