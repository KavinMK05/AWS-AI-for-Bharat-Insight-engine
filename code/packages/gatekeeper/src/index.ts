// ============================================================================
// Gatekeeper Lambda Handler — HTTP API Router
// Receives API Gateway v2 (HTTP API) events and dispatches to route handlers.
// Deployed behind API Gateway with Cognito JWT authoriser on /api/* routes.
// ============================================================================

import { SQSClient } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createDynamoDBClient,
  DynamoDBClientWrapper,
} from '@insight-engine/core';

import { handleHealth } from './routes/health.js';
import { handleGetDigest } from './routes/digest.js';
import { handleApprove } from './routes/approve.js';
import { handleReject } from './routes/reject.js';
import { handleEditApprove } from './routes/edit-approve.js';

const logger = createLogger('Gatekeeper');

// ---------------------------------------------------------------------------
// API Gateway v2 (HTTP API) event types
// ---------------------------------------------------------------------------

interface APIGatewayV2Event {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  requestContext: {
    accountId: string;
    apiId: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded: boolean;
}

interface APIGatewayV2Response {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cold-start initialisation
// ---------------------------------------------------------------------------

const AWS_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

let dbWrapper: DynamoDBClientWrapper | undefined;
let sqsClient: SQSClient | undefined;

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

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Main HTTP router
// ---------------------------------------------------------------------------

/**
 * API Gateway v2 HTTP API handler for the Gatekeeper Lambda.
 *
 * Routes:
 *   GET  /health          — Health check (no auth)
 *   GET  /api/digest      — List pending drafts grouped by content item
 *   POST /api/approve     — Approve a draft for publishing
 *   POST /api/reject      — Reject a draft
 *   POST /api/edit-approve — Edit content and approve a draft
 */
export async function handler(
  event: APIGatewayV2Event,
): Promise<APIGatewayV2Response> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  logger.debug('Incoming request', { method, path, requestId: event.requestContext.requestId });

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      body: '',
      headers: CORS_HEADERS,
    };
  }

  let response: { statusCode: number; body: string };

  try {
    const db = getDBWrapper();
    const sqs = getSQSClient();
    const publishQueueUrl = process.env['PUBLISH_QUEUE_URL'] ?? '';

    if (method === 'GET' && path === '/health') {
      response = handleHealth();
    } else if (method === 'GET' && path === '/api/digest') {
      response = await handleGetDigest(db);
    } else if (method === 'POST' && path === '/api/approve') {
      response = await handleApprove(db, sqs, publishQueueUrl, event.body ?? null);
    } else if (method === 'POST' && path === '/api/reject') {
      response = await handleReject(db, event.body ?? null);
    } else if (method === 'POST' && path === '/api/edit-approve') {
      response = await handleEditApprove(db, sqs, publishQueueUrl, event.body ?? null);
    } else {
      response = {
        statusCode: 404,
        body: JSON.stringify({ error: `Route not found: ${method} ${path}` }),
      };
    }
  } catch (error: unknown) {
    logger.error('Unhandled error in request router', {
      method,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    response = {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }

  return {
    ...response,
    headers: CORS_HEADERS,
  };
}

// Also export the digest handler for the separate EventBridge-triggered Lambda
export { digestHandler } from './digest-handler.js';
