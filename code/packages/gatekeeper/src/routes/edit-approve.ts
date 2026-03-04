// ============================================================================
// POST /api/edit-approve — Store edited content, update status to 'approved',
// create PublishingQueueItem, publish to SQS
// ============================================================================

import { randomUUID } from 'node:crypto';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DynamoDBClientWrapper } from '@insight-engine/core';
import type { DraftContent, PublishingQueueItem } from '@insight-engine/core';
import { TABLE_NAMES, createLogger } from '@insight-engine/core';

const logger = createLogger('Gatekeeper');

interface EditApproveBody {
  draftContentId: string;
  editedContent: string;
}

/**
 * Edit and approve a draft: store edited content, update status,
 * create PublishingQueueItem, publish to SQS.
 */
export async function handleEditApprove(
  db: DynamoDBClientWrapper,
  sqsClient: SQSClient,
  publishQueueUrl: string,
  ownerUserId: string,
  body: string | null,
): Promise<{ statusCode: number; body: string }> {
  // Validate request body
  if (!body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  let parsed: EditApproveBody;
  try {
    parsed = JSON.parse(body) as EditApproveBody;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' }),
    };
  }

  const { draftContentId, editedContent } = parsed;
  if (!draftContentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'draftContentId is required' }),
    };
  }
  if (!editedContent) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'editedContent is required' }),
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

    // Update content and status
    await db.updateItem(
      TABLE_NAMES.draftContent,
      { id: draftContentId },
      'SET #status = :status, content = :content',
      { ':status': 'approved', ':content': editedContent },
      { '#status': 'status' },
    );

    // Create PublishingQueueItem
    const publishingQueueItem: PublishingQueueItem = {
      id: randomUUID(),
      draftContentId: draft.id,
      contentItemId: draft.contentItemId,
      platform: draft.platform,
      ownerUserId,
      status: 'queued',
      queuedAt: new Date().toISOString(),
    };

    await db.putItem(
      TABLE_NAMES.publishingQueue,
      publishingQueueItem as unknown as Record<string, unknown>,
    );

    // Publish to SQS publish-queue
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: publishQueueUrl,
        MessageBody: JSON.stringify({
          publishingQueueItemId: publishingQueueItem.id,
        }),
      }),
    );

    logger.info('Draft edited, approved, and queued for publishing', {
      draftContentId,
      publishingQueueItemId: publishingQueueItem.id,
      platform: draft.platform,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Draft edited and approved',
        publishingQueueItemId: publishingQueueItem.id,
      }),
    };
  } catch (error: unknown) {
    logger.error('Failed to edit-approve draft', {
      draftContentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to edit and approve draft' }),
    };
  }
}
