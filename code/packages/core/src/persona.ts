// ============================================================================
// Persona Configuration — Zod Schema & Loader
// Validates snake_case JSON input and transforms to camelCase PersonaFile.
// ============================================================================

import { readFile } from 'node:fs/promises';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

import type { PersonaFile } from './types.js';

// ============================================================================
// Zod Schema — validates the raw snake_case JSON shape
// ============================================================================

const personaFigureSchema = z.object({
  name: z
    .string()
    .min(1, { message: 'name must be a non-empty string' }),
  description: z
    .string()
    .min(1, { message: 'description must be a non-empty string' }),
});

/**
 * Zod schema for the raw PersonaFile JSON (snake_case keys).
 * Validates every field with descriptive error messages, then transforms
 * the output to the camelCase `PersonaFile` TypeScript interface.
 */
export const personaFileSchema = z
  .object({
    tone: z.enum(['formal', 'casual', 'technical', 'humorous'], {
      message:
        'tone must be one of: "formal", "casual", "technical", "humorous"',
    }),

    expertise_topics: z
      .array(
        z.string().min(1, {
          message: 'each expertise topic must be a non-empty string',
        }),
      )
      .min(1, {
        message: 'expertise_topics must contain at least one topic',
      }),

    heroes: z.array(personaFigureSchema),

    enemies: z.array(personaFigureSchema),

    platform_preferences: z.object({
      twitter: z.object({
        max_thread_length: z
          .number()
          .int({ message: 'max_thread_length must be an integer' })
          .min(1, { message: 'max_thread_length must be at least 1' })
          .max(25, { message: 'max_thread_length must be at most 25' }),
        hashtags: z.boolean({
          message: 'twitter.hashtags must be a boolean',
        }),
        emoji: z.boolean({
          message: 'twitter.emoji must be a boolean',
        }),
      }),
      linkedin: z.object({
        hashtags: z.boolean({
          message: 'linkedin.hashtags must be a boolean',
        }),
        emoji: z.boolean({
          message: 'linkedin.emoji must be a boolean',
        }),
      }),
    }),

    relevance_threshold: z
      .number({
        message: 'relevance_threshold must be a number',
      })
      .int({ message: 'relevance_threshold must be an integer' })
      .min(0, { message: 'relevance_threshold must be at least 0' })
      .max(100, { message: 'relevance_threshold must be at most 100' }),

    digest_schedule: z.enum(['daily', 'twice-daily', 'weekly'], {
      message:
        'digest_schedule must be one of: "daily", "twice-daily", "weekly"',
    }),

    monitoring_interval: z.enum(['hourly', 'every-6h', 'daily'], {
      message:
        'monitoring_interval must be one of: "hourly", "every-6h", "daily"',
    }),
  })
  .transform(
    (raw): PersonaFile => ({
      tone: raw.tone,
      expertiseTopics: raw.expertise_topics,
      heroes: raw.heroes,
      enemies: raw.enemies,
      platformPreferences: {
        twitter: {
          maxThreadLength: raw.platform_preferences.twitter.max_thread_length,
          hashtags: raw.platform_preferences.twitter.hashtags,
          emoji: raw.platform_preferences.twitter.emoji,
        },
        linkedin: {
          hashtags: raw.platform_preferences.linkedin.hashtags,
          emoji: raw.platform_preferences.linkedin.emoji,
        },
      },
      relevanceThreshold: raw.relevance_threshold,
      digestSchedule: raw.digest_schedule,
      monitoringInterval: raw.monitoring_interval,
    }),
  );

// ============================================================================
// Persona Loader
// ============================================================================

/**
 * Load and validate a PersonaFile from either S3 or the local filesystem.
 *
 * @param source - Where to load from: `'S3'` fetches from the persona-files
 *   bucket, `'local'` reads from disk.
 * @param path - For `'S3'`: the S3 object key (e.g. `"persona.json"`).
 *   For `'local'`: the absolute or relative file path.
 * @param options - Optional overrides for S3 bucket name and client.
 * @returns A validated, camelCase-typed `PersonaFile` object.
 * @throws {z.ZodError} if the JSON does not match the schema.
 * @throws {Error} if the file cannot be read or parsed.
 */
export async function loadPersona(
  source: 'S3' | 'local',
  path: string,
  options?: {
    /** S3 bucket name — required when source is 'S3' */
    bucketName?: string;
    /** Override the S3 client (useful for testing) */
    s3Client?: S3Client;
  },
): Promise<PersonaFile> {
  const rawJson = await readRawJson(source, path, options);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error(
      `Failed to parse persona file as JSON (source: ${source}, path: ${path})`,
    );
  }

  // Zod validates the snake_case shape and transforms to camelCase PersonaFile.
  // On validation failure, ZodError is thrown with descriptive per-field messages.
  return personaFileSchema.parse(parsed);
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function readRawJson(
  source: 'S3' | 'local',
  path: string,
  options?: {
    bucketName?: string;
    s3Client?: S3Client;
  },
): Promise<string> {
  if (source === 'local') {
    return readFile(path, { encoding: 'utf-8' });
  }

  // S3 source
  const bucketName = options?.bucketName ?? process.env['PERSONA_FILES_BUCKET'];
  if (!bucketName) {
    throw new Error(
      'S3 bucket name is required: pass options.bucketName or set PERSONA_FILES_BUCKET env var',
    );
  }

  const client = options?.s3Client ?? new S3Client({});
  const command = new GetObjectCommand({ Bucket: bucketName, Key: path });
  const response = await client.send(command);

  if (!response.Body) {
    throw new Error(
      `S3 object body is empty (bucket: ${bucketName}, key: ${path})`,
    );
  }

  return response.Body.transformToString('utf-8');
}
