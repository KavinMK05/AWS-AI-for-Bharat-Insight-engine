// ============================================================================
// Config Loader — reads env vars with SSM Parameter Store fallback
// Validates all required fields at Lambda cold-start. Throws a descriptive
// named error for each missing/invalid value.
// ============================================================================

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { AppConfig } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('ConfigLoader');

/**
 * Custom error thrown when a required configuration value is missing or invalid.
 */
export class ConfigValidationError extends Error {
  public readonly variableName: string;

  constructor(variableName: string, message?: string) {
    const msg = message ?? `Missing required configuration: ${variableName}`;
    super(msg);
    this.name = 'ConfigValidationError';
    this.variableName = variableName;
  }
}

/**
 * Read a single env var. If not set, attempt to read from SSM Parameter Store.
 * If both are missing, throw a ConfigValidationError.
 */
async function getRequiredValue(
  envVar: string,
  ssmPath: string | null,
  ssmClient: SSMClient | null,
): Promise<string> {
  // 1. Try environment variable first
  const envValue = process.env[envVar];
  if (envValue !== undefined && envValue !== '') {
    return envValue;
  }

  // 2. Fall back to SSM Parameter Store
  if (ssmPath && ssmClient) {
    try {
      const result = await ssmClient.send(
        new GetParameterCommand({
          Name: ssmPath,
          WithDecryption: true,
        }),
      );
      if (result.Parameter?.Value) {
        return result.Parameter.Value;
      }
    } catch (error: unknown) {
      logger.debug(`SSM fallback failed for ${ssmPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new ConfigValidationError(envVar);
}

/**
 * Read an optional env var. Returns undefined if not set.
 */
function getOptionalValue(envVar: string): string | undefined {
  const value = process.env[envVar];
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Load and validate the full application configuration.
 *
 * Reads from environment variables first, falls back to SSM Parameter Store.
 * Throws a ConfigValidationError for each missing required value.
 *
 * Call this at Lambda cold-start (outside the handler) so failures are
 * caught immediately and reported clearly in CloudWatch.
 */
export async function loadConfig(): Promise<AppConfig> {
  const region = getOptionalValue('AWS_REGION') ?? 'ap-south-1';
  const environment = getOptionalValue('ENVIRONMENT') ?? 'dev';
  const ssmPrefix = `/insight-engine/${environment}`;

  let ssmClient: SSMClient | null = null;
  try {
    ssmClient = new SSMClient({ region });
  } catch {
    logger.warn('Failed to create SSM client — SSM fallback will not be available');
  }

  const tablePrefix = getOptionalValue('TABLE_PREFIX') ?? `${environment}-`;

  const [ingestionQueueUrl, generationQueueUrl, publishQueueUrl] = await Promise.all([
    getRequiredValue('INGESTION_QUEUE_URL', `${ssmPrefix}/ingestion-queue-url`, ssmClient),
    getRequiredValue('GENERATION_QUEUE_URL', `${ssmPrefix}/generation-queue-url`, ssmClient),
    getRequiredValue('PUBLISH_QUEUE_URL', `${ssmPrefix}/publish-queue-url`, ssmClient),
  ]);

  const [personaFilesBucket, lambdaDeploymentsBucket] = await Promise.all([
    getRequiredValue('PERSONA_FILES_BUCKET', `${ssmPrefix}/persona-files-bucket`, ssmClient),
    getRequiredValue(
      'LAMBDA_DEPLOYMENTS_BUCKET',
      `${ssmPrefix}/lambda-deployments-bucket`,
      ssmClient,
    ),
  ]);

  const adminAlertsTopic = await getRequiredValue(
    'ADMIN_ALERTS_TOPIC_ARN',
    `${ssmPrefix}/admin-alerts-topic-arn`,
    ssmClient,
  );

  const rawThreshold = getOptionalValue('RELEVANCE_THRESHOLD') ?? '60';
  const relevanceThreshold = parseInt(rawThreshold, 10);
  if (isNaN(relevanceThreshold) || relevanceThreshold < 0 || relevanceThreshold > 100) {
    throw new ConfigValidationError(
      'RELEVANCE_THRESHOLD',
      `RELEVANCE_THRESHOLD must be a number between 0 and 100, got: ${rawThreshold}`,
    );
  }

  const config: AppConfig = {
    awsRegion: region,
    environment,
    tablePrefix,
    queues: {
      ingestion: ingestionQueueUrl,
      generation: generationQueueUrl,
      publish: publishQueueUrl,
    },
    buckets: {
      personaFiles: personaFilesBucket,
      lambdaDeployments: lambdaDeploymentsBucket,
    },
    topics: {
      adminAlerts: adminAlertsTopic,
    },
    relevanceThreshold,
  };

  logger.info('Configuration loaded successfully', {
    environment,
    region,
    tablePrefix,
  });

  return config;
}
