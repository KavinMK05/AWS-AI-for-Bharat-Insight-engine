// ============================================================================
// POST /api/reject — Update DraftContent status to 'rejected'
// ============================================================================

import type { DynamoDBClientWrapper } from '@insight-engine/core';
import type { DraftContent } from '@insight-engine/core';
import { TABLE_NAMES, createLogger } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

interface RejectBody {
  draftContentId: string;
}

/**
 * Reject a draft: update status to 'rejected'.
 */
export async function handleReject(
  db: DynamoDBClientWrapper,
  body: string | null,
): Promise<{ statusCode: number; body: string }> {
  // Validate request body
  if (!body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  let parsed: RejectBody;
  try {
    parsed = JSON.parse(body) as RejectBody;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' }),
    };
  }

  const { draftContentId } = parsed;
  if (!draftContentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'draftContentId is required' }),
    };
  }

  try {
    // Verify draft exists and is pending
    const draft = await db.getItem<DraftContent & Record<string, unknown>>(
      TABLE_NAMES.draftContent,
      { id: draftContentId },
    );

    if (!draft) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'DraftContent not found' }),
      };
    }

    if (draft.status !== 'pending_approval') {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: `Draft is not pending approval (current status: ${draft.status})`,
        }),
      };
    }

    // Update status to 'rejected'
    await db.updateItem(
      TABLE_NAMES.draftContent,
      { id: draftContentId },
      'SET #status = :status',
      { ':status': 'rejected' },
      { '#status': 'status' },
    );

    logger.info('Draft rejected', { draftContentId });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Draft rejected' }),
    };
  } catch (error: unknown) {
    logger.error('Failed to reject draft', {
      draftContentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reject draft' }),
    };
  }
}
