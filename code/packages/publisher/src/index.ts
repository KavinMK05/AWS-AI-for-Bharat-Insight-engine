import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  ChangeMessageVisibilityCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  createDynamoDBClient,
  createLogger,
  createRdsClient,
  DynamoDBClientWrapper,
  OAuthRefreshError,
  OAuthTokenManager,
  TABLE_NAMES,
} from '@insight-engine/core';
import type {
  DraftContent,
  Platform,
  PublishingQueueItem,
  SocialConnection,
  IRdsClient,
} from '@insight-engine/core';

const logger = createLogger('Publisher');

const AWS_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';
const LINKEDIN_VERSION = process.env['LINKEDIN_VERSION'] ?? getCurrentLinkedInVersion();

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const API_TIMEOUT_MS = 15_000;

interface SQSRecord {
  messageId: string;
  receiptHandle: string;
  body: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSBatchItemFailure {
  itemIdentifier: string;
}

interface SQSBatchResponse {
  batchItemFailures: SQSBatchItemFailure[];
}

interface PublishMessage {
  publishingQueueItemId: string;
}

interface PublishResult {
  platformPostId: string;
  platformPostUrl: string;
  attemptsUsed: number;
}

interface TokenProvider {
  getAccessToken(platform: Platform): Promise<string>;
  forceRefresh(platform: Platform): Promise<void>;
  getLinkedInAuthorUrn(): Promise<string>;
}

class PlatformRequestError extends Error {
  readonly statusCode?: number;
  readonly isTransient: boolean;

  constructor(message: string, options: { statusCode?: number; isTransient: boolean }) {
    super(message);
    this.name = 'PlatformRequestError';
    this.statusCode = options.statusCode;
    this.isTransient = options.isTransient;
  }
}

class PublishPermanentError extends Error {
  readonly attemptsUsed: number;

  constructor(message: string, attemptsUsed: number) {
    super(message);
    this.name = 'PublishPermanentError';
    this.attemptsUsed = attemptsUsed;
  }
}

let dbWrapper: DynamoDBClientWrapper | undefined;
let sqsClient: SQSClient | undefined;
let snsClient: SNSClient | undefined;
let ssmClient: SSMClient | undefined;
let oauthTokenManager: OAuthTokenManager | undefined;
let rdsClient: IRdsClient | undefined;

const oauthClientCache: Partial<Record<Platform, { clientId: string; clientSecret: string }>> = {};

function getCurrentLinkedInVersion(): string {
  const now = new Date();
  // Use previous month's version — the current month's version may not be released yet.
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prev.getUTCFullYear();
  const month = String(prev.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getDBWrapper(): DynamoDBClientWrapper {
  if (!dbWrapper) {
    const tablePrefix = process.env['TABLE_PREFIX'] ?? 'dev-';
    const docClient = createDynamoDBClient(AWS_REGION);
    dbWrapper = new DynamoDBClientWrapper(docClient, tablePrefix);
  }

  return dbWrapper;
}

function getSQSClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region: AWS_REGION });
  }

  return sqsClient;
}

function getSNSClient(): SNSClient {
  if (!snsClient) {
    snsClient = new SNSClient({ region: AWS_REGION });
  }

  return snsClient;
}

function getSSMClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: AWS_REGION });
  }

  return ssmClient;
}

function getRdsClient(): IRdsClient {
  if (!rdsClient) {
    const connectionString = requireEnv('RDS_CONNECTION_STRING');
    rdsClient = createRdsClient({ connectionString });
  }

  return rdsClient;
}

function getOAuthTokenManager(): OAuthTokenManager {
  if (!oauthTokenManager) {
    const environment = process.env['ENVIRONMENT'] ?? 'dev';
    const adminAlertTopicArn = requireEnv('ADMIN_ALERTS_TOPIC_ARN');

    oauthTokenManager = new OAuthTokenManager({
      region: AWS_REGION,
      environment,
      adminAlertTopicArn,
    });
  }

  return oauthTokenManager;
}

function parseTwitterDraftContent(content: string): string[] {
  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
    return parsed;
  }

  if (typeof parsed === 'string') {
    return [parsed];
  }

  throw new Error('Twitter DraftContent payload must be an array of tweets');
}

function parseLinkedInDraftContent(content: string): string {
  const parsed = JSON.parse(content) as unknown;

  if (typeof parsed === 'string') {
    return parsed;
  }

  throw new Error('LinkedIn DraftContent payload must be a string');
}

function isTransientStatus(statusCode: number): boolean {
  return statusCode >= 500 && statusCode <= 599;
}

async function executeApiCallWithRetry<T>(
  operation: string,
  performCall: () => Promise<T>,
  onUnauthorized: () => Promise<void>,
): Promise<{ result: T; attemptsUsed: number }> {
  let refreshedAfterUnauthorized = false;

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await performCall();
      return { result, attemptsUsed: attempt };
    } catch (error: unknown) {
      if (error instanceof PlatformRequestError && error.statusCode === 401) {
        if (refreshedAfterUnauthorized) {
          throw new PublishPermanentError(
            `${operation} failed after token refresh: ${error.message}`,
            attempt,
          );
        }

        try {
          await onUnauthorized();
        } catch (refreshError: unknown) {
          throw new PublishPermanentError(
            `${operation} token refresh failed: ${
              refreshError instanceof Error ? refreshError.message : String(refreshError)
            }`,
            attempt,
          );
        }
        refreshedAfterUnauthorized = true;
        continue;
      }

      const requestError =
        error instanceof PlatformRequestError
          ? error
          : new PlatformRequestError(
              `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
              { isTransient: false },
            );

      const canRetry = requestError.isTransient && attempt < RETRY_DELAYS_MS.length;

      if (canRetry) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        logger.warn(`${operation} failed, retrying`, {
          attempt,
          delayMs,
          error: requestError.message,
          statusCode: requestError.statusCode,
        });
        await sleep(delayMs);
        continue;
      }

      throw new PublishPermanentError(
        `${operation} failed after ${attempt} attempts: ${requestError.message}`,
        attempt,
      );
    }
  }

  throw new PublishPermanentError(`${operation} failed`, RETRY_DELAYS_MS.length);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ responseBody: unknown; responseHeaders: Headers }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = (await response.json().catch(() => ({}))) as unknown;

    if (!response.ok) {
      const message =
        typeof responseBody === 'object' && responseBody !== null
          ? JSON.stringify(responseBody)
          : `HTTP ${response.status}`;

      throw new PlatformRequestError(message, {
        statusCode: response.status,
        isTransient: isTransientStatus(response.status),
      });
    }

    return {
      responseBody,
      responseHeaders: response.headers,
    };
  } catch (error: unknown) {
    if (error instanceof PlatformRequestError) {
      throw error;
    }

    throw new PlatformRequestError(
      error instanceof Error ? error.message : 'Unknown network error',
      { isTransient: true },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function postFormUrlEncoded(
  url: string,
  headers: Record<string, string>,
  body: URLSearchParams,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new PlatformRequestError(JSON.stringify(responseBody), {
        statusCode: response.status,
        isTransient: isTransientStatus(response.status),
      });
    }

    return responseBody;
  } catch (error: unknown) {
    if (error instanceof PlatformRequestError) {
      throw error;
    }

    throw new PlatformRequestError(
      error instanceof Error ? error.message : 'Unknown network error',
      { isTransient: true },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isTokenValid(expiresAt: string): boolean {
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) {
    return false;
  }

  return expiry - Date.now() > 5 * 60 * 1000;
}

async function getOAuthClientCredentials(
  platform: Platform,
  environment: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const cached = oauthClientCache[platform];
  if (cached) {
    return cached;
  }

  const ssm = getSSMClient();
  const [clientIdResult, clientSecretResult] = await Promise.all([
    ssm.send(
      new GetParameterCommand({
        Name: `/insight-engine/${environment}/${platform}-client-id`,
        WithDecryption: true,
      }),
    ),
    ssm.send(
      new GetParameterCommand({
        Name: `/insight-engine/${environment}/${platform}-client-secret`,
        WithDecryption: true,
      }),
    ),
  ]);

  const clientId = clientIdResult.Parameter?.Value ?? '';
  const clientSecret = clientSecretResult.Parameter?.Value ?? '';

  if (clientId.length === 0 || clientSecret.length === 0) {
    throw new PublishPermanentError(`Missing ${platform} client credentials in SSM`, 1);
  }

  oauthClientCache[platform] = { clientId, clientSecret };
  return oauthClientCache[platform] as { clientId: string; clientSecret: string };
}

function normalizeLinkedInAuthorUrn(connection: SocialConnection | null, fallbackUrn: string): string {
  if (connection?.platformUserId) {
    if (connection.platformUserId.startsWith('urn:li:')) {
      return connection.platformUserId;
    }

    return `urn:li:person:${connection.platformUserId}`;
  }

  return fallbackUrn;
}

async function refreshUserConnection(
  db: DynamoDBClientWrapper,
  environment: string,
  userId: string,
  platform: Platform,
): Promise<SocialConnection> {
  const currentConnection = await db.getItem<SocialConnection & Record<string, unknown>>(
    TABLE_NAMES.socialConnections,
    {
      userId,
      platform,
    },
  );

  if (!currentConnection) {
    throw new PublishPermanentError(
      `No ${platform} account connected for user ${userId}. Connect account from dashboard settings.`,
      1,
    );
  }

  if (!currentConnection.refreshToken) {
    throw new PublishPermanentError(
      `Connected ${platform} account is missing refresh token for user ${userId}`,
      1,
    );
  }

  const { clientId, clientSecret } = await getOAuthClientCredentials(platform, environment);

  const refreshResponse =
    platform === 'twitter'
      ? await postFormUrlEncoded(
          'https://api.x.com/2/oauth2/token',
          {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentConnection.refreshToken,
            client_id: clientId,
          }),
        )
      : await postFormUrlEncoded(
          'https://www.linkedin.com/oauth/v2/accessToken',
          {},
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentConnection.refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        );

  const accessToken =
    typeof refreshResponse['access_token'] === 'string' ? refreshResponse['access_token'] : '';
  const refreshToken =
    typeof refreshResponse['refresh_token'] === 'string'
      ? refreshResponse['refresh_token']
      : currentConnection.refreshToken;
  const expiresIn =
    typeof refreshResponse['expires_in'] === 'number'
      ? refreshResponse['expires_in']
      : platform === 'twitter'
        ? 2 * 60 * 60
        : 60 * 24 * 60 * 60;

  if (accessToken.length === 0) {
    throw new PublishPermanentError(
      `Failed to refresh ${platform} token for user ${userId}: missing access token`,
      1,
    );
  }

  const updatedConnection: SocialConnection = {
    ...currentConnection,
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.putItem(
    TABLE_NAMES.socialConnections,
    updatedConnection as unknown as Record<string, unknown>,
  );

  return updatedConnection;
}

function createGlobalTokenProvider(
  tokenManager: OAuthTokenManager,
  linkedInAuthorUrn: string,
): TokenProvider {
  return {
    async getAccessToken(platform: Platform): Promise<string> {
      return tokenManager.getValidAccessToken(platform);
    },
    async forceRefresh(platform: Platform): Promise<void> {
      await tokenManager.refreshAccessToken(platform);
    },
    async getLinkedInAuthorUrn(): Promise<string> {
      if (linkedInAuthorUrn.length === 0) {
        throw new PublishPermanentError('Missing required environment variable: LINKEDIN_AUTHOR_URN', 1);
      }
      return linkedInAuthorUrn;
    },
  };
}

function createUserTokenProvider(
  db: DynamoDBClientWrapper,
  userId: string,
  environment: string,
  fallbackLinkedInAuthorUrn: string,
): TokenProvider {
  const cache: Partial<Record<Platform, SocialConnection>> = {};

  async function loadConnection(platform: Platform): Promise<SocialConnection> {
    if (cache[platform]) {
      return cache[platform] as SocialConnection;
    }

    const connection = await db.getItem<SocialConnection & Record<string, unknown>>(
      TABLE_NAMES.socialConnections,
      {
        userId,
        platform,
      },
    );

    if (!connection) {
      throw new PublishPermanentError(
        `No ${platform} account connected for user ${userId}. Connect account from dashboard settings.`,
        1,
      );
    }

    cache[platform] = connection;
    return connection;
  }

  return {
    async getAccessToken(platform: Platform): Promise<string> {
      const connection = await loadConnection(platform);
      if (isTokenValid(connection.expiresAt)) {
        return connection.accessToken;
      }

      const refreshed = await refreshUserConnection(db, environment, userId, platform);
      cache[platform] = refreshed;
      return refreshed.accessToken;
    },
    async forceRefresh(platform: Platform): Promise<void> {
      const refreshed = await refreshUserConnection(db, environment, userId, platform);
      cache[platform] = refreshed;
    },
    async getLinkedInAuthorUrn(): Promise<string> {
      const connection = await loadConnection('linkedin');
      const authorUrn = normalizeLinkedInAuthorUrn(connection, fallbackLinkedInAuthorUrn);

      if (!authorUrn) {
        throw new PublishPermanentError(
          `Missing LinkedIn author identifier for user ${userId}`,
          1,
        );
      }

      return authorUrn;
    },
  };
}

async function publishTwitterThread(
  draft: DraftContent,
  tokenProvider: TokenProvider,
): Promise<PublishResult> {
  const tweets = parseTwitterDraftContent(draft.content);

  if (tweets.length === 0) {
    throw new PublishPermanentError('Twitter draft has no tweets', 1);
  }

  const postedTweetIds: string[] = [];
  let attemptsUsed = 0;

  for (const tweet of tweets) {
    const publishResult = await executeApiCallWithRetry(
      'Twitter publish',
      async () => {
        const accessToken = await tokenProvider.getAccessToken('twitter');

        const payload: Record<string, unknown> = {
          text: tweet,
        };

        if (postedTweetIds.length > 0) {
          payload['reply'] = {
            in_reply_to_tweet_id: postedTweetIds[postedTweetIds.length - 1],
          };
        }

        const response = await postJson(
          'https://api.x.com/2/tweets',
          {
            Authorization: `Bearer ${accessToken}`,
          },
          payload,
        );

        const body = response.responseBody as Record<string, unknown>;
        const data = body['data'] as Record<string, unknown> | undefined;
        const tweetId = typeof data?.['id'] === 'string' ? data['id'] : '';

        if (tweetId.length === 0) {
          throw new PlatformRequestError('Twitter API response missing tweet ID', {
            isTransient: false,
          });
        }

        return tweetId;
      },
      async () => {
        await tokenProvider.forceRefresh('twitter');
      },
    );

    attemptsUsed += publishResult.attemptsUsed;
    postedTweetIds.push(publishResult.result);
  }

  const firstTweetId = postedTweetIds[0];
  if (!firstTweetId) {
    throw new PublishPermanentError('Twitter thread publish did not return a post ID', attemptsUsed);
  }

  return {
    platformPostId: firstTweetId,
    platformPostUrl: `https://x.com/i/web/status/${firstTweetId}`,
    attemptsUsed,
  };
}

async function publishLinkedInPost(
  draft: DraftContent,
  tokenProvider: TokenProvider,
): Promise<PublishResult> {
  const authorUrn = await tokenProvider.getLinkedInAuthorUrn();

  if (authorUrn.length === 0) {
    throw new PublishPermanentError('Missing required environment variable: LINKEDIN_AUTHOR_URN', 1);
  }

  const content = parseLinkedInDraftContent(draft.content);

  const publishResult = await executeApiCallWithRetry(
    'LinkedIn publish',
    async () => {
      const accessToken = await tokenProvider.getAccessToken('linkedin');

      const response = await postJson(
        'https://api.linkedin.com/rest/posts',
        {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Linkedin-Version': LINKEDIN_VERSION,
        },
        {
          author: authorUrn,
          commentary: content,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
          },
          lifecycleState: 'PUBLISHED',
        },
      );

      const headerPostId = response.responseHeaders.get('x-restli-id');
      const responseRecord = response.responseBody as Record<string, unknown>;
      const bodyPostId = typeof responseRecord['id'] === 'string' ? responseRecord['id'] : '';
      const platformPostId = headerPostId ?? bodyPostId;

      if (platformPostId.length === 0) {
        throw new PlatformRequestError('LinkedIn API response missing post ID', {
          isTransient: false,
        });
      }

      return platformPostId;
    },
    async () => {
      await tokenProvider.forceRefresh('linkedin');
    },
  );

  return {
    platformPostId: publishResult.result,
    platformPostUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(publishResult.result)}`,
    attemptsUsed: publishResult.attemptsUsed,
  };
}

async function getLastPublishedAt(
  db: DynamoDBClientWrapper,
  platform: Platform,
): Promise<string | undefined> {
  const publishedItems = await db.queryByIndex<PublishingQueueItem & Record<string, unknown>>(
    TABLE_NAMES.publishingQueue,
    'platform-status-index',
    'platform = :platform AND #status = :status',
    {
      ':platform': platform,
      ':status': 'published',
    },
    {
      '#status': 'status',
    },
  );

  let latest: string | undefined;

  for (const item of publishedItems) {
    if (!item.publishedAt) {
      continue;
    }

    if (!latest || new Date(item.publishedAt).getTime() > new Date(latest).getTime()) {
      latest = item.publishedAt;
    }
  }

  return latest;
}

async function delayMessageForRateLimit(
  sqs: SQSClient,
  queueUrl: string,
  receiptHandle: string,
  waitSeconds: number,
): Promise<void> {
  await sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: waitSeconds,
    }),
  );
}

async function publishAdminAlert(
  sns: SNSClient,
  topicArn: string,
  queueItem: PublishingQueueItem,
  errorMessage: string,
): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: `[Insight Engine] Publisher Failure: ${queueItem.platform}`,
      Message: JSON.stringify(
        {
          publishingQueueItemId: queueItem.id,
          platform: queueItem.platform,
          errorMessage,
        },
        null,
        2,
      ),
    }),
  );
}

async function markPublishingFailure(
  db: DynamoDBClientWrapper,
  sns: SNSClient,
  topicArn: string,
  queueItem: PublishingQueueItem,
  errorMessage: string,
  retryCount: number,
): Promise<void> {
  await db.updateItem(
    TABLE_NAMES.publishingQueue,
    { id: queueItem.id },
    'SET #status = :status, errorMessage = :errorMessage, retryCount = :retryCount',
    {
      ':status': 'failed',
      ':errorMessage': errorMessage,
      ':retryCount': retryCount,
    },
    {
      '#status': 'status',
    },
  );

  await publishAdminAlert(sns, topicArn, queueItem, errorMessage);
}

async function writePublishedPostToRds(
  queueItem: PublishingQueueItem,
  draft: DraftContent,
  platformPostUrl: string,
  publishedAt: string,
): Promise<void> {
  const snippet = draft.content.slice(0, 280);

  await getRdsClient().query(
    'INSERT INTO published_posts (id, platform, content_snippet, url, published_at, content_item_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [queueItem.id, queueItem.platform, snippet, platformPostUrl, publishedAt, queueItem.contentItemId],
  );
}

async function processRecord(
  record: SQSRecord,
  db: DynamoDBClientWrapper,
  sqs: SQSClient,
  sns: SNSClient,
  tokenManager: OAuthTokenManager,
  environment: string,
  publishQueueUrl: string,
  adminTopicArn: string,
  linkedInAuthorUrn: string,
): Promise<'success' | 'retry'> {
  const message = JSON.parse(record.body) as PublishMessage;

  if (!message.publishingQueueItemId) {
    logger.warn('Publish message missing publishingQueueItemId', { body: record.body });
    return 'success';
  }

  const queueItem = await db.getItem<PublishingQueueItem & Record<string, unknown>>(
    TABLE_NAMES.publishingQueue,
    {
      id: message.publishingQueueItemId,
    },
  );

  if (!queueItem) {
    logger.warn('PublishingQueueItem not found', {
      publishingQueueItemId: message.publishingQueueItemId,
    });
    return 'success';
  }

  const draft = await db.getItem<DraftContent & Record<string, unknown>>(TABLE_NAMES.draftContent, {
    id: queueItem.draftContentId,
  });

  if (!draft) {
    await markPublishingFailure(
      db,
      sns,
      adminTopicArn,
      queueItem,
      `DraftContent not found: ${queueItem.draftContentId}`,
      1,
    );
    return 'success';
  }

  if (queueItem.status === 'published') {
    logger.info('PublishingQueueItem already published, skipping', {
      publishingQueueItemId: queueItem.id,
    });
    return 'success';
  }

  if (queueItem.status === 'failed') {
    logger.info('PublishingQueueItem already failed, skipping', {
      publishingQueueItemId: queueItem.id,
    });
    return 'success';
  }

  const lastPublishedAt = await getLastPublishedAt(db, queueItem.platform);

  if (lastPublishedAt) {
    const elapsedMs = Date.now() - new Date(lastPublishedAt).getTime();

    if (elapsedMs < RATE_LIMIT_WINDOW_MS) {
      const waitSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsedMs) / 1000);

      await delayMessageForRateLimit(sqs, publishQueueUrl, record.receiptHandle, waitSeconds);

      logger.info('Rate limit delay applied', {
        publishingQueueItemId: queueItem.id,
        platform: queueItem.platform,
        waitSeconds,
      });

      return 'retry';
    }
  }

  await db.updateItem(
    TABLE_NAMES.publishingQueue,
    { id: queueItem.id },
    'SET #status = :status',
    {
      ':status': 'publishing',
    },
    {
      '#status': 'status',
    },
  );

  try {
    const ownerUserId =
      typeof queueItem['ownerUserId'] === 'string' ? queueItem['ownerUserId'] : undefined;

    const tokenProvider = ownerUserId
      ? createUserTokenProvider(db, ownerUserId, environment, linkedInAuthorUrn)
      : createGlobalTokenProvider(tokenManager, linkedInAuthorUrn);

    const publishResult =
      queueItem.platform === 'twitter'
        ? await publishTwitterThread(draft, tokenProvider)
        : await publishLinkedInPost(draft, tokenProvider);

    const publishedAt = new Date().toISOString();

    await db.updateItem(
      TABLE_NAMES.publishingQueue,
      { id: queueItem.id },
      'SET #status = :status, publishedAt = :publishedAt, platformPostId = :platformPostId, platformPostUrl = :platformPostUrl, retryCount = :retryCount REMOVE errorMessage',
      {
        ':status': 'published',
        ':publishedAt': publishedAt,
        ':platformPostId': publishResult.platformPostId,
        ':platformPostUrl': publishResult.platformPostUrl,
        ':retryCount': publishResult.attemptsUsed,
      },
      {
        '#status': 'status',
      },
    );

    try {
      await writePublishedPostToRds(queueItem, draft, publishResult.platformPostUrl, publishedAt);
    } catch (error: unknown) {
      logger.warn('Failed to write published post to RDS', {
        publishingQueueItemId: queueItem.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Publishing completed successfully', {
      publishingQueueItemId: queueItem.id,
      platform: queueItem.platform,
      platformPostId: publishResult.platformPostId,
      platformPostUrl: publishResult.platformPostUrl,
    });

    return 'success';
  } catch (error: unknown) {
    if (error instanceof OAuthRefreshError || error instanceof PublishPermanentError) {
      const retryCount = error instanceof PublishPermanentError ? error.attemptsUsed : 1;
      await markPublishingFailure(
        db,
        sns,
        adminTopicArn,
        queueItem,
        error.message,
        retryCount,
      );

      logger.error('Publishing failed permanently', {
        publishingQueueItemId: queueItem.id,
        platform: queueItem.platform,
        error: error.message,
      });

      return 'success';
    }

    throw error;
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const environment = process.env['ENVIRONMENT'] ?? 'dev';
  const publishQueueUrl = requireEnv('PUBLISH_QUEUE_URL');
  const adminTopicArn = requireEnv('ADMIN_ALERTS_TOPIC_ARN');
  const linkedInAuthorUrn = process.env['LINKEDIN_AUTHOR_URN'] ?? '';

  const db = getDBWrapper();
  const sqs = getSQSClient();
  const sns = getSNSClient();
  const tokenManager = getOAuthTokenManager();

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const outcome = await processRecord(
        record,
        db,
        sqs,
        sns,
        tokenManager,
        environment,
        publishQueueUrl,
        adminTopicArn,
        linkedInAuthorUrn,
      );

      if (outcome === 'retry') {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } catch (error: unknown) {
      logger.error('Unhandled publisher error for SQS record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
