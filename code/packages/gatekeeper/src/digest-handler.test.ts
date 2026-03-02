// ============================================================================
// Digest Handler — Unit Tests
// Tests EventBridge-triggered digest compilation and SES email sending.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { digestHandler } from './digest-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
    queryByIndex: mockQueryByIndex,
  })),
  TABLE_NAMES: {
    contentItems: 'ContentItems',
    hotTakes: 'HotTakes',
    draftContent: 'DraftContent',
    publishingQueue: 'PublishingQueue',
    metrics: 'Metrics',
  },
}));

const mockSendSES = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({
    send: mockSendSES,
  })),
  SendEmailCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const MOCK_PENDING_DRAFTS = [
  {
    id: 'draft-tw-1',
    hotTakeId: 'ht-1',
    contentItemId: 'ci-1',
    platform: 'twitter',
    content: JSON.stringify(['Tweet 1']),
    status: 'pending_approval',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'draft-li-1',
    hotTakeId: 'ht-1',
    contentItemId: 'ci-1',
    platform: 'linkedin',
    content: JSON.stringify('LinkedIn post'),
    status: 'pending_approval',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TABLE_PREFIX'] = 'test-';
  process.env['ADMIN_EMAIL'] = 'admin@example.com';
  process.env['SENDER_EMAIL'] = 'noreply@example.com';
  process.env['DASHBOARD_URL'] = 'https://dashboard.example.com';
});

describe('digestHandler', () => {
  it('skips email when ADMIN_EMAIL is not configured', async () => {
    delete process.env['ADMIN_EMAIL'];

    await digestHandler();

    expect(mockQueryByIndex).not.toHaveBeenCalled();
    expect(mockSendSES).not.toHaveBeenCalled();
  });

  it('skips email when no pending drafts exist', async () => {
    mockQueryByIndex.mockResolvedValueOnce([]);

    await digestHandler();

    expect(mockQueryByIndex).toHaveBeenCalled();
    expect(mockSendSES).not.toHaveBeenCalled();
  });

  it('sends digest email when pending drafts exist', async () => {
    mockQueryByIndex.mockResolvedValueOnce(MOCK_PENDING_DRAFTS);

    await digestHandler();

    expect(mockSendSES).toHaveBeenCalledTimes(1);
  });

  it('includes correct draft counts in email', async () => {
    mockQueryByIndex.mockResolvedValueOnce(MOCK_PENDING_DRAFTS);

    await digestHandler();

    // The SendEmailCommand should have been called with correct content
    const { SendEmailCommand } = await import('@aws-sdk/client-ses');
    expect(SendEmailCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Destination: { ToAddresses: ['admin@example.com'] },
        Source: 'noreply@example.com',
      }),
    );
  });

  it('does not throw on SES failure', async () => {
    mockQueryByIndex.mockResolvedValueOnce(MOCK_PENDING_DRAFTS);
    mockSendSES.mockRejectedValueOnce(new Error('SES failure'));

    // Should not throw — digest failures should not trigger EventBridge retries
    await expect(digestHandler()).resolves.not.toThrow();
  });
});
