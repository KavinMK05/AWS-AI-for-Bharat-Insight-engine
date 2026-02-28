// ============================================================================
// OAuthTokenManager — Scaffold (Phase 1)
//
// Handles OAuth 2.0 token management for Twitter/X and LinkedIn:
// - Loading tokens from SSM Parameter Store
// - In-memory caching for warm Lambda invocations
// - Token expiry detection with 5-minute buffer
// - Refresh token flow (HTTP calls are TODOs — implemented in Phase 7)
// - Writing refreshed tokens back to SSM
// - SNS alerting on refresh failure
//
// IMPORTANT: Never log token values. Only log metadata (platform, expiry, etc.)
// ============================================================================

import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { OAuthTokenSet, Platform } from './types.js';
import { createLogger } from './logger.js';

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
        // Default expiry to now (forces refresh on first use if not set)
        expiresAt: new Date().toISOString(),
        platform,
      };

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

    if (expiresAt - now > EXPIRY_BUFFER_MS) {
      return tokens.accessToken;
    }

    logger.info(`Access token for ${platform} is expired or expiring soon — refreshing`);

    try {
      const refreshed = await this.refreshAccessToken(platform);
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof OAuthRefreshError) {
        throw error;
      }
      throw new OAuthRefreshError(
        platform,
        `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh the access token for a platform.
   *
   * TODO (Phase 7): Implement the actual HTTP calls to platform token endpoints.
   *
   * Twitter/X refresh:
   *   POST https://api.x.com/2/oauth2/token
   *   Content-Type: application/x-www-form-urlencoded
   *   Authorization: Basic base64(client_id:client_secret)
   *   Body: grant_type=refresh_token&refresh_token={refresh_token}
   *   Response: { access_token, refresh_token, expires_in, token_type, scope }
   *
   * LinkedIn refresh:
   *   POST https://www.linkedin.com/oauth/v2/accessToken
   *   Content-Type: application/x-www-form-urlencoded
   *   Body: grant_type=refresh_token&refresh_token={refresh_token}
   *         &client_id={client_id}&client_secret={client_secret}
   *   Response: { access_token, expires_in, refresh_token (optional) }
   *
   * On success:
   *   - Write new access_token and refresh_token back to SSM (PutParameter, Overwrite: true)
   *   - Update in-memory cache
   *   - Return new OAuthTokenSet
   *
   * On failure (401/400 from token endpoint):
   *   - Log error with { component: 'OAuthTokenManager', platform }
   *   - Publish SNS admin alert (operator must re-authorize manually)
   *   - Throw OAuthRefreshError
   */
  async refreshAccessToken(platform: Platform): Promise<OAuthTokenSet> {
    const paths = getTokenPaths(this.environment, platform);

    // Load client credentials from SSM
    const [clientIdResult, clientSecretResult] = await Promise.all([
      this.ssmClient.send(
        new GetParameterCommand({ Name: paths.clientId, WithDecryption: true }),
      ),
      this.ssmClient.send(
        new GetParameterCommand({ Name: paths.clientSecret, WithDecryption: true }),
      ),
    ]);

    const _clientId = clientIdResult.Parameter?.Value ?? '';
    const _clientSecret = clientSecretResult.Parameter?.Value ?? '';

    const currentTokens = this.tokenCache.get(platform);
    const _refreshToken = currentTokens?.refreshToken ?? '';

    // =========================================================================
    // TODO (Phase 7): Replace this block with actual HTTP refresh calls.
    //
    // if (platform === 'twitter') {
    //   const response = await fetch('https://api.x.com/2/oauth2/token', {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/x-www-form-urlencoded',
    //       'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    //     },
    //     body: new URLSearchParams({
    //       grant_type: 'refresh_token',
    //       refresh_token: refreshToken,
    //     }),
    //   });
    //   // Parse response, handle errors...
    // }
    //
    // if (platform === 'linkedin') {
    //   const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //     body: new URLSearchParams({
    //       grant_type: 'refresh_token',
    //       refresh_token: refreshToken,
    //       client_id: clientId,
    //       client_secret: clientSecret,
    //     }),
    //   });
    //   // Parse response, handle errors...
    // }
    // =========================================================================

    // For Phase 1, throw an error indicating refresh is not yet implemented
    const errorMessage = `OAuth token refresh not yet implemented for ${platform} — implement in Phase 7`;
    logger.error(errorMessage, { platform });

    // Send SNS alert
    await this.publishAlert(
      platform,
      `OAuth token refresh needed for ${platform}. Manual re-authorization required.`,
    );

    throw new OAuthRefreshError(platform, errorMessage);
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
