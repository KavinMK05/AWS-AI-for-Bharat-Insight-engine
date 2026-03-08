// ============================================================================
// Embeddings Tests — cosine similarity + semantic duplicate detection
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Suppress logger output in tests
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Bedrock so we don't call AWS in tests
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }),
        ),
      }),
    })),
    InvokeModelCommand: vi.fn(),
  };
});

import { cosineSimilarity, checkSemanticDuplicate, generateEmbedding } from '../embeddings.js';
import type { IRdsClient } from '../rds.js';

function createMockRds(
  rows: Array<{ content_item_id: string; vector: number[] }> = [],
): IRdsClient {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
    healthCheck: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

describe('cosineSimilarity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 6);
  });

  it('returns correct value for known vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot = 4+10+18 = 32, ||a|| = sqrt(14), ||b|| = sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 6);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('throws for mismatched dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
      'Vector dimension mismatch',
    );
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('checkSemanticDuplicate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns isDuplicate: true when similarity exceeds threshold', async () => {
    const embedding = [1, 2, 3];
    const storedVectors = [
      { content_item_id: 'match-id', vector: [1, 2, 3] }, // identical → similarity = 1.0
    ];
    const mockRds = createMockRds(storedVectors);

    const result = await checkSemanticDuplicate(embedding, mockRds, 0.85);

    expect(result.isDuplicate).toBe(true);
    expect(result.matchingContentItemId).toBe('match-id');
    expect(result.similarityScore).toBeCloseTo(1.0, 4);
  });

  it('returns isDuplicate: false when no vectors exceed threshold', async () => {
    const embedding = [1, 0, 0];
    const storedVectors = [
      { content_item_id: 'other', vector: [0, 1, 0] }, // orthogonal → similarity = 0.0
    ];
    const mockRds = createMockRds(storedVectors);

    const result = await checkSemanticDuplicate(embedding, mockRds, 0.85);

    expect(result.isDuplicate).toBe(false);
    expect(result.matchingContentItemId).toBeUndefined();
  });

  it('returns isDuplicate: false when no stored embeddings exist', async () => {
    const mockRds = createMockRds([]);

    const result = await checkSemanticDuplicate([1, 2, 3], mockRds);

    expect(result.isDuplicate).toBe(false);
  });

  it('fails open on RDS error', async () => {
    const mockRds = createMockRds();
    (mockRds.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const result = await checkSemanticDuplicate([1, 2, 3], mockRds);

    expect(result.isDuplicate).toBe(false);
  });
});

describe('generateEmbedding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an embedding array from Bedrock', async () => {
    const result = await generateEmbedding('hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(5);
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});
