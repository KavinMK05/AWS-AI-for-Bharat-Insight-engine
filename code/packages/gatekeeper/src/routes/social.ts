import { Buffer } from 'node:buffer';

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { TABLE_NAMES, createLogger } from '@insight-engine/core';
import type { DynamoDBClientWrapper, Platform, SocialConnection } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

const HTTP_TIMEOUT_MS = 15_000;

const DEFAULT_EXPIRY_SECONDS: Record<Platform, number> = {
  twitter: 2 * 60 * 60,
  linkedin: 60 * 24 * 60 * 60,
};

interface SocialStatusRecord {
  connected: boolean;
  platformUsername?: string;
  connectedAt?: string;
  expiresAt?: string;
}

interface TwitterConnectBody {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

interface LinkedInConnectBody {
  code: string;
  redirectUri: string;
}

function parseBody<T>(body: string | null): T {
  if (!body) {
    throw new Error('Request body is required');
  }

  return JSON.parse(body) as T;
}

async function readClientCredentials(
  ssmClient: SSMClient,
  environment: string,
  platform: Platform,
): Promise<{ clientId: string; clientSecret: string }> {
  const [clientIdResult, clientSecretResult] = await Promise.all([
    ssmClient.send(
      new GetParameterCommand({
        Name: `/insight-engine/${environment}/${platform}-client-id`,
        WithDecryption: true,
      }),
    ),
    ssmClient.send(
      new GetParameterCommand({
        Name: `/insight-engine/${environment}/${platform}-client-secret`,
        WithDecryption: true,
      }),
    ),
  ]);

  const clientId = clientIdResult.Parameter?.Value ?? '';
  const clientSecret = clientSecretResult.Parameter?.Value ?? '';

  if (clientId.length === 0 || clientSecret.length === 0) {
    throw new Error(`Missing OAuth app credentials in SSM for ${platform}`);
  }

  return { clientId, clientSecret };
}

async function postFormUrlEncoded(
  url: string,
  body: URLSearchParams,
  headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(headers ?? {}),
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`OAuth token exchange failed (${response.status}): ${JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`Profile fetch failed (${response.status}): ${JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function buildStatusRecord(connection: SocialConnection | null): SocialStatusRecord {
  if (!connection) {
    return { connected: false };
  }

  return {
    connected: true,
    platformUsername: connection.platformUsername,
    connectedAt: connection.connectedAt,
    expiresAt: connection.expiresAt,
  };
}

export async function handleGetSocialStatus(
  db: DynamoDBClientWrapper,
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const [twitter, linkedin] = await Promise.all([
    db.getItem<SocialConnection & Record<string, unknown>>(TABLE_NAMES.socialConnections, {
      userId,
      platform: 'twitter',
    }),
    db.getItem<SocialConnection & Record<string, unknown>>(TABLE_NAMES.socialConnections, {
      userId,
      platform: 'linkedin',
    }),
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      twitter: buildStatusRecord(twitter),
      linkedin: buildStatusRecord(linkedin),
    }),
  };
}

export async function handleConnectTwitter(
  db: DynamoDBClientWrapper,
  ssmClient: SSMClient,
  environment: string,
  userId: string,
  body: string | null,
): Promise<{ statusCode: number; body: string }> {
  try {
    const parsed = parseBody<TwitterConnectBody>(body);

    if (!parsed.code || !parsed.codeVerifier || !parsed.redirectUri) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'code, codeVerifier, and redirectUri are required' }),
      };
    }

    const { clientId, clientSecret } = await readClientCredentials(ssmClient, environment, 'twitter');

    const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await postFormUrlEncoded(
      'https://api.x.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: parsed.code,
        redirect_uri: parsed.redirectUri,
        code_verifier: parsed.codeVerifier,
        client_id: clientId,
      }),
      {
        Authorization: `Basic ${basicToken}`,
      },
    );

    const accessToken =
      typeof tokenResponse['access_token'] === 'string' ? tokenResponse['access_token'] : '';
    const refreshToken =
      typeof tokenResponse['refresh_token'] === 'string' ? tokenResponse['refresh_token'] : '';
    const expiresIn =
      typeof tokenResponse['expires_in'] === 'number'
        ? tokenResponse['expires_in']
        : DEFAULT_EXPIRY_SECONDS.twitter;

    if (accessToken.length === 0 || refreshToken.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Twitter OAuth response missing token fields' }),
      };
    }

    const me = await getJson('https://api.x.com/2/users/me?user.fields=username', {
      Authorization: `Bearer ${accessToken}`,
    });

    const userData = (me['data'] as Record<string, unknown> | undefined) ?? {};
    const platformUserId = typeof userData['id'] === 'string' ? userData['id'] : undefined;
    const platformUsername =
      typeof userData['username'] === 'string' ? userData['username'] : undefined;

    const now = new Date().toISOString();

    const connection: SocialConnection = {
      userId,
      platform: 'twitter',
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      platformUserId,
      platformUsername,
      connectedAt: now,
      updatedAt: now,
    };

    await db.putItem(TABLE_NAMES.socialConnections, connection as unknown as Record<string, unknown>);

    logger.info('Connected Twitter account for user', {
      userId,
      platform: 'twitter',
      platformUserId,
      platformUsername,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Twitter account connected',
        platformUsername,
        expiresAt: connection.expiresAt,
      }),
    };
  } catch (error: unknown) {
    logger.error('Failed to connect Twitter account', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to connect Twitter account' }),
    };
  }
}

export async function handleConnectLinkedIn(
  db: DynamoDBClientWrapper,
  ssmClient: SSMClient,
  environment: string,
  userId: string,
  body: string | null,
): Promise<{ statusCode: number; body: string }> {
  try {
    const parsed = parseBody<LinkedInConnectBody>(body);

    if (!parsed.code || !parsed.redirectUri) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'code and redirectUri are required' }),
      };
    }

    const { clientId, clientSecret } = await readClientCredentials(ssmClient, environment, 'linkedin');

    const tokenResponse = await postFormUrlEncoded(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: parsed.code,
        redirect_uri: parsed.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    );

    const accessToken =
      typeof tokenResponse['access_token'] === 'string' ? tokenResponse['access_token'] : '';
    const refreshToken =
      typeof tokenResponse['refresh_token'] === 'string' ? tokenResponse['refresh_token'] : '';
    const expiresIn =
      typeof tokenResponse['expires_in'] === 'number'
        ? tokenResponse['expires_in']
        : DEFAULT_EXPIRY_SECONDS.linkedin;

    if (accessToken.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'LinkedIn OAuth response missing access token' }),
      };
    }

    let platformUserId: string | undefined;
    let platformUsername: string | undefined;

    try {
      const profile = await getJson('https://api.linkedin.com/v2/userinfo', {
        Authorization: `Bearer ${accessToken}`,
      });

      platformUserId = typeof profile['sub'] === 'string' ? profile['sub'] : undefined;
      platformUsername = typeof profile['name'] === 'string' ? profile['name'] : undefined;
    } catch {
      // Ignore profile lookup failures; token connection still succeeds.
    }

    const now = new Date().toISOString();

    const connection: SocialConnection = {
      userId,
      platform: 'linkedin',
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      platformUserId,
      platformUsername,
      connectedAt: now,
      updatedAt: now,
    };

    await db.putItem(TABLE_NAMES.socialConnections, connection as unknown as Record<string, unknown>);

    logger.info('Connected LinkedIn account for user', {
      userId,
      platform: 'linkedin',
      platformUserId,
      platformUsername,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'LinkedIn account connected',
        platformUsername,
        expiresAt: connection.expiresAt,
      }),
    };
  } catch (error: unknown) {
    logger.error('Failed to connect LinkedIn account', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to connect LinkedIn account' }),
    };
  }
}
