// ============================================================================
// Handler Tests — unit tests for the Watchtower Lambda orchestrator
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the handler module
// ---------------------------------------------------------------------------

// Mock SQS client
const mockSqsSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: mockSqsSend })),
  SendMessageCommand: vi.fn().mockImplementation((params) => params),
}));

// Mock DynamoDB from core
const mockPutItem = vi.fn().mockResolvedValue(undefined);
const mockQueryByIndex = vi.fn().mockResolvedValue([]);
vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  createDynamoDBClient: vi.fn().mockReturnValue({}),
  DynamoDBClientWrapper: vi.fn().mockImplementation(() => ({
    putItem: mockPutItem,
    queryByIndex: mockQueryByIndex,
    getItem: vi.fn(),
    queryItems: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  })),
  TABLE_NAMES: {
    contentItems: 'ContentItems',
    hotTakes: 'HotTakes',
    draftContent: 'DraftContent',
    publishingQueue: 'PublishingQueue',
    metrics: 'Metrics',
  },
  loadPersona: vi.fn().mockResolvedValue({
    tone: 'technical',
    expertiseTopics: ['artificial intelligence'],
    heroes: [],
    enemies: [],
    platformPreferences: {
      twitter: { maxThreadLength: 8, hashtags: true, emoji: false },
      linkedin: { hashtags: true, emoji: false },
    },
    relevanceThreshold: 60,
    digestSchedule: 'daily',
    monitoringInterval: 'hourly',
  }),
}));

// Mock RSS monitor
const mockFetchRssItems = vi.fn().mockResolvedValue([]);
vi.mock('./rss-monitor.js', () => ({
  fetchRssItems: (...args: unknown[]) => mockFetchRssItems(...args),
}));

// Mock arXiv monitor
const mockFetchArxivItems = vi.fn().mockResolvedValue([]);
vi.mock('./arxiv-monitor.js', () => ({
  fetchArxivItems: (...args: unknown[]) => mockFetchArxivItems(...args),
}));

// Mock dedup
const mockCheckDuplicate = vi.fn().mockResolvedValue(false);
vi.mock('./dedup.js', () => ({
  checkDuplicate: (...args: unknown[]) => mockCheckDuplicate(...args),
}));

// Set required env vars
const ENV_VARS = {
  AWS_REGION: 'ap-south-1',
  TABLE_PREFIX: 'dev-',
  INGESTION_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/123456789/dev-ingestion-queue',
  PERSONA_FILES_BUCKET: 'dev-persona-files',
  RSS_FEED_URLS: 'https://example.com/feed.xml',
  ARXIV_CATEGORIES: 'cs.AI,cs.LG',
  ARXIV_MAX_RESULTS: '5',
};

describe('Watchtower handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset env vars
    for (const [key, value] of Object.entries(ENV_VARS)) {
      process.env[key] = value;
    }
  });

  // We need to re-import the handler for each test to pick up fresh env vars
  async function importHandler() {
    // Dynamic import to get the handler with current mocks
    const mod = await import('./handler.js');
    return mod.handler;
  }

  it('stores RSS and arXiv items in DynamoDB and enqueues to SQS', async () => {
    mockFetchRssItems.mockResolvedValueOnce([
      {
        title: 'RSS Article',
        author: 'Author A',
        publicationDate: '2026-02-28T10:00:00Z',
        sourceUrl: 'https://example.com/rss-1',
        fullText: 'RSS content.',
        source: 'rss',
      },
    ]);

    mockFetchArxivItems.mockResolvedValueOnce([
      {
        title: 'arXiv Paper',
        author: 'Author B',
        publicationDate: '2026-02-27T08:00:00Z',
        sourceUrl: 'http://arxiv.org/abs/2602.12345',
        fullText: 'arXiv abstract.',
        source: 'arxiv',
      },
    ]);

    // No duplicates
    mockCheckDuplicate.mockResolvedValue(false);

    const handler = await importHandler();
    await handler();

    // 2 items stored
    expect(mockPutItem).toHaveBeenCalledTimes(2);

    // 2 SQS messages sent
    expect(mockSqsSend).toHaveBeenCalledTimes(2);

    // Verify the first DynamoDB put has the right shape
    const firstPutCall = mockPutItem.mock.calls[0] as unknown[];
    expect(firstPutCall[0]).toBe('ContentItems');
    const storedItem = firstPutCall[1] as Record<string, unknown>;
    expect(storedItem['title']).toBe('RSS Article');
    expect(storedItem['source']).toBe('rss');
    expect(storedItem['isDuplicate']).toBe(false);
    expect(storedItem['status']).toBe('ingested');
    expect(storedItem['id']).toBeDefined();
    expect(storedItem['ingestedAt']).toBeDefined();
  });

  it('stores duplicate items with isDuplicate=true and does NOT enqueue to SQS', async () => {
    mockFetchRssItems.mockResolvedValueOnce([
      {
        title: 'Duplicate Article',
        author: 'Author A',
        publicationDate: '2026-02-28T10:00:00Z',
        sourceUrl: 'https://example.com/duplicate',
        fullText: 'Already seen.',
        source: 'rss',
      },
    ]);
    mockFetchArxivItems.mockResolvedValueOnce([]);

    // Mark as duplicate
    mockCheckDuplicate.mockResolvedValue(true);

    const handler = await importHandler();
    await handler();

    // Item is stored in DynamoDB
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const firstPutCall = mockPutItem.mock.calls[0] as unknown[];
    const storedItem = firstPutCall[1] as Record<string, unknown>;
    expect(storedItem['isDuplicate']).toBe(true);

    // NOT enqueued to SQS
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('continues processing arXiv when RSS source fails', async () => {
    // RSS throws
    mockFetchRssItems.mockRejectedValueOnce(new Error('RSS catastrophic failure'));

    // arXiv works
    mockFetchArxivItems.mockResolvedValueOnce([
      {
        title: 'arXiv Paper',
        author: 'Author B',
        publicationDate: '2026-02-27T08:00:00Z',
        sourceUrl: 'http://arxiv.org/abs/2602.99999',
        fullText: 'arXiv abstract.',
        source: 'arxiv',
      },
    ]);

    mockCheckDuplicate.mockResolvedValue(false);

    const handler = await importHandler();
    await handler();

    // Only the arXiv item is stored and enqueued
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const firstPutCall = mockPutItem.mock.calls[0] as unknown[];
    const storedItem = firstPutCall[1] as Record<string, unknown>;
    expect(storedItem['source']).toBe('arxiv');
  });

  it('continues processing RSS when arXiv source fails', async () => {
    // RSS works
    mockFetchRssItems.mockResolvedValueOnce([
      {
        title: 'RSS Article',
        author: 'Author A',
        publicationDate: '2026-02-28T10:00:00Z',
        sourceUrl: 'https://example.com/rss-1',
        fullText: 'RSS content.',
        source: 'rss',
      },
    ]);

    // arXiv throws
    mockFetchArxivItems.mockRejectedValueOnce(new Error('arXiv catastrophic failure'));

    mockCheckDuplicate.mockResolvedValue(false);

    const handler = await importHandler();
    await handler();

    // Only the RSS item is stored and enqueued
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const firstPutCall = mockPutItem.mock.calls[0] as unknown[];
    const storedItem = firstPutCall[1] as Record<string, unknown>;
    expect(storedItem['source']).toBe('rss');
  });

  it('sends one SQS message per non-duplicate item with correct payload', async () => {
    mockFetchRssItems.mockResolvedValueOnce([
      {
        title: 'Item 1',
        author: 'A',
        publicationDate: '2026-02-28T10:00:00Z',
        sourceUrl: 'https://example.com/1',
        fullText: 'First.',
        source: 'rss',
      },
      {
        title: 'Item 2',
        author: 'B',
        publicationDate: '2026-02-28T11:00:00Z',
        sourceUrl: 'https://example.com/2',
        fullText: 'Second.',
        source: 'rss',
      },
    ]);
    mockFetchArxivItems.mockResolvedValueOnce([]);

    // First is new, second is duplicate
    mockCheckDuplicate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const handler = await importHandler();
    await handler();

    // 2 items stored
    expect(mockPutItem).toHaveBeenCalledTimes(2);

    // Only 1 SQS message (for the non-duplicate)
    expect(mockSqsSend).toHaveBeenCalledTimes(1);

    // Verify the SQS message body contains a contentItemId
    const firstSqsCall = mockSqsSend.mock.calls[0] as unknown[];
    const sqsCommand = firstSqsCall[0] as Record<string, unknown>;
    const body = JSON.parse(sqsCommand['MessageBody'] as string) as { contentItemId: string };
    expect(body.contentItemId).toBeDefined();
    expect(typeof body.contentItemId).toBe('string');
    expect(sqsCommand['QueueUrl']).toBe(ENV_VARS.INGESTION_QUEUE_URL);
  });
});
