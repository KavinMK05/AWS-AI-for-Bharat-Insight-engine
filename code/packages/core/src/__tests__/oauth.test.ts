import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthTokenSet } from '../types.ts';
import { OAuthRefreshError, OAuthTokenManager } from '../oauth.ts';

const mockSsmSend = vi.fn();
const mockSnsSend = vi.fn();

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({
    send: mockSsmSend,
  })),
  GetParameterCommand: vi.fn().mockImplementation((input: unknown) => input),
  PutParameterCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({
    send: mockSnsSend,
  })),
  PublishCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

describe('OAuthTokenManager', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns cached valid token without refresh', async () => {
    mockSsmSend
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-access' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-refresh' } });

    const manager = new OAuthTokenManager({
      region: 'ap-south-1',
      environment: 'dev',
      adminAlertTopicArn: 'arn:aws:sns:ap-south-1:123:alerts',
    });

    const token = await manager.getValidAccessToken('twitter');

    expect(token).toBe('twitter-access');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsmSend).toHaveBeenCalledTimes(2);
  });

  it('refreshes expired token and writes updated values to SSM', async () => {
    mockSsmSend
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-client-id' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-client-secret' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      }),
    });

    const manager = new OAuthTokenManager({
      region: 'ap-south-1',
      environment: 'dev',
      adminAlertTopicArn: 'arn:aws:sns:ap-south-1:123:alerts',
    });

    (manager as unknown as { tokenCache: Map<'twitter' | 'linkedin', OAuthTokenSet> }).tokenCache.set(
      'twitter',
      {
        accessToken: 'expired-access',
        refreshToken: 'existing-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        platform: 'twitter',
      },
    );

    const refreshed = await manager.refreshAccessToken('twitter');

    expect(refreshed.accessToken).toBe('new-access-token');
    expect(refreshed.refreshToken).toBe('new-refresh-token');
    expect(new Date(refreshed.expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockSsmSend).toHaveBeenCalledTimes(4);
    expect(mockSsmSend).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        Name: '/insight-engine/dev/twitter-access-token',
        Value: 'new-access-token',
        Type: 'SecureString',
        Overwrite: true,
      }),
    );
    expect(mockSsmSend).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        Name: '/insight-engine/dev/twitter-refresh-token',
        Value: 'new-refresh-token',
        Type: 'SecureString',
        Overwrite: true,
      }),
    );
  });

  it('throws OAuthRefreshError and publishes SNS alert on permanent refresh failure', async () => {
    mockSsmSend
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-client-id' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'twitter-client-secret' } });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        error: 'invalid_grant',
        error_description: 'Refresh token revoked',
      }),
    });

    const manager = new OAuthTokenManager({
      region: 'ap-south-1',
      environment: 'dev',
      adminAlertTopicArn: 'arn:aws:sns:ap-south-1:123:alerts',
    });

    (manager as unknown as { tokenCache: Map<'twitter' | 'linkedin', OAuthTokenSet> }).tokenCache.set(
      'twitter',
      {
        accessToken: 'expired-access',
        refreshToken: 'revoked-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        platform: 'twitter',
      },
    );

    await expect(manager.refreshAccessToken('twitter')).rejects.toBeInstanceOf(OAuthRefreshError);

    expect(mockSnsSend).toHaveBeenCalledOnce();
    expect(mockSnsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        TopicArn: 'arn:aws:sns:ap-south-1:123:alerts',
      }),
    );
  });
});
