import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigValidationError } from '../config.js';

// Mock the AWS SDK SSM client before importing config
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockRejectedValue(new Error('SSM not available in tests')),
  })),
  GetParameterCommand: vi.fn(),
}));

describe('ConfigValidationError', () => {
  it('includes the variable name in the error', () => {
    const error = new ConfigValidationError('INGESTION_QUEUE_URL');

    expect(error.name).toBe('ConfigValidationError');
    expect(error.variableName).toBe('INGESTION_QUEUE_URL');
    expect(error.message).toContain('INGESTION_QUEUE_URL');
  });

  it('uses custom message when provided', () => {
    const error = new ConfigValidationError(
      'RELEVANCE_THRESHOLD',
      'RELEVANCE_THRESHOLD must be a number between 0 and 100, got: abc',
    );

    expect(error.variableName).toBe('RELEVANCE_THRESHOLD');
    expect(error.message).toContain('must be a number between 0 and 100');
  });
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads config from environment variables', async () => {
    process.env['AWS_REGION'] = 'ap-south-1';
    process.env['ENVIRONMENT'] = 'dev';
    process.env['INGESTION_QUEUE_URL'] = 'https://sqs.ap-south-1.amazonaws.com/123/ingestion-queue';
    process.env['GENERATION_QUEUE_URL'] =
      'https://sqs.ap-south-1.amazonaws.com/123/generation-queue';
    process.env['PUBLISH_QUEUE_URL'] = 'https://sqs.ap-south-1.amazonaws.com/123/publish-queue';
    process.env['PERSONA_FILES_BUCKET'] = 'insight-engine-dev-persona-files';
    process.env['LAMBDA_DEPLOYMENTS_BUCKET'] = 'insight-engine-dev-lambda-deployments';
    process.env['ADMIN_ALERTS_TOPIC_ARN'] =
      'arn:aws:sns:ap-south-1:123:insight-engine-dev-admin-alerts';
    process.env['RELEVANCE_THRESHOLD'] = '70';

    const { loadConfig } = await import('../config.js');
    const config = await loadConfig();

    expect(config.awsRegion).toBe('ap-south-1');
    expect(config.environment).toBe('dev');
    expect(config.queues.ingestion).toContain('ingestion-queue');
    expect(config.queues.generation).toContain('generation-queue');
    expect(config.queues.publish).toContain('publish-queue');
    expect(config.buckets.personaFiles).toBe('insight-engine-dev-persona-files');
    expect(config.buckets.lambdaDeployments).toBe('insight-engine-dev-lambda-deployments');
    expect(config.topics.adminAlerts).toContain('admin-alerts');
    expect(config.relevanceThreshold).toBe(70);
  });

  it('throws ConfigValidationError for missing required variable', async () => {
    process.env['AWS_REGION'] = 'ap-south-1';
    process.env['ENVIRONMENT'] = 'dev';
    // Deliberately omit INGESTION_QUEUE_URL

    const { loadConfig } = await import('../config.js');

    await expect(loadConfig()).rejects.toThrow('INGESTION_QUEUE_URL');
  });

  it('throws ConfigValidationError for invalid RELEVANCE_THRESHOLD', async () => {
    process.env['AWS_REGION'] = 'ap-south-1';
    process.env['ENVIRONMENT'] = 'dev';
    process.env['INGESTION_QUEUE_URL'] = 'https://sqs.example.com/ingestion';
    process.env['GENERATION_QUEUE_URL'] = 'https://sqs.example.com/generation';
    process.env['PUBLISH_QUEUE_URL'] = 'https://sqs.example.com/publish';
    process.env['PERSONA_FILES_BUCKET'] = 'persona-bucket';
    process.env['LAMBDA_DEPLOYMENTS_BUCKET'] = 'deploy-bucket';
    process.env['ADMIN_ALERTS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:topic';
    process.env['RELEVANCE_THRESHOLD'] = '150';

    const { loadConfig } = await import('../config.js');

    await expect(loadConfig()).rejects.toThrow('must be a number between 0 and 100');
  });

  it('defaults to ap-south-1 region when AWS_REGION is not set', async () => {
    delete process.env['AWS_REGION'];
    process.env['ENVIRONMENT'] = 'dev';
    process.env['INGESTION_QUEUE_URL'] = 'https://sqs.example.com/ingestion';
    process.env['GENERATION_QUEUE_URL'] = 'https://sqs.example.com/generation';
    process.env['PUBLISH_QUEUE_URL'] = 'https://sqs.example.com/publish';
    process.env['PERSONA_FILES_BUCKET'] = 'persona-bucket';
    process.env['LAMBDA_DEPLOYMENTS_BUCKET'] = 'deploy-bucket';
    process.env['ADMIN_ALERTS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:topic';

    const { loadConfig } = await import('../config.js');
    const config = await loadConfig();

    expect(config.awsRegion).toBe('ap-south-1');
  });
});
