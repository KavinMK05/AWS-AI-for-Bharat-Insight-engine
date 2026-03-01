import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

import { loadPersona, personaFileSchema } from '../persona.js';

// ============================================================================
// Valid persona fixture (snake_case — matches the JSON file format)
// ============================================================================

function validPersonaRaw() {
  return {
    tone: 'technical',
    expertise_topics: ['artificial intelligence', 'machine learning'],
    heroes: [
      {
        name: 'Geoffrey Hinton',
        description: 'Pioneer of deep learning and neural networks',
      },
    ],
    enemies: [
      {
        name: 'AI Hype',
        description: 'Overpromising and under-delivering on AI capabilities',
      },
    ],
    platform_preferences: {
      twitter: {
        max_thread_length: 8,
        hashtags: true,
        emoji: false,
      },
      linkedin: {
        hashtags: true,
        emoji: false,
      },
    },
    relevance_threshold: 60,
    digest_schedule: 'daily',
    monitoring_interval: 'hourly',
  };
}

// ============================================================================
// Schema validation tests
// ============================================================================

describe('personaFileSchema', () => {
  it('parses a valid persona and transforms to camelCase', () => {
    const result = personaFileSchema.parse(validPersonaRaw());

    // Verify camelCase field names exist
    expect(result.tone).toBe('technical');
    expect(result.expertiseTopics).toEqual([
      'artificial intelligence',
      'machine learning',
    ]);
    expect(result.heroes).toHaveLength(1);
    expect(result.heroes[0]).toEqual(
      expect.objectContaining({ name: 'Geoffrey Hinton' }),
    );
    expect(result.enemies).toHaveLength(1);
    expect(result.enemies[0]).toEqual(
      expect.objectContaining({ name: 'AI Hype' }),
    );
    expect(result.platformPreferences.twitter.maxThreadLength).toBe(8);
    expect(result.platformPreferences.twitter.hashtags).toBe(true);
    expect(result.platformPreferences.twitter.emoji).toBe(false);
    expect(result.platformPreferences.linkedin.hashtags).toBe(true);
    expect(result.platformPreferences.linkedin.emoji).toBe(false);
    expect(result.relevanceThreshold).toBe(60);
    expect(result.digestSchedule).toBe('daily');
    expect(result.monitoringInterval).toBe('hourly');

    // Verify snake_case keys are NOT present on the output
    expect(result).not.toHaveProperty('expertise_topics');
    expect(result).not.toHaveProperty('platform_preferences');
    expect(result).not.toHaveProperty('relevance_threshold');
    expect(result).not.toHaveProperty('digest_schedule');
    expect(result).not.toHaveProperty('monitoring_interval');
  });

  it('throws a zod error referencing "tone" when tone is missing', () => {
    const raw = validPersonaRaw();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (raw as any).tone;

    expect(() => personaFileSchema.parse(raw)).toThrowError(/tone/i);
  });

  it('throws a zod error with range message when relevance_threshold > 100', () => {
    const raw = validPersonaRaw();
    raw.relevance_threshold = 150;

    expect(() => personaFileSchema.parse(raw)).toThrowError(/100/);
  });

  it('throws a zod error for an invalid tone enum value', () => {
    const raw = validPersonaRaw();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (raw as any).tone = 'aggressive';

    expect(() => personaFileSchema.parse(raw)).toThrowError(/tone/i);
  });

  it('throws a zod error when expertise_topics is empty', () => {
    const raw = validPersonaRaw();
    raw.expertise_topics = [];

    expect(() => personaFileSchema.parse(raw)).toThrowError(
      /expertise_topics/i,
    );
  });

  it('throws a zod error for invalid digest_schedule value', () => {
    const raw = validPersonaRaw();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (raw as any).digest_schedule = 'monthly';

    expect(() => personaFileSchema.parse(raw)).toThrowError(
      /digest_schedule/i,
    );
  });

  it('throws a zod error for negative relevance_threshold', () => {
    const raw = validPersonaRaw();
    raw.relevance_threshold = -5;

    expect(() => personaFileSchema.parse(raw)).toThrowError(/0/);
  });
});

// ============================================================================
// loadPersona — local file loading
// ============================================================================

describe('loadPersona — local', () => {
  it('loads and validates persona.example.json from disk', async () => {
    // Resolve the path to the actual persona.example.json at repo root
    const personaPath = resolve(
      import.meta.dirname,
      '../../../../persona.example.json',
    );

    const persona = await loadPersona('local', personaPath);

    expect(persona.tone).toBe('technical');
    expect(persona.expertiseTopics).toContain('artificial intelligence');
    expect(persona.platformPreferences.twitter.maxThreadLength).toBe(8);
    expect(persona.relevanceThreshold).toBe(60);
    expect(persona.digestSchedule).toBe('daily');
    expect(persona.monitoringInterval).toBe('hourly');
  });

  it('throws when the local file does not exist', async () => {
    await expect(
      loadPersona('local', '/nonexistent/persona.json'),
    ).rejects.toThrow();
  });
});

// ============================================================================
// loadPersona — S3 loading (mocked)
// ============================================================================

// Mock @aws-sdk/client-s3 at the module level
vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn();
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: vi.fn(),
    __mockSend: mockSend,
  };
});

describe('loadPersona — S3', () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const s3Module = await import('@aws-sdk/client-s3');
    // Access the mock send function we exposed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSend = (s3Module as any).__mockSend;
  });

  it('fetches from S3, validates, and returns a typed PersonaFile', async () => {
    const rawJson = JSON.stringify(validPersonaRaw());

    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValueOnce(rawJson),
      },
    });

    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});

    const persona = await loadPersona('S3', 'persona.json', {
      bucketName: 'test-persona-bucket',
      s3Client: client,
    });

    expect(persona.tone).toBe('technical');
    expect(persona.expertiseTopics).toEqual([
      'artificial intelligence',
      'machine learning',
    ]);
    expect(persona.relevanceThreshold).toBe(60);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('throws when PERSONA_FILES_BUCKET is not set and no bucketName provided', async () => {
    const originalBucket = process.env['PERSONA_FILES_BUCKET'];
    delete process.env['PERSONA_FILES_BUCKET'];

    await expect(loadPersona('S3', 'persona.json')).rejects.toThrow(
      /bucket name is required/i,
    );

    // Restore
    if (originalBucket !== undefined) {
      process.env['PERSONA_FILES_BUCKET'] = originalBucket;
    }
  });

  it('throws when S3 returns an empty body', async () => {
    mockSend.mockResolvedValueOnce({ Body: null });

    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});

    await expect(
      loadPersona('S3', 'persona.json', {
        bucketName: 'test-bucket',
        s3Client: client,
      }),
    ).rejects.toThrow(/body is empty/i);
  });

  it('throws a zod error when S3 returns invalid JSON content', async () => {
    const invalidJson = JSON.stringify({ tone: 'invalid-tone' });

    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValueOnce(invalidJson),
      },
    });

    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});

    await expect(
      loadPersona('S3', 'persona.json', {
        bucketName: 'test-bucket',
        s3Client: client,
      }),
    ).rejects.toThrow();
  });
});
