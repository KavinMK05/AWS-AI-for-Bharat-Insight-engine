// ============================================================================
// Handler Tests — SQS Lambda handler orchestration for Ghostwriter
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @insight-engine/core
// ---------------------------------------------------------------------------
const mockGetItem = vi.fn();
const mockPutItem = vi.fn();

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
// Mock node:crypto
// ---------------------------------------------------------------------------
let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: () => `draft-${++uuidCounter}`,
}));

// ---------------------------------------------------------------------------
// Mock internal modules
// ---------------------------------------------------------------------------
const mockGenerateTwitterThread = vi.fn();
const mockGenerateLinkedInPost = vi.fn();

vi.mock('./twitter-generator.js', () => ({
  generateTwitterThread: (...args: unknown[]) => mockGenerateTwitterThread(...args),
}));

vi.mock('./linkedin-generator.js', () => ({
  generateLinkedInPost: (...args: unknown[]) => mockGenerateLinkedInPost(...args),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSQSEvent(hotTakeId: string) {
  return {
    Records: [
      {
        messageId: 'msg-001',
        body: JSON.stringify({ hotTakeId }),
        receiptHandle: 'receipt-001',
        attributes: {},
        messageAttributes: {},
        md5OfBody: 'abc123',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123:generation-queue',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const mockHotTake = {
  id: 'ht-001',
  contentItemId: 'item-001',
  text: 'A hot take about machine learning advances.',
  wordCount: 7,
  variationIndex: 0,
  createdAt: new Date().toISOString(),
};

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
    uuidCounter = 0;
    mockPutItem.mockResolvedValue(undefined);

    // Set required env vars
    process.env['PERSONA_FILES_BUCKET'] = 'test-persona-bucket';
    process.env['TABLE_PREFIX'] = 'dev-';
    process.env['AWS_REGION'] = 'us-east-1';
  });

  it('processes a hot take and creates 2 DraftContent records (one per platform)', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    // First getItem call returns the HotTake
    mockGetItem.mockResolvedValueOnce(mockHotTake);
    // Second getItem call returns the ContentItem
    mockGetItem.mockResolvedValueOnce(mockContentItem);

    const twitterThreadContent = [
      '1/ Great insight on ML!',
      '2/ Read more: https://example.com/test',
    ];
    mockGenerateTwitterThread.mockResolvedValueOnce(twitterThreadContent);

    const linkedInPostContent = 'A professional LinkedIn post about ML advances.'.repeat(30);
    mockGenerateLinkedInPost.mockResolvedValueOnce(linkedInPostContent);

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockGenerateTwitterThread).toHaveBeenCalledOnce();
    expect(mockGenerateLinkedInPost).toHaveBeenCalledOnce();
    expect(mockPutItem).toHaveBeenCalledTimes(2); // 2 drafts stored

    // Verify Twitter draft
    const twitterDraftCall = mockPutItem.mock.calls[0] as unknown[];
    const twitterTable = twitterDraftCall[0] as string;
    const twitterDraft = twitterDraftCall[1] as Record<string, unknown>;
    expect(twitterTable).toBe('DraftContent');
    expect(twitterDraft['platform']).toBe('twitter');
    expect(twitterDraft['status']).toBe('pending_approval');
    expect(twitterDraft['hotTakeId']).toBe('ht-001');
    expect(twitterDraft['contentItemId']).toBe('item-001');
    expect(twitterDraft['content']).toBe(JSON.stringify(twitterThreadContent));

    // Verify LinkedIn draft
    const linkedInDraftCall = mockPutItem.mock.calls[1] as unknown[];
    const linkedInTable = linkedInDraftCall[0] as string;
    const linkedInDraft = linkedInDraftCall[1] as Record<string, unknown>;
    expect(linkedInTable).toBe('DraftContent');
    expect(linkedInDraft['platform']).toBe('linkedin');
    expect(linkedInDraft['status']).toBe('pending_approval');
    expect(linkedInDraft['content']).toBe(JSON.stringify(linkedInPostContent));
  });

  it('handles missing HotTake gracefully', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(null); // HotTake not found

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('nonexistent-ht');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0); // Dropped, not retried
    expect(mockGenerateTwitterThread).not.toHaveBeenCalled();
    expect(mockGenerateLinkedInPost).not.toHaveBeenCalled();
  });

  it('handles missing parent ContentItem gracefully', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockHotTake); // HotTake found
    mockGetItem.mockResolvedValueOnce(null); // ContentItem not found

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0); // Dropped, not retried
    expect(mockGenerateTwitterThread).not.toHaveBeenCalled();
  });

  it('fails all records when persona file cannot be loaded', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('S3 bucket not found'),
    );

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-001');
  });

  it('stores LinkedIn draft even when Twitter generation fails', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockHotTake);
    mockGetItem.mockResolvedValueOnce(mockContentItem);

    // Twitter fails
    mockGenerateTwitterThread.mockResolvedValueOnce([]);

    // LinkedIn succeeds
    const linkedInPostContent = 'A professional post.'.repeat(80);
    mockGenerateLinkedInPost.mockResolvedValueOnce(linkedInPostContent);

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockPutItem).toHaveBeenCalledTimes(1); // Only LinkedIn draft stored

    const draftCall = mockPutItem.mock.calls[0] as unknown[];
    const draft = draftCall[1] as Record<string, unknown>;
    expect(draft['platform']).toBe('linkedin');
  });

  it('stores Twitter draft even when LinkedIn generation fails', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockHotTake);
    mockGetItem.mockResolvedValueOnce(mockContentItem);

    // Twitter succeeds
    mockGenerateTwitterThread.mockResolvedValueOnce(['1/ Tweet!']);

    // LinkedIn fails
    mockGenerateLinkedInPost.mockResolvedValueOnce('');

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockPutItem).toHaveBeenCalledTimes(1); // Only Twitter draft stored

    const draftCall = mockPutItem.mock.calls[0] as unknown[];
    const draft = draftCall[1] as Record<string, unknown>;
    expect(draft['platform']).toBe('twitter');
  });

  it('stores Twitter draft even when LinkedIn generator throws', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockHotTake);
    mockGetItem.mockResolvedValueOnce(mockContentItem);

    // Twitter succeeds
    mockGenerateTwitterThread.mockResolvedValueOnce(['1/ Tweet!']);

    // LinkedIn throws
    mockGenerateLinkedInPost.mockRejectedValueOnce(new Error('LinkedIn Bedrock error'));

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0); // No batch failure
    expect(mockPutItem).toHaveBeenCalledTimes(1); // Only Twitter draft stored
  });

  it('creates DraftContent records with correct structure', async () => {
    const { loadPersona } = await import('@insight-engine/core');
    (loadPersona as ReturnType<typeof vi.fn>).mockResolvedValue(mockPersona);

    mockGetItem.mockResolvedValueOnce(mockHotTake);
    mockGetItem.mockResolvedValueOnce(mockContentItem);

    mockGenerateTwitterThread.mockResolvedValueOnce(['1/ Tweet']);
    mockGenerateLinkedInPost.mockResolvedValueOnce('A'.repeat(1500));

    const { handler } = await import('./handler.js');
    const event = makeSQSEvent('ht-001');
    await handler(event);

    // Both drafts should have required DraftContent fields
    for (const call of mockPutItem.mock.calls) {
      const args = call as unknown[];
      const draft = args[1] as Record<string, unknown>;
      expect(draft).toHaveProperty('id');
      expect(draft).toHaveProperty('hotTakeId', 'ht-001');
      expect(draft).toHaveProperty('contentItemId', 'item-001');
      expect(draft).toHaveProperty('platform');
      expect(draft).toHaveProperty('content');
      expect(draft).toHaveProperty('status', 'pending_approval');
      expect(draft).toHaveProperty('createdAt');
    }
  });
});
