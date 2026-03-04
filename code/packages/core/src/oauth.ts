import { Buffer } from 'node:buffer';

import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { createLogger } from './logger.js';
import type { OAuthTokenSet, Platform } from './types.js';

const logger = createLogger('OAuthTokenManager');

/** Thrown when an OAuth token refresh fails permanently */
export class OAuthRefreshError extends Error {
  public readonly platform: Platform;

  constructor(platform: Platform, message: string) {
    super(message);
    this.name = 'OAuthRefreshError';
    this.platform = platform;
  }
}

/** Buffer before expiry to trigger proactive refresh (5 minutes) */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const HTTP_TIMEOUT_MS = 15_000;

const TWITTER_DEFAULT_EXPIRES_IN_SECONDS = 2 * 60 * 60;
const LINKEDIN_DEFAULT_EXPIRES_IN_SECONDS = 60 * 24 * 60 * 60;

const DEFAULT_EXPIRES_IN_SECONDS: Record<Platform, number> = {
  twitter: TWITTER_DEFAULT_EXPIRES_IN_SECONDS,
  linkedin: LINKEDIN_DEFAULT_EXPIRES_IN_SECONDS,
};

interface OAuthRefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}

class OAuthHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'OAuthHttpError';
    this.statusCode = statusCode;
  }
}

/**
 * SSM parameter paths for OAuth tokens.
 */
function getTokenPaths(environment: string, platform: Platform) {
  const prefix = `/insight-engine/${environment}`;
  return {
    clientId: `${prefix}/${platform}-client-id`,
    clientSecret: `${prefix}/${platform}-client-secret`,
    accessToken: `${prefix}/${platform}-access-token`,
    refreshToken: `${prefix}/${platform}-refresh-token`,
  };
}

export class OAuthTokenManager {
  private readonly ssmClient: SSMClient;
  private readonly snsClient: SNSClient;
  private readonly environment: string;
  private readonly adminAlertTopicArn: string;

  /** In-memory token cache — persists across warm Lambda invocations */
  private tokenCache: Map<Platform, OAuthTokenSet> = new Map();

  constructor(options: {
    region: string;
    environment: string;
    adminAlertTopicArn: string;
  }) {
    this.ssmClient = new SSMClient({ region: options.region });
    this.snsClient = new SNSClient({ region: options.region });
    this.environment = options.environment;
    this.adminAlertTopicArn = options.adminAlertTopicArn;
  }

  /**
   * Load OAuth tokens from SSM Parameter Store for a given platform.
   * Caches tokens in memory for subsequent calls during the same Lambda invocation.
   */
  async loadTokens(platform: Platform): Promise<OAuthTokenSet> {
    // Return cached tokens if available
    const cached = this.tokenCache.get(platform);
    if (cached) {
      logger.debug(`Using cached tokens for ${platform}`);
      return cached;
    }

    const paths = getTokenPaths(this.environment, platform);

    try {
      const [accessTokenResult, refreshTokenResult] = await Promise.all([
        this.ssmClient.send(
          new GetParameterCommand({ Name: paths.accessToken, WithDecryption: true }),
        ),
        this.ssmClient.send(
          new GetParameterCommand({ Name: paths.refreshToken, WithDecryption: true }),
        ),
      ]);

      const tokenSet: OAuthTokenSet = {
        accessToken: accessTokenResult.Parameter?.Value ?? '',
        refreshToken: refreshTokenResult.Parameter?.Value ?? '',
        expiresAt: new Date(
          Date.now() + DEFAULT_EXPIRES_IN_SECONDS[platform] * 1000,
        ).toISOString(),
        platform,
      };

      if (tokenSet.accessToken.length === 0) {
        throw new Error(`Missing access token in SSM for ${platform}`);
      }

      if (tokenSet.refreshToken.length === 0) {
        throw new Error(`Missing refresh token in SSM for ${platform}`);
      }

      this.tokenCache.set(platform, tokenSet);
      logger.info(`Loaded tokens for ${platform} from SSM`);
      return tokenSet;
    } catch (error: unknown) {
      logger.error(`Failed to load tokens for ${platform}`, {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a valid (non-expired) access token for a platform.
   * If the token is expired or within the 5-minute buffer, triggers a refresh.
   */
  async getValidAccessToken(platform: Platform): Promise<string> {
    const tokens = await this.loadTokens(platform);

    // Check if token is still valid (with buffer)
    const expiresAt = new Date(tokens.expiresAt).getTime();
    const now = Date.now();

    if (Number.isFinite(expiresAt) && expiresAt - now > EXPIRY_BUFFER_MS) {
      return tokens.accessToken;
    }

    logger.info(`Access token for ${platform} is expired or expiring soon — refreshing`);

    const refreshed = await this.refreshAccessToken(platform);
    return refreshed.accessToken;
  }

  /**
   * Refreshes the current platform token using the refresh token grant,
   * persists new token values to SSM, and updates the in-memory cache.
   */
  async refreshAccessToken(platform: Platform): Promise<OAuthTokenSet> {
    const paths = getTokenPaths(this.environment, platform);

    const currentTokens = await this.loadTokens(platform);

    if (currentTokens.refreshToken.length === 0) {
      const message = `Missing refresh token for ${platform}`;
      await this.publishAlert(platform, message);
      throw new OAuthRefreshError(platform, message);
    }

    // Load client credentials from SSM
    const [clientIdResult, clientSecretResult] = await Promise.all([
      this.ssmClient.send(
        new GetParameterCommand({ Name: paths.clientId, WithDecryption: true }),
      ),
      this.ssmClient.send(
        new GetParameterCommand({ Name: paths.clientSecret, WithDecryption: true }),
      ),
    ]);

    const clientId = clientIdResult.Parameter?.Value ?? '';
    const clientSecret = clientSecretResult.Parameter?.Value ?? '';

    if (clientId.length === 0 || clientSecret.length === 0) {
      const message = `Missing OAuth client credentials for ${platform}`;
      await this.publishAlert(platform, message);
      throw new OAuthRefreshError(platform, message);
    }

    try {
      const response =
        platform === 'twitter'
          ? await this.refreshTwitterToken(currentTokens.refreshToken, clientId, clientSecret)
          : await this.refreshLinkedInToken(currentTokens.refreshToken, clientId, clientSecret);

      const expiresInSeconds =
        response.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS[platform];

      const tokenSet: OAuthTokenSet = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? currentTokens.refreshToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        platform,
      };

      await this.writeTokensToSSM(platform, tokenSet);

      logger.info(`Successfully refreshed token for ${platform}`, {
        platform,
        expiresAt: tokenSet.expiresAt,
      });

      return tokenSet;
    } catch (error: unknown) {
      const statusCode = error instanceof OAuthHttpError ? error.statusCode : undefined;
      const message = error instanceof Error ? error.message : String(error);

      logger.error(`Failed to refresh token for ${platform}`, {
        platform,
        statusCode,
        error: message,
      });

      if (statusCode === 400 || statusCode === 401) {
        await this.publishAlert(
          platform,
          `OAuth refresh failed for ${platform}. Manual re-authorization required. ${message}`,
        );
        throw new OAuthRefreshError(platform, message);
      }

      throw error;
    }
  }

  private async refreshTwitterToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthRefreshResponse> {
    const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const payload = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString();

    const response = await this.postFormUrlEncoded(
      'https://api.x.com/2/oauth2/token',
      {
        Authorization: `Basic ${authorization}`,
      },
      payload,
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresInSeconds: response.expires_in,
    };
  }

  private async refreshLinkedInToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthRefreshResponse> {
    const payload = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const response = await this.postFormUrlEncoded(
      'https://www.linkedin.com/oauth/v2/accessToken',
      {},
      payload,
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresInSeconds: response.expires_in,
    };
  }

  private async postFormUrlEncoded(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      const raw = (await response.json()) as unknown;

      if (!response.ok) {
        throw new OAuthHttpError(
          response.status,
          `Token endpoint error (${response.status}): ${this.sanitiseOAuthError(raw)}`,
        );
      }

      if (!this.isTokenResponse(raw)) {
        throw new Error('Token endpoint returned unexpected response shape');
      }

      return raw;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isTokenResponse(
    value: unknown,
  ): value is { access_token: string; refresh_token?: string; expires_in?: number } {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const record = value as Record<string, unknown>;

    if (typeof record['access_token'] !== 'string') {
      return false;
    }

    if (
      'refresh_token' in record &&
      record['refresh_token'] !== undefined &&
      typeof record['refresh_token'] !== 'string'
    ) {
      return false;
    }

    if (
      'expires_in' in record &&
      record['expires_in'] !== undefined &&
      typeof record['expires_in'] !== 'number'
    ) {
      return false;
    }

    return true;
  }

  private sanitiseOAuthError(value: unknown): string {
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const error = typeof record['error'] === 'string' ? record['error'] : undefined;
      const description =
        typeof record['error_description'] === 'string'
          ? record['error_description']
          : undefined;
      const message = typeof record['message'] === 'string' ? record['message'] : undefined;

      return [error, description, message].filter((item) => item !== undefined).join(' | ');
    }

    if (typeof value === 'string') {
      return value;
    }

    return 'Unknown OAuth token endpoint error';
  }

  /**
   * Write refreshed tokens back to SSM Parameter Store.
   * Called after a successful token refresh in Phase 7.
   */
  async writeTokensToSSM(platform: Platform, tokenSet: OAuthTokenSet): Promise<void> {
    const paths = getTokenPaths(this.environment, platform);

    try {
      await Promise.all([
        this.ssmClient.send(
          new PutParameterCommand({
            Name: paths.accessToken,
            Value: tokenSet.accessToken,
            Type: 'SecureString',
            Overwrite: true,
          }),
        ),
        this.ssmClient.send(
          new PutParameterCommand({
            Name: paths.refreshToken,
            Value: tokenSet.refreshToken,
            Type: 'SecureString',
            Overwrite: true,
          }),
        ),
      ]);

      // Update in-memory cache
      this.tokenCache.set(platform, tokenSet);
      logger.info(`Updated tokens in SSM for ${platform}`);
    } catch (error: unknown) {
      logger.error(`Failed to write tokens to SSM for ${platform}`, {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Publish an admin alert via SNS when token refresh fails.
   */
  private async publishAlert(platform: Platform, message: string): Promise<void> {
    try {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.adminAlertTopicArn,
          Subject: `[Insight Engine] OAuth Alert: ${platform}`,
          Message: message,
        }),
      );
      logger.info(`Published SNS alert for ${platform}`);
    } catch (error: unknown) {
      // Don't throw — alerting failure should not break the main flow
      logger.error(`Failed to publish SNS alert for ${platform}`, {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clear the in-memory token cache (useful for testing).
   */
  clearCache(): void {
    this.tokenCache.clear();
  }
}
