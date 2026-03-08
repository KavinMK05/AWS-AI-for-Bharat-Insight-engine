// ============================================================================
// Sync Lambda Handler Tests — DynamoDB Streams → RDS upsert
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @insight-engine/core
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  createRdsClient: vi.fn().mockReturnValue({
    query: mockQuery,
    healthCheck: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from './handler.js';

// Set required env var before tests
process.env['RDS_CONNECTION_STRING'] = 'postgresql://test:test@localhost:5432/test';

function makeStreamEvent(
  records: Array<{
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
    tableName: string;
    newImage?: Record<string, { S?: string; N?: string; BOOL?: boolean }>;
  }>,
) {
  return {
    Records: records.map((r, i) => ({
      eventID: `event-${i}`,
      eventName: r.eventName,
      eventSourceARN: `arn:aws:dynamodb:us-east-1:123456789:table/ie-dev-${r.tableName}/stream/2024-01-01`,
      dynamodb: {
        Keys: {},
        NewImage: r.newImage,
      },
    })),
  };
}

describe('Sync handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts a ContentItems INSERT event to RDS', async () => {
    const event = makeStreamEvent([
      {
        eventName: 'INSERT',
        tableName: 'ContentItems',
        newImage: {
          id: { S: 'item-1' },
          title: { S: 'Test Article' },
          sourceUrl: { S: 'https://example.com/article' },
          ingestedAt: { S: '2024-01-01T00:00:00Z' },
        },
      },
    ]);

    await handler(event);

    // Should call query for migration check + upsert
    expect(mockQuery).toHaveBeenCalled();
    const upsertCall = mockQuery.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO content_items'),
    );
    expect(upsertCall).toBeDefined();
  });

  it('upserts a DraftContent MODIFY event to RDS', async () => {
    const event = makeStreamEvent([
      {
        eventName: 'MODIFY',
        tableName: 'DraftContent',
        newImage: {
          id: { S: 'draft-1' },
          hotTakeId: { S: 'ht-1' },
          platform: { S: 'twitter' },
          status: { S: 'approved' },
          createdAt: { S: '2024-01-01T12:00:00Z' },
        },
      },
    ]);

    await handler(event);

    const upsertCall = mockQuery.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO draft_content'),
    );
    expect(upsertCall).toBeDefined();
  });

  it('skips REMOVE events', async () => {
    const event = makeStreamEvent([
      {
        eventName: 'REMOVE',
        tableName: 'ContentItems',
      },
    ]);

    await handler(event);

    // Should not attempt any content upsert
    const upsertCalls = mockQuery.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO content_items'),
    );
    expect(upsertCalls.length).toBe(0);
  });

  it('handles errors gracefully without throwing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const event = makeStreamEvent([
      {
        eventName: 'INSERT',
        tableName: 'ContentItems',
        newImage: {
          id: { S: 'item-err' },
          title: { S: 'Error item' },
        },
      },
    ]);

    // Should not throw — errors are caught and logged
    await expect(handler(event)).resolves.not.toThrow();
  });
});
