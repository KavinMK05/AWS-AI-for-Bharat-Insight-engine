// ============================================================================
// Scoring — Bedrock-based relevance scoring with recency decay
// Uses Claude 3.5 Sonnet via the Bedrock Converse API.
// ============================================================================

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from '@insight-engine/core';
import type { ContentItem, PersonaFile, RelevanceScore } from '@insight-engine/core';

const logger = createLogger('Analyst');

/** Bedrock model ID for MiniMax M2 */
export const SCORING_MODEL_ID = 'openai.gpt-oss-safeguard-120b';

/** Items older than this (in ms) receive a recency decay penalty */
const RECENCY_DECAY_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

/** Multiplier applied to raw score for stale items */
const RECENCY_DECAY_FACTOR = 0.7;

/**
 * Build the scoring prompt for the LLM.
 *
 * The prompt asks the model to return a JSON object with `score` (0-100) and
 * `reasoning` (string). The persona's expertise topics provide context for
 * what is considered relevant.
 */
export function buildScoringPrompt(item: ContentItem, persona: PersonaFile): string {
  const topics = persona.expertiseTopics.join(', ');

  return [
    'You are a relevance scoring engine. Your task is to evaluate how relevant an article is to a specific set of expertise topics.',
    '',
    `Expertise topics: ${topics}`,
    '',
    `Article title: ${item.title}`,
    `Article author: ${item.author}`,
    `Article summary: ${item.fullText}`,
    '',
    'Score the article from 0 to 100 based on how relevant it is to the expertise topics listed above.',
    '- 0 means completely irrelevant',
    '- 100 means perfectly aligned with the expertise topics',
    '',
    'Respond with ONLY a JSON object in this exact format, no other text:',
    '{"score": <integer 0-100>, "reasoning": "<one sentence explaining the score>"}',
  ].join('\n');
}

/**
 * Determine whether recency decay should be applied and compute the final score.
 */
export function applyRecencyDecay(
  rawScore: number,
  publicationDate: string,
): { score: number; recencyDecayApplied: boolean } {
  const pubTime = new Date(publicationDate).getTime();
  const now = Date.now();
  const ageMs = now - pubTime;

  if (ageMs > RECENCY_DECAY_THRESHOLD_MS) {
    return {
      score: Math.round(rawScore * RECENCY_DECAY_FACTOR),
      recencyDecayApplied: true,
    };
  }

  return { score: rawScore, recencyDecayApplied: false };
}

/**
 * Parse the LLM response text into a score and reasoning.
 * Falls back to score 0 with a generic reasoning on any parse error.
 */
export function parseScoreResponse(responseText: string): { score: number; reasoning: string } {
  try {
    // Try to extract JSON from the response — handle wrapped text
    const jsonMatch = responseText.match(/\{[\s\S]*?"score"\s*:\s*\d+[\s\S]*?\}/);
    if (!jsonMatch) {
      logger.warn('No JSON object found in scoring response', { responseText });
      return { score: 0, reasoning: 'Failed to parse model response' };
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'score' in parsed &&
      typeof (parsed as Record<string, unknown>)['score'] === 'number'
    ) {
      const obj = parsed as { score: number; reasoning?: string };
      const score = Math.max(0, Math.min(100, Math.round(obj.score)));
      const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : 'No reasoning provided';
      return { score, reasoning };
    }

    logger.warn('Parsed JSON missing required score field', { parsed });
    return { score: 0, reasoning: 'Failed to parse model response' };
  } catch (error: unknown) {
    logger.warn('JSON parse error in scoring response', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { score: 0, reasoning: 'Failed to parse model response' };
  }
}

/**
 * Score a ContentItem against the persona using AWS Bedrock (Kimi K2.5).
 *
 * On any Bedrock API error the score is set to 0 and no exception is thrown.
 * This follows the AGENTS.md error handling rule: "On any Bedrock error, log
 * the error, set relevanceScore to 0, and return without re-throwing."
 */
export async function scoreContent(
  item: ContentItem,
  persona: PersonaFile,
  bedrockClient: BedrockRuntimeClient,
): Promise<RelevanceScore> {
  const prompt = buildScoringPrompt(item, persona);

  try {
    const command = new ConverseCommand({
      modelId: SCORING_MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 256,
        temperature: 0.1,
      },
    });

    const response = await bedrockClient.send(command);

    const responseText =
      response.output?.message?.content?.[0]?.text ?? '';

    const { score: rawScore, reasoning } = parseScoreResponse(responseText);
    const { score, recencyDecayApplied } = applyRecencyDecay(rawScore, item.publicationDate);

    logger.info('Scored content item', {
      contentItemId: item.id,
      rawScore,
      finalScore: score,
      recencyDecayApplied: String(recencyDecayApplied),
    });

    return { score, reasoning, recencyDecayApplied, rawScore };
  } catch (error: unknown) {
    logger.error('Bedrock scoring failed — defaulting to score 0', {
      contentItemId: item.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      score: 0,
      reasoning: 'Bedrock API error — score defaulted to 0',
      recencyDecayApplied: false,
      rawScore: 0,
    };
  }
}
