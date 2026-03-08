// ============================================================================
// /api/settings — GET and POST routes for Dashboard configuration
// Interacts with persona.json in S3
// ============================================================================

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadPersona, personaFileSchema, createLogger } from '@insight-engine/core';
import type { PersonaFile } from '@insight-engine/core';
import { ZodError } from 'zod';

const logger = createLogger('Gatekeeper:Settings');

// Initialize S3 once
const s3Region = process.env['AWS_REGION'] ?? 'ap-south-1';
const s3Client = new S3Client({ region: s3Region });

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return val;
}

/**
 * Validates and converts the camelCase PersonaFile payload back
 * to the snake_case format expected by the system.
 */
function toSnakeCasePayload(payload: PersonaFile): string {
  const raw = {
    tone: payload.tone,
    expertise_topics: payload.expertiseTopics,
    heroes: payload.heroes,
    enemies: payload.enemies,
    platform_preferences: {
      twitter: {
        max_thread_length: payload.platformPreferences.twitter.maxThreadLength,
        hashtags: payload.platformPreferences.twitter.hashtags,
        emoji: payload.platformPreferences.twitter.emoji,
      },
      linkedin: {
        hashtags: payload.platformPreferences.linkedin.hashtags,
        emoji: payload.platformPreferences.linkedin.emoji,
      },
    },
    relevance_threshold: payload.relevanceThreshold,
    digest_schedule: payload.digestSchedule,
    monitoring_interval: payload.monitoringInterval,
    rss_feed_urls: payload.rssFeedUrls,
    arxiv_categories: payload.arxivCategories,
  };
  
  // Zod will perform exact validation to ensure no missing fields
  personaFileSchema.parse(raw);
  return JSON.stringify(raw, null, 2);
}

/**
 * GET /api/settings
 * Fetches the currently active persona.json from S3.
 */
export async function getSettings(): Promise<{ statusCode: number; body: string }> {
  try {
    const bucketName = requireEnv('PERSONA_FILES_BUCKET');
    const persona = await loadPersona('S3', 'persona.json', { bucketName, s3Client });

    return {
      statusCode: 200,
      body: JSON.stringify(persona),
    };
  } catch (error: unknown) {
    logger.error('Failed to load settings from S3', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to load persona configuration' }),
    };
  }
}

/**
 * POST /api/settings
 * Takes a JSON payload, validates it, and writes the snake_case JSON string back to S3.
 */
export async function updateSettings(bodyPayload: string): Promise<{ statusCode: number; body: string }> {
  try {
    const bucketName = requireEnv('PERSONA_FILES_BUCKET');
    const parsed: PersonaFile = JSON.parse(bodyPayload);
    
    // Convert to snake_case and validate that exact schema structure is matched.
    const jsonString = toSnakeCasePayload(parsed);

    // Write to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: 'persona.json',
        Body: jsonString,
        ContentType: 'application/json',
      })
    );

    logger.info('Successfully updated persona.json');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Settings updated successfully' }),
    };

  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON payload' }),
      };
    }
    
    if (error instanceof ZodError) {
      logger.warn('Validation error updating settings', { issues: error.issues });
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Validation failed',
          issues: error.issues,
        }),
      };
    }

    logger.error('Failed to update settings in S3', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save configuration' }),
    };
  }
}
