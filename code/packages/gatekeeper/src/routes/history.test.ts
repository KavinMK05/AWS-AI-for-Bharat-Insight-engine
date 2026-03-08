// ============================================================================
// History Route Tests — GET /api/history query building
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Suppress logger output
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

import { handleGetHistory } from './history.js';
import type { IRdsClient } from '@insight-engine/core';

function createMockRds(countResult = '0', rows: unknown[] = []): IRdsClient {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: countResult }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: rows.length }),
    healthCheck: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

describe('handleGetHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated results with no filters', async () => {
    const mockRds = createMockRds('2', [
      {
        id: '1',
        title: 'Test Post',
        platform: 'twitter',
        platform_url: 'https://x.com/post/1',
        published_at: '2024-01-15T12:00:00Z',
        content_item_id: 'ci-1',
        content_snippet: 'Hello world',
      },
    ]);

    const result = await handleGetHistory(mockRds, '');
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.results.length).toBe(1);
    expect(body.results[0].platform).toBe('twitter');
  });

  it('applies topic full-text search filter', async () => {
    const mockRds = createMockRds('0', []);
    await handleGetHistory(mockRds, 'topic=artificial+intelligence');

    const countQuery = (mockRds.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(countQuery).toContain('plainto_tsquery');
  });

  it('applies platform filter', async () => {
    const mockRds = createMockRds('0', []);
    await handleGetHistory(mockRds, 'platform=linkedin');

    const countQuery = (mockRds.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(countQuery).toContain('pp.platform');
  });

  it('applies date range filters', async () => {
    const mockRds = createMockRds('0', []);
    await handleGetHistory(mockRds, 'from=2024-01-01&to=2024-12-31');

    const queryParams = (mockRds.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(queryParams).toContain('2024-01-01');
    expect(queryParams).toContain('2024-12-31');
  });

  it('validates invalid platform', async () => {
    const mockRds = createMockRds();
    const result = await handleGetHistory(mockRds, 'platform=facebook');

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid platform');
  });

  it('handles pagination correctly', async () => {
    const mockRds = createMockRds('50', []);
    await handleGetHistory(mockRds, 'page=3&limit=10');

    const dataParams = (mockRds.query as ReturnType<typeof vi.fn>).mock.calls[1][1];
    // Should have limit=10 and offset=20
    expect(dataParams).toContain(10);
    expect(dataParams).toContain(20);
  });

  it('returns 500 on RDS error', async () => {
    const mockRds = createMockRds();
    (mockRds.query as ReturnType<typeof vi.fn>).mockReset();
    (mockRds.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const result = await handleGetHistory(mockRds, '');
    expect(result.statusCode).toBe(500);
  });
});
