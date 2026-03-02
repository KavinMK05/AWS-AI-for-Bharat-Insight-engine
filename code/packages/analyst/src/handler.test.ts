// ============================================================================
// Handler Tests — SQS Lambda handler orchestration
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @insight-engine/core
// ---------------------------------------------------------------------------
const mockGetItem = vi.fn();
const mockPutItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockQueryByIndex = vi.fn();

vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  createDynamoDBClient: vi.fn(() => ({})),
  DynamoDBClientWrapper: vi.fn().mockImplementation(() => ({
    getItem: mockGetItem,
    putItem: mockPutItem,
    updateItem: mockUpdateItem,
    queryByIndex: mockQueryByIndex,
  })),
  TABLE_NAMES: {
    contentItems: 'ContentItems',
    hotTakes: 'HotTakes',
    draftContent: 'DraftContent',
    publishingQueue: 'PublishingQueue',
    metrics: 'Metrics',
  },
  loadPersona: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-bedrock-runtime
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-sqs
// ---------------------------------------------------------------------------
const mockSqsSend = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: mockSqsSend,
  })),
  SendMessageCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

// ---------------------------------------------------------------------------
// Mock internal modules
// ---------------------------------------------------------------------------
const mockScoreContent = vi.fn();
const mockGenerateHotTakes = vi.fn();
const mockDetectTrend = vi.fn();

vi.mock('./scoring.js', () => ({
  scoreContent: (...args: unknown[]) => mockScoreContent(...args),
}));

vi.mock('./hot-take.js', () => ({
  generateHotTakes: (...args: unknown[]) => mockGenerateHotTakes(...args),
}));

vi.mock('./trend-detection.js', () => ({
  detectTrend: (...args: unknown[]) => mockDetectTrend(...args),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSQSEvent(contentItemId: string) {
  return {
    Records: [
      {
        messageId: 'msg-001',
        body: JSON.stringify({ contentItemId }),
        receiptHandle: 'receipt-001',
        attributes: {},
        messageAttributes: {},
        md5OfBody: 'abc123',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123:ingestion-queue',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const mockContentItem = {
  id: 'item-001',
  title: 'Test Article on Machine Learning',
  author: 'Dr. Test',
  publicationDate: new Date().toISOString(),
  sourceUrl: 'https://example.com/test',
  fullText: 'Full text of the test article about machine learning advances.',
  source: 'rss',
  ingestedAt: new Date().toISOString(),
  isDuplicate: false,
};

const mockPersona = {
  tone: 'technical' as const,
  expertiseTopics: ['machine learning'],
  heroes: [],
  enemies: [],
  platformPreferences: {
    twitter: { maxThreadLength: 5, hashtags: true, emoji: false },
    linkedin: { hashtags: true, emoji: false },
  },
  relevanceThreshold: 60,
  digestSchedule: 'daily' as const,
  monitoringInterval: 'hourly' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqsSend.mockResolvedValue({});
    mockPutItem.mockResolvedValue(undefined);
    mockUpdateItem.mockResolvedValue(undefined);
    mockQueryByIndex.mockResolvedValue([]);

    // Set required env vars
    process.env['GENERATION_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/123/generation-queue';
    process.env['PERSONA_FILES_BUCKET'] = 'test-persona-bucket';
    process.env['TABLE_PREFIX'] = 'dev-';
    process.env['AWS_REGION'] = 'us-east-1';
  });

  it('processes a high-scoring item: scores, generates hot takes, publishes to SQS', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockContentItem);

    mockScoreContent.mockResolvedValueOnce({
      score: 85,
      reasoning: 'Very relevant',
      recencyDecayApplied: false,
      rawScore: 85,
    });

    mockDetectTrend.mockResolvedValueOnce(false);

    mockGenerateHotTakes.mockResolvedValueOnce([
      {
        id: 'ht-001',
        contentItemId: 'item-001',
        text: 'Hot take variation 1',
        wordCount: 100,
        variationIndex: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'ht-002',
        contentItemId: 'item-001',
        text: 'Hot take variation 2',
        wordCount: 120,
        variationIndex: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    // Dynamically import handler to get fresh module with mocks applied
    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('item-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockScoreContent).toHaveBeenCalledOnce();
    expect(mockGenerateHotTakes).toHaveBeenCalledOnce();
    expect(mockPutItem).toHaveBeenCalledTimes(2); // 2 hot takes stored
    expect(mockSqsSend).toHaveBeenCalledTimes(2); // 2 messages to generation-queue
    expect(mockUpdateItem).toHaveBeenCalledOnce(); // ContentItem updated with score
  });

  it('filters items below the relevance threshold', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockContentItem);

    mockScoreContent.mockResolvedValueOnce({
      score: 30,
      reasoning: 'Not very relevant',
      recencyDecayApplied: false,
      rawScore: 30,
    });

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('item-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockUpdateItem).toHaveBeenCalledOnce();
    // Verify status was set to 'filtered' in expression attribute values
    const updateCall = mockUpdateItem.mock.calls[0] as unknown[];
    const expressionValues = updateCall[3] as Record<string, unknown>;
    expect(expressionValues[':status']).toBe('filtered');
    // No hot takes generated
    expect(mockGenerateHotTakes).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('handles missing ContentItem gracefully', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(null); // Item not found

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('nonexistent-item');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0); // Dropped, not retried
    expect(mockScoreContent).not.toHaveBeenCalled();
  });

  it('fails all records when persona file cannot be loaded', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('S3 bucket not found'),
    );

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('item-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-001');
  });

  it('publishes hot take IDs to the generation queue with correct format', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockContentItem);

    mockScoreContent.mockResolvedValueOnce({
      score: 90,
      reasoning: 'Excellent match',
      recencyDecayApplied: false,
      rawScore: 90,
    });

    mockDetectTrend.mockResolvedValueOnce(true);

    mockGenerateHotTakes.mockResolvedValueOnce([
      {
        id: 'ht-abc',
        contentItemId: 'item-001',
        text: 'Take one',
        wordCount: 80,
        variationIndex: 0,
        createdAt: new Date().toISOString(),
      },
    ]);

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('item-001');
    await handler(event);

    // Verify the SQS message body format
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/generation-queue',
        MessageBody: JSON.stringify({ hotTakeId: 'ht-abc' }),
      }),
    );
  });
});
