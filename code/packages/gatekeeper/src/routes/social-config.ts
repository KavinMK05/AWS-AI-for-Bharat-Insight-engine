import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createLogger } from '@insight-engine/core';

const logger = createLogger('Gatekeeper:SocialConfig');

interface SocialConfigUpdateBody {
  twitterClientId?: string;
  twitterClientSecret?: string;
  linkedInClientId?: string;
  linkedInClientSecret?: string;
}

function parseBody<T>(body: string | null): T {
  if (!body) {
    throw new Error('Request body is required');
  }
  return JSON.parse(body) as T;
}

export async function handleGetSocialConfig(
  ssmClient: SSMClient,
  environment: string,
): Promise<{ statusCode: number; body: string }> {
  try {
    const params = await Promise.all([
      fetchParam(ssmClient, `/insight-engine/${environment}/twitter-client-id`),
      fetchParam(ssmClient, `/insight-engine/${environment}/twitter-client-secret`, true),
      fetchParam(ssmClient, `/insight-engine/${environment}/linkedin-client-id`),
      fetchParam(ssmClient, `/insight-engine/${environment}/linkedin-client-secret`, true),
    ]);

    const [twitterId, twitterSecret, linkedInId, linkedInSecret] = params;

    return {
      statusCode: 200,
      body: JSON.stringify({
        twitterClientId: twitterId ?? '',
        hasTwitterSecret: !!twitterSecret,
        linkedInClientId: linkedInId ?? '',
        hasLinkedInSecret: !!linkedInSecret,
      }),
    };
  } catch (error: unknown) {
    logger.error('Failed to get social config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch social configuration' }),
    };
  }
}

export async function handleUpdateSocialConfig(
  ssmClient: SSMClient,
  environment: string,
  body: string | null,
): Promise<{ statusCode: number; body: string }> {
  try {
    const parsed = parseBody<SocialConfigUpdateBody>(body);
    const updates: Promise<void>[] = [];

    if (parsed.twitterClientId !== undefined) {
      updates.push(putParam(ssmClient, `/insight-engine/${environment}/twitter-client-id`, parsed.twitterClientId, 'String'));
    }
    if (parsed.twitterClientSecret) {
      updates.push(putParam(ssmClient, `/insight-engine/${environment}/twitter-client-secret`, parsed.twitterClientSecret, 'SecureString'));
    }
    if (parsed.linkedInClientId !== undefined) {
      updates.push(putParam(ssmClient, `/insight-engine/${environment}/linkedin-client-id`, parsed.linkedInClientId, 'String'));
    }
    if (parsed.linkedInClientSecret) {
      updates.push(putParam(ssmClient, `/insight-engine/${environment}/linkedin-client-secret`, parsed.linkedInClientSecret, 'SecureString'));
    }

    await Promise.all(updates);

    logger.info('Successfully updated social configuration in SSM');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Social configuration updated successfully' }),
    };
  } catch (error: unknown) {
    logger.error('Failed to update social config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to update social configuration' }),
    };
  }
}

async function fetchParam(client: SSMClient, name: string, decrypt = false): Promise<string | null> {
  try {
    const response = await client.send(
      new GetParameterCommand({ Name: name, WithDecryption: decrypt })
    );
    return response.Parameter?.Value ?? null;
  } catch (error: any) {
    if (error.name === 'ParameterNotFound') {
      return null;
    }
    throw error;
  }
}

async function putParam(client: SSMClient, name: string, value: string, type: 'String' | 'SecureString'): Promise<void> {
  await client.send(
    new PutParameterCommand({
      Name: name,
      Value: value,
      Type: type,
      Overwrite: true,
    })
  );
}
