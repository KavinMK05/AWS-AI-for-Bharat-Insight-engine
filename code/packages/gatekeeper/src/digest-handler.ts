// ============================================================================
// Digest Compilation Lambda — EventBridge-triggered
// Queries pending drafts, compiles a summary, and sends an HTML email via SES.
// Deployed as a separate Lambda using the same gatekeeper package zip.
// ============================================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  createLogger,
  createDynamoDBClient,
  DynamoDBClientWrapper,
  TABLE_NAMES,
} from '@insight-engine/core';
import type { DraftContent } from '@insight-engine/core';

const logger = createLogger('DigestCompiler');

// ---------------------------------------------------------------------------
// Cold-start initialisation
// ---------------------------------------------------------------------------

const AWS_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

let dbWrapper: DynamoDBClientWrapper | undefined;
let sesClient: SESClient | undefined;

function getDBWrapper(): DynamoDBClientWrapper {
  if (!dbWrapper) {
    const tablePrefix = process.env['TABLE_PREFIX'] ?? 'dev-';
    const docClient = createDynamoDBClient(AWS_REGION);
    dbWrapper = new DynamoDBClientWrapper(docClient, tablePrefix);
  }
  return dbWrapper;
}

function getSESClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: AWS_REGION });
  }
  return sesClient;
}

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------

function buildDigestEmail(
  pendingDrafts: DraftContent[],
  dashboardUrl: string,
): { subject: string; htmlBody: string } {
  const twitterCount = pendingDrafts.filter((d) => d.platform === 'twitter').length;
  const linkedinCount = pendingDrafts.filter((d) => d.platform === 'linkedin').length;
  const uniqueContentItems = new Set(pendingDrafts.map((d) => d.contentItemId)).size;

  const subject = `Insight Engine Digest: ${pendingDrafts.length} drafts pending approval`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { background: #1a1a2e; color: #ffffff; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .stat-card { background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 32px; font-weight: 700; color: #1a1a2e; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .cta-button { display: inline-block; background: #4361ee; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
    .footer { padding: 16px 24px; background: #f8f9fa; text-align: center; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insight Engine Digest</h1>
    </div>
    <div class="content">
      <p>You have <strong>${pendingDrafts.length} drafts</strong> awaiting your review.</p>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${uniqueContentItems}</div>
          <div class="stat-label">Content Items</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${twitterCount}</div>
          <div class="stat-label">Twitter Drafts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${linkedinCount}</div>
          <div class="stat-label">LinkedIn Drafts</div>
        </div>
      </div>

      <p style="text-align: center;">
        <a href="${dashboardUrl}/digest" class="cta-button">Review Digest</a>
      </p>
    </div>
    <div class="footer">
      <p>Insight Engine — Automated content pipeline</p>
      <p>Generated at ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>`.trim();

  return { subject, htmlBody };
}

// ---------------------------------------------------------------------------
// EventBridge handler
// ---------------------------------------------------------------------------

/**
 * EventBridge-triggered Lambda handler for digest compilation.
 *
 * Queries DynamoDB for all pending_approval drafts, builds an HTML
 * summary email, and sends it via SES to the configured admin address.
 */
export async function digestHandler(): Promise<void> {
  const adminEmail = process.env['ADMIN_EMAIL'];
  const senderEmail = process.env['SENDER_EMAIL'] ?? adminEmail;
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://localhost:3000';

  if (!adminEmail) {
    logger.warn('ADMIN_EMAIL not configured — skipping digest email');
    return;
  }

  if (!senderEmail) {
    logger.warn('SENDER_EMAIL not configured — skipping digest email');
    return;
  }

  const db = getDBWrapper();

  try {
    // Query all pending_approval drafts
    const pendingDrafts = await db.queryByIndex<DraftContent & Record<string, unknown>>(
      TABLE_NAMES.draftContent,
      'status-createdAt-index',
      '#status = :status',
      { ':status': 'pending_approval' },
      { '#status': 'status' },
    );

    if (pendingDrafts.length === 0) {
      logger.info('No pending drafts — skipping digest email');
      return;
    }

    // Build the email
    const { subject, htmlBody } = buildDigestEmail(
      pendingDrafts as DraftContent[],
      dashboardUrl,
    );

    // Send via SES
    const ses = getSESClient();
    await ses.send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: [adminEmail],
        },
        Source: senderEmail,
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: htmlBody, Charset: 'UTF-8' },
          },
        },
      }),
    );

    logger.info('Digest email sent', {
      recipientEmail: adminEmail,
      draftCount: pendingDrafts.length,
      uniqueContentItems: new Set(pendingDrafts.map((d) => d.contentItemId)).size,
    });
  } catch (error: unknown) {
    logger.error('Failed to compile or send digest', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not re-throw — digest failures should not trigger EventBridge retries
  }
}
