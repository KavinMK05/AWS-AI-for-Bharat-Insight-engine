import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetItem = vi.fn();
const mockQueryByIndex = vi.fn();
const mockUpdateItem = vi.fn();
const mockRdsQuery = vi.fn();

const mockSqsSend = vi.fn();
const mockSnsSend = vi.fn();
const mockSsmSend = vi.fn();

const mockGetValidAccessToken = vi.fn();
const mockRefreshAccessToken = vi.fn();
const mockSleep = vi.fn();

vi.mock('node:timers/promises', () => ({
  setTimeout: (...args: unknown[]) => mockSleep(...args),
}));

vi.mock('@insight-engine/core', () => {
  class MockOAuthRefreshError extends Error {
    readonly platform: 'twitter' | 'linkedin';

    constructor(platform: 'twitter' | 'linkedin', message: string) {
      super(message);
      this.name = 'OAuthRefreshError';
      this.platform = platform;
    }
  }

  return {
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    createDynamoDBClient: vi.fn(() => ({})),
    DynamoDBClientWrapper: vi.fn().mockImplementation(() => ({
      getItem: mockGetItem,
      queryByIndex: mockQueryByIndex,
      updateItem: mockUpdateItem,
    })),
    createRdsClient: vi.fn(() => ({
      query: mockRdsQuery,
    })),
    OAuthTokenManager: vi.fn().mockImplementation(() => ({
      getValidAccessToken: mockGetValidAccessToken,
      refreshAccessToken: mockRefreshAccessToken,
    })),
    OAuthRefreshError: MockOAuthRefreshError,
    TABLE_NAMES: {
      contentItems: 'ContentItems',
      hotTakes: 'HotTakes',
      draftContent: 'DraftContent',
      publishingQueue: 'PublishingQueue',
      socialConnections: 'SocialConnections',
      metrics: 'Metrics',
    },
  };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: mockSqsSend,
  })),
  ChangeMessageVisibilityCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({
    send: mockSnsSend,
  })),
  PublishCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({
    send: mockSsmSend,
  })),
  GetParameterCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

function makeEvent(body: Record<string, unknown>) {
  return {
    Records: [
      {
        messageId: 'msg-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify(body),
      },
    ],
  };
}

describe('publisher handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env['TABLE_PREFIX'] = 'test-';
    process.env['ENVIRONMENT'] = 'dev';
    process.env['PUBLISH_QUEUE_URL'] = 'https://sqs.ap-south-1.amazonaws.com/123/publish-queue';
    process.env['ADMIN_ALERTS_TOPIC_ARN'] = 'arn:aws:sns:ap-south-1:123:alerts';
    process.env['LINKEDIN_AUTHOR_URN'] = 'urn:li:person:test-user';

    vi.stubGlobal('fetch', vi.fn());

    mockSleep.mockResolvedValue(undefined);
    mockSqsSend.mockResolvedValue({});
    mockSnsSend.mockResolvedValue({});
    mockUpdateItem.mockResolvedValue(undefined);
    mockRdsQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mockGetValidAccessToken.mockResolvedValue('token-value');
    mockRefreshAccessToken.mockResolvedValue({});
    mockQueryByIndex.mockResolvedValue([]);
    mockSsmSend.mockResolvedValue({ Parameter: { Value: 'client-value' } });
    mockGetItem.mockImplementation(async (table: string, key: Record<string, unknown>) => {
      if (table === 'SocialConnections') {
        const platform = key['platform'] as 'twitter' | 'linkedin';
        return {
          userId: key['userId'],
          platform,
          accessToken: `${platform}-access-token`,
          refreshToken: `${platform}-refresh-token`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          platformUserId: 'linked-user-1',
          connectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      return null;
    });
  });

  it.skip('publishes Twitter thread and marks queue item as published', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        id: 'pq-1',
        draftContentId: 'draft-1',
        contentItemId: 'ci-1',
        platform: 'twitter',
        ownerUserId: 'user-1',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        id: 'draft-1',
        hotTakeId: 'ht-1',
        contentItemId: 'ci-1',
        platform: 'twitter',
        content: JSON.stringify(['1/ First tweet', '2/ Final tweet']),
        status: 'approved',
      });

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({ data: { id: 'tweet-1' } }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({ data: { id: 'tweet-2' } }),
        headers: { get: vi.fn().mockReturnValue(null) },
      });

    const { handler } = await import('./index.js');
    const result = await handler(makeEvent({ publishingQueueItemId: 'pq-1' }));

    console.log("MOCK CALLS:", JSON.stringify(mockUpdateItem.mock.calls, null, 2));
    expect(result.batchItemFailures).toEqual([]);
    expect(mockUpdateItem).toHaveBeenCalledTimes(2);
    expect(mockRdsQuery).toHaveBeenCalledTimes(2);
  });



  it('retries transient LinkedIn 500 responses with exponential backoff', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        id: 'pq-3',
        draftContentId: 'draft-3',
        contentItemId: 'ci-3',
        platform: 'linkedin',
        ownerUserId: 'user-1',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        id: 'draft-3',
        hotTakeId: 'ht-3',
        contentItemId: 'ci-3',
        platform: 'linkedin',
        content: JSON.stringify('LinkedIn content'),
        status: 'approved',
      });

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'server error 1' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'server error 2' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({}),
        headers: { get: vi.fn().mockReturnValue('li-post-1') },
      });

    const { handler } = await import('./index.js');
    const result = await handler(makeEvent({ publishingQueueItemId: 'pq-3' }));

    expect(result.batchItemFailures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 1000);
    expect(mockSleep).toHaveBeenNthCalledWith(2, 2000);
    expect(mockUpdateItem).toHaveBeenNthCalledWith(
      2,
      'PublishingQueue',
      { id: 'pq-3' },
      expect.stringContaining('retryCount'),
      expect.objectContaining({
        ':retryCount': 3,
      }),
      { '#status': 'status' },
    );
  });

  it('refreshes token once on 401 and then retries successfully', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        id: 'pq-4',
        draftContentId: 'draft-4',
        contentItemId: 'ci-4',
        platform: 'linkedin',
        ownerUserId: 'user-1',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        id: 'draft-4',
        hotTakeId: 'ht-4',
        contentItemId: 'ci-4',
        platform: 'linkedin',
        content: JSON.stringify('LinkedIn content'),
        status: 'approved',
      });

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ message: 'expired token' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          access_token: 'linkedin-refreshed-token',
          refresh_token: 'linkedin-refreshed-refresh-token',
          expires_in: 3600,
        }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({}),
        headers: { get: vi.fn().mockReturnValue('li-post-2') },
      });

    const { handler } = await import('./index.js');
    const result = await handler(makeEvent({ publishingQueueItemId: 'pq-4' }));

    expect(result.batchItemFailures).toEqual([]);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockSsmSend).toHaveBeenCalled();
  });

  it('marks item failed and sends SNS alert after retries are exhausted', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        id: 'pq-5',
        draftContentId: 'draft-5',
        contentItemId: 'ci-5',
        platform: 'linkedin',
        ownerUserId: 'user-1',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        id: 'draft-5',
        hotTakeId: 'ht-5',
        contentItemId: 'ci-5',
        platform: 'linkedin',
        content: JSON.stringify('LinkedIn content'),
        status: 'approved',
      });

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'server error 1' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'server error 2' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'server error 3' }),
        headers: { get: vi.fn().mockReturnValue(null) },
      });

    const { handler } = await import('./index.js');
    const result = await handler(makeEvent({ publishingQueueItemId: 'pq-5' }));

    expect(result.batchItemFailures).toEqual([]);
    expect(mockUpdateItem).toHaveBeenNthCalledWith(
      2,
      'PublishingQueue',
      { id: 'pq-5' },
      'SET #status = :status, errorMessage = :errorMessage, retryCount = :retryCount',
      expect.objectContaining({
        ':status': 'failed',
        ':retryCount': 3,
      }),
      { '#status': 'status' },
    );
    expect(mockSnsSend).toHaveBeenCalledOnce();
  });
});
