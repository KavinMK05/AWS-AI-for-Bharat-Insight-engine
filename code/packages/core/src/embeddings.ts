// ============================================================================
// Embeddings Module — Bedrock Titan Embeddings + Cosine Similarity (Phase 8)
//
// Provides semantic duplicate detection by generating text embeddings via
// AWS Bedrock Titan and comparing with stored vectors using cosine similarity.
// ============================================================================

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from './logger.js';
import type { IRdsClient } from './rds.js';

const logger = createLogger('Embeddings');

const TITAN_MODEL_ID = 'amazon.titan-embed-text-v1';
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const MAX_RECENT_VECTORS = 500;

/**
 * Result of a semantic duplicate check.
 */
export interface SemanticDuplicateResult {
  isDuplicate: boolean;
  matchingContentItemId?: string;
  similarityScore?: number;
}

/**
 * Generate a text embedding using AWS Bedrock Titan Embeddings.
 */
export async function generateEmbedding(
  text: string,
  region: string = 'us-east-1',
): Promise<number[]> {
  const client = new BedrockRuntimeClient({ region });

  // Titan Embeddings has a 8192 token limit — truncate long texts
  const truncatedText = text.substring(0, 20000);

  const response = await client.send(
    new InvokeModelCommand({
      modelId: TITAN_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: truncatedText,
      }),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };

  if (!responseBody.embedding || !Array.isArray(responseBody.embedding)) {
    throw new Error('Invalid embedding response from Bedrock Titan');
  }

  return responseBody.embedding;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Check if a new content item is a semantic duplicate of any recent item.
 *
 * Queries the most recent embeddings from RDS and computes cosine similarity
 * against the provided embedding vector.
 */
export async function checkSemanticDuplicate(
  embedding: number[],
  rdsClient: IRdsClient,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<SemanticDuplicateResult> {
  try {
    // Fetch the most recent stored embeddings
    const result = await rdsClient.query<{
      content_item_id: string;
      vector: number[];
    }>(
      `SELECT content_item_id, vector
       FROM embeddings
       ORDER BY created_at DESC
       LIMIT $1`,
      [MAX_RECENT_VECTORS],
    );

    let bestMatch: { contentItemId: string; score: number } | null = null;

    for (const row of result.rows) {
      // The vector column is stored as float8[] — pg returns it as a number array
      const storedVector = Array.isArray(row.vector)
        ? row.vector
        : (JSON.parse(row.vector as unknown as string) as number[]);

      const similarity = cosineSimilarity(embedding, storedVector);

      if (similarity > threshold) {
        if (!bestMatch || similarity > bestMatch.score) {
          bestMatch = {
            contentItemId: row.content_item_id,
            score: similarity,
          };
        }
      }
    }

    if (bestMatch) {
      logger.info('Semantic duplicate detected', {
        matchingContentItemId: bestMatch.contentItemId,
        similarityScore: bestMatch.score.toFixed(4),
      });

      return {
        isDuplicate: true,
        matchingContentItemId: bestMatch.contentItemId,
        similarityScore: bestMatch.score,
      };
    }

    return { isDuplicate: false };
  } catch (error: unknown) {
    logger.error('Semantic duplicate check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail open — assume not duplicate rather than dropping content
    return { isDuplicate: false };
  }
}

/**
 * Store an embedding vector in RDS for future duplicate checks.
 */
export async function storeEmbedding(
  rdsClient: IRdsClient,
  contentItemId: string,
  vector: number[],
): Promise<void> {
  try {
    await rdsClient.query(
      `INSERT INTO embeddings (id, content_item_id, vector, created_at)
       VALUES (gen_random_uuid(), $1, $2, NOW())
       ON CONFLICT (content_item_id) DO UPDATE SET vector = $2, created_at = NOW()`,
      [contentItemId, vector],
    );
  } catch (error: unknown) {
    logger.error('Failed to store embedding', {
      contentItemId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw — embedding storage failure shouldn't block ingestion
  }
}
