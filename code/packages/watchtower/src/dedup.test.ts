// ============================================================================
// Deduplication Tests — unit tests for DynamoDB sourceUrl GSI dedup check
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Suppress logger output in tests
vi.mock('@insight-engine/core', async () => {
  const actual = await vi.importActual<typeof import('@insight-engine/core')>('@insight-engine/core');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { checkDuplicate } from './dedup.js';
import type { DynamoDBClientWrapper } from '@insight-engine/core';

function createMockDb(
  queryResult: Record<string, unknown>[] = [],
): DynamoDBClientWrapper {
  return {
    queryByIndex: vi.fn().mockResolvedValue(queryResult),
    putItem: vi.fn(),
    getItem: vi.fn(),
    queryItems: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  } as unknown as DynamoDBClientWrapper;
}

describe('checkDuplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when sourceUrl exists in DynamoDB GSI', async () => {
    const mockDb = createMockDb([
      { id: 'existing-id-123', sourceUrl: 'https://example.com/article' },
    ]);

    const result = await checkDuplicate(mockDb, 'https://example.com/article');

    expect(result).toBe(true);
    expect(mockDb.queryByIndex).toHaveBeenCalledWith(
      'ContentItems',
      'sourceUrl-index',
      'sourceUrl = :url',
      { ':url': 'https://example.com/article' },
    );
  });

  it('returns false when sourceUrl does not exist in DynamoDB GSI', async () => {
    const mockDb = createMockDb([]);

    const result = await checkDuplicate(mockDb, 'https://example.com/new-article');

    expect(result).toBe(false);
    expect(mockDb.queryByIndex).toHaveBeenCalledWith(
      'ContentItems',
      'sourceUrl-index',
      'sourceUrl = :url',
      { ':url': 'https://example.com/new-article' },
    );
  });

  it('returns false on DynamoDB query error (fail-open for safety)', async () => {
    const mockDb = createMockDb();
    (mockDb.queryByIndex as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('DynamoDB connection error'),
    );

    const result = await checkDuplicate(mockDb, 'https://example.com/article');

    // Should not throw — returns false so content is ingested rather than silently dropped
    expect(result).toBe(false);
  });
});
