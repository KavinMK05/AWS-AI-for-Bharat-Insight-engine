// ============================================================================
// GET /health — Basic health check endpoint (no auth required)
// Full component-level health checks are added in Phase 9.
// ============================================================================

import { createLogger } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

/**
 * Returns a basic health status response. Always returns HTTP 200.
 * Phase 9 will add component-level health checks (DynamoDB, SQS, Bedrock, RDS).
 */
export function handleHealth(): { statusCode: number; body: string } {
  logger.debug('Health check requested');

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      components: {
        api: 'healthy',
      },
    }),
  };
}
