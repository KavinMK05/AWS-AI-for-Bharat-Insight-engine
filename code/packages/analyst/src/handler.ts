// ============================================================================
// Analyst Lambda Handler — SQS-triggered scoring & hot take pipeline
// Reads ContentItem IDs from the ingestion-queue, scores them against the
// persona, generates hot takes for high-scoring items, and publishes to
// the generation-queue for the Ghostwriter.
// ============================================================================

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createDynamoDBClient,
  DynamoDBClientWrapper,
  TABLE_NAMES,
  loadPersona,
} from '@insight-engine/core';
import type { ContentItem, PersonaFile, HotTake, RelevanceScore } from '@insight-engine/core';

import { scoreContent } from './scoring.js';
import { generateHotTakes } from './hot-take.js';
import { detectTrend } from './trend-detection.js';

const logger = createLogger('Analyst');

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

/** Shape of the SQS message body from Watchtower */
interface IngestionMessage {
  contentItemId: string;
}

// ---------------------------------------------------------------------------
// Cold-start initialisation — reused across warm invocations
// ---------------------------------------------------------------------------

const AWS_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

let bedrockClient: BedrockRuntimeClient | undefined;
let sqsClient: SQSClient | undefined;
let dbWrapper: DynamoDBClientWrapper | undefined;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
  }
  return bedrockClient;
}

function getSQSClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region: AWS_REGION });
  }
  return sqsClient;
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
 * SQS-triggered Lambda handler for the Analyst.
 *
 * For each SQS record (batch size 1 recommended for predictable error handling):
 * 1. Parse the contentItemId from the message body
 * 2. Fetch the ContentItem from DynamoDB
 * 3. Load the PersonaFile from S3
 * 4. Score the item against the persona via Bedrock
 * 5. If score < threshold → mark as filtered and skip
 * 6. If score >= threshold → detect trends, generate hot takes, publish to generation-queue
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const generationQueueUrl = requireEnv('GENERATION_QUEUE_URL');
  const personaBucket = requireEnv('PERSONA_FILES_BUCKET');
  const tablePrefix = process.env['TABLE_PREFIX'] ?? 'dev-';

  const db = getDBWrapper();
  const bedrock = getBedrockClient();
  const sqs = getSQSClient();

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
      await processRecord(
        record,
        db,
        bedrock,
        sqs,
        persona,
        generationQueueUrl,
        tablePrefix,
      );
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
  sqs: SQSClient,
  persona: PersonaFile,
  generationQueueUrl: string,
  tablePrefix: string,
): Promise<void> {
  // 1. Parse message body
  const message: IngestionMessage = JSON.parse(record.body) as IngestionMessage;
  const { contentItemId } = message;

  if (!contentItemId) {
    logger.warn('SQS message missing contentItemId', { body: record.body });
    return; // Drop the message — no point retrying
  }

  logger.info('Processing content item', { contentItemId });

  // 2. Fetch ContentItem from DynamoDB
  const item = await db.getItem<ContentItem & Record<string, unknown>>(
    TABLE_NAMES.contentItems,
    { id: contentItemId },
  );

  if (!item) {
    logger.warn('ContentItem not found in DynamoDB', { contentItemId });
    return; // Item was deleted — drop the message
  }

  // 3. Score the item
  const relevanceResult: RelevanceScore = await scoreContent(
    item as ContentItem,
    persona,
    bedrock,
  );

  // 4. Check threshold
  if (relevanceResult.score < persona.relevanceThreshold) {
    logger.info('Item filtered — below relevance threshold', {
      contentItemId,
      score: relevanceResult.score,
      threshold: persona.relevanceThreshold,
    });

    await db.updateItem(
      TABLE_NAMES.contentItems,
      { id: contentItemId },
      'SET relevanceScore = :score, #status = :status',
      {
        ':score': relevanceResult.score,
        ':status': 'filtered',
      },
      { '#status': 'status' },
    );
    return;
  }

  // 5. Detect trending topics
  const isTrending = await detectTrend(item as ContentItem, db, tablePrefix);

  // 6. Update ContentItem with score, status, and trending flag
  await db.updateItem(
    TABLE_NAMES.contentItems,
    { id: contentItemId },
    'SET relevanceScore = :score, #status = :status, isTrending = :trending',
    {
      ':score': relevanceResult.score,
      ':status': 'scored',
      ':trending': isTrending,
    },
    { '#status': 'status' },
  );

  // 7. Generate hot takes
  const hotTakes: HotTake[] = await generateHotTakes(
    item as ContentItem,
    persona,
    bedrock,
  );

  if (hotTakes.length === 0) {
    logger.warn('No hot takes generated despite passing threshold', {
      contentItemId,
      score: relevanceResult.score,
    });
    return;
  }

  // 8. Store hot takes in DynamoDB and publish to generation-queue
  for (const hotTake of hotTakes) {
    await db.putItem(TABLE_NAMES.hotTakes, hotTake as unknown as Record<string, unknown>);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: generationQueueUrl,
        MessageBody: JSON.stringify({ hotTakeId: hotTake.id }),
      }),
    );

    logger.info('Published hot take to generation queue', {
      hotTakeId: hotTake.id,
      contentItemId,
      variationIndex: hotTake.variationIndex,
    });
  }

  logger.info('Completed processing content item', {
    contentItemId,
    relevanceScore: relevanceResult.score,
    isTrending: String(isTrending),
    hotTakesGenerated: hotTakes.length,
  });
}
