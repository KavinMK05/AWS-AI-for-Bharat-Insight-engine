// ============================================================================
// Gatekeeper Lambda — Handler Unit Tests
// Tests all API routes with mocked DynamoDB and SQS.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQueryByIndex = vi.fn();
const mockGetItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockPutItem = vi.fn();
const mockSendSSM = vi.fn();

vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  createDynamoDBClient: vi.fn(() => ({})),
  DynamoDBClientWrapper: vi.fn().mockImplementation(() => ({
    queryByIndex: mockQueryByIndex,
    getItem: mockGetItem,
    updateItem: mockUpdateItem,
    putItem: mockPutItem,
  })),
  TABLE_NAMES: {
    contentItems: 'ContentItems',
    hotTakes: 'HotTakes',
    draftContent: 'DraftContent',
    publishingQueue: 'PublishingQueue',
    socialConnections: 'SocialConnections',
    metrics: 'Metrics',
  },
}));

const mockSendSQS = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: mockSendSQS,
  })),
  SendMessageCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({
    send: mockSendSSM,
  })),
  GetParameterCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  method: string,
  path: string,
  body?: string,
): Parameters<typeof handler>[0] {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789',
      apiId: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-1',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '2026-01-01T00:00:00Z',
      timeEpoch: 0,
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-sub-123',
          },
        },
      },
    },
    body,
    isBase64Encoded: false,
  };
}

const MOCK_CONTENT_ITEM = {
  id: 'ci-1',
  title: 'Test Article',
  author: 'Author',
  publicationDate: '2026-01-01T00:00:00Z',
  sourceUrl: 'https://example.com/article',
  fullText: 'Full text content',
  source: 'rss' as const,
  ingestedAt: '2026-01-01T00:00:00Z',
  isDuplicate: false,
  relevanceScore: 85,
  status: 'scored' as const,
};

const MOCK_HOT_TAKE = {
  id: 'ht-1',
  contentItemId: 'ci-1',
  text: 'This is a hot take about the article.',
  wordCount: 8,
  variationIndex: 0,
  createdAt: '2026-01-01T00:00:00Z',
};

const MOCK_DRAFT_TWITTER = {
  id: 'draft-tw-1',
  hotTakeId: 'ht-1',
  contentItemId: 'ci-1',
  platform: 'twitter' as const,
  content: JSON.stringify(['Tweet 1/3', 'Tweet 2/3', 'Tweet 3/3 https://example.com']),
  status: 'pending_approval' as const,
  createdAt: '2026-01-01T00:00:00Z',
};

const MOCK_DRAFT_LINKEDIN = {
  id: 'draft-li-1',
  hotTakeId: 'ht-1',
  contentItemId: 'ci-1',
  platform: 'linkedin' as const,
  content: JSON.stringify('A professional LinkedIn post about the article.'),
  status: 'pending_approval' as const,
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TABLE_PREFIX'] = 'test-';
  process.env['PUBLISH_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/123456789/publish-queue';
});

describe('GET /health', () => {
  it('returns healthy status with no auth required', async () => {
    const event = makeEvent('GET', '/health');
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeDefined();
    expect(body.components.api).toBe('healthy');
  });
});

describe('GET /api/digest', () => {
  it('returns empty array when no pending drafts exist', async () => {
    mockQueryByIndex.mockResolvedValueOnce([]);

    const event = makeEvent('GET', '/api/digest');
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });

  it('returns ApprovalDigest[] grouped by contentItemId', async () => {
    mockQueryByIndex.mockResolvedValueOnce([MOCK_DRAFT_TWITTER, MOCK_DRAFT_LINKEDIN]);
    mockGetItem
      .mockResolvedValueOnce(MOCK_CONTENT_ITEM) // ContentItem for ci-1
      .mockResolvedValueOnce(MOCK_HOT_TAKE); // HotTake for ht-1

    const event = makeEvent('GET', '/api/digest');
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].contentItem.id).toBe('ci-1');
    expect(body[0].hotTake.id).toBe('ht-1');
    expect(body[0].drafts).toHaveLength(2);
  });

  it('skips groups where ContentItem is not found', async () => {
    mockQueryByIndex.mockResolvedValueOnce([MOCK_DRAFT_TWITTER]);
    mockGetItem.mockResolvedValueOnce(null); // ContentItem not found

    const event = makeEvent('GET', '/api/digest');
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });
});

describe('POST /api/approve', () => {
  it('approves draft, creates PublishingQueueItem, publishes to SQS', async () => {
    mockGetItem.mockResolvedValueOnce(MOCK_DRAFT_TWITTER);

    const event = makeEvent(
      'POST',
      '/api/approve',
      JSON.stringify({ draftContentId: 'draft-tw-1' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Draft approved');
    expect(body.publishingQueueItemId).toBeDefined();

    // Verify DraftContent status updated
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'DraftContent',
      { id: 'draft-tw-1' },
      'SET #status = :status',
      { ':status': 'approved' },
      { '#status': 'status' },
    );

    // Verify PublishingQueueItem created
    expect(mockPutItem).toHaveBeenCalledWith(
      'PublishingQueue',
      expect.objectContaining({
        draftContentId: 'draft-tw-1',
        contentItemId: 'ci-1',
        platform: 'twitter',
        status: 'queued',
      }),
    );

    // Verify SQS message sent
    expect(mockSendSQS).toHaveBeenCalled();
  });

  it('returns 404 for non-existent draft', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    const event = makeEvent(
      'POST',
      '/api/approve',
      JSON.stringify({ draftContentId: 'nonexistent' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });

  it('returns 409 when draft is not pending_approval', async () => {
    mockGetItem.mockResolvedValueOnce({ ...MOCK_DRAFT_TWITTER, status: 'approved' });

    const event = makeEvent(
      'POST',
      '/api/approve',
      JSON.stringify({ draftContentId: 'draft-tw-1' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(409);
  });

  it('returns 400 when body is missing', async () => {
    const event = makeEvent('POST', '/api/approve');
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when draftContentId is missing', async () => {
    const event = makeEvent('POST', '/api/approve', JSON.stringify({}));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('draftContentId');
  });
});

describe('POST /api/reject', () => {
  it('rejects a pending draft', async () => {
    mockGetItem.mockResolvedValueOnce(MOCK_DRAFT_LINKEDIN);

    const event = makeEvent(
      'POST',
      '/api/reject',
      JSON.stringify({ draftContentId: 'draft-li-1' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Draft rejected');

    expect(mockUpdateItem).toHaveBeenCalledWith(
      'DraftContent',
      { id: 'draft-li-1' },
      'SET #status = :status',
      { ':status': 'rejected' },
      { '#status': 'status' },
    );
  });

  it('returns 404 for non-existent draft', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    const event = makeEvent(
      'POST',
      '/api/reject',
      JSON.stringify({ draftContentId: 'nonexistent' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when body is missing', async () => {
    const event = makeEvent('POST', '/api/reject');
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });
});

describe('POST /api/edit-approve', () => {
  it('stores edited content, approves draft, creates publishing queue item', async () => {
    mockGetItem.mockResolvedValueOnce(MOCK_DRAFT_LINKEDIN);

    const editedContent = 'Updated LinkedIn post content';
    const event = makeEvent(
      'POST',
      '/api/edit-approve',
      JSON.stringify({ draftContentId: 'draft-li-1', editedContent }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Draft edited and approved');
    expect(body.publishingQueueItemId).toBeDefined();

    // Verify content and status updated
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'DraftContent',
      { id: 'draft-li-1' },
      'SET #status = :status, content = :content',
      { ':status': 'approved', ':content': editedContent },
      { '#status': 'status' },
    );

    // Verify PublishingQueueItem created
    expect(mockPutItem).toHaveBeenCalledWith(
      'PublishingQueue',
      expect.objectContaining({
        draftContentId: 'draft-li-1',
        platform: 'linkedin',
        status: 'queued',
      }),
    );

    // Verify SQS message sent
    expect(mockSendSQS).toHaveBeenCalled();
  });

  it('returns 400 when editedContent is missing', async () => {
    const event = makeEvent(
      'POST',
      '/api/edit-approve',
      JSON.stringify({ draftContentId: 'draft-li-1' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('editedContent');
  });

  it('returns 404 for non-existent draft', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    const event = makeEvent(
      'POST',
      '/api/edit-approve',
      JSON.stringify({ draftContentId: 'nonexistent', editedContent: 'test' }),
    );
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });
});

describe('Route not found', () => {
  it('returns 404 for unknown routes', async () => {
    const event = makeEvent('GET', '/api/unknown');
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Route not found');
  });
});

describe('CORS', () => {
  it('returns CORS headers on all responses', async () => {
    mockQueryByIndex.mockResolvedValueOnce([]);

    const event = makeEvent('GET', '/api/digest');
    const result = await handler(event);

    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers?.['Content-Type']).toBe('application/json');
  });

  it('handles OPTIONS preflight', async () => {
    const event = makeEvent('OPTIONS', '/api/digest');
    const result = await handler(event);

    expect(result.statusCode).toBe(204);
    expect(result.headers?.['Access-Control-Allow-Methods']).toContain('POST');
  });
});
