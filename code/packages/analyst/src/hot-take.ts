// ============================================================================
// Hot Take Generation — Bedrock-powered opinionated takes
// Generates exactly 2 variations per ContentItem that passes the threshold.
// ============================================================================

import { randomUUID } from 'node:crypto';

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from '@insight-engine/core';
import type { ContentItem, PersonaFile, HotTake } from '@insight-engine/core';

import { SCORING_MODEL_ID } from './scoring.js';

const logger = createLogger('Analyst');

/**
 * Count the number of words in a string.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Validate that word count is within the required range (50–300 words).
 */
export function validateWordCount(text: string, min = 50, max = 300): boolean {
  const wc = countWords(text);
  return wc >= min && wc <= max;
}

/**
 * Build the hot take generation prompt.
 *
 * The prompt asks for exactly 2 variations as a JSON array, each between
 * 50 and 300 words, written in the persona's tone.
 */
export function buildHotTakePrompt(item: ContentItem, persona: PersonaFile): string {
  const heroes = persona.heroes.map((h) => `${h.name} (${h.description})`).join(', ');
  const enemies = persona.enemies.map((e) => `${e.name} (${e.description})`).join(', ');
  const topics = persona.expertiseTopics.join(', ');

  return [
    `You are a thought leader with a ${persona.tone} communication style.`,
    `Your areas of expertise: ${topics}`,
    heroes ? `You admire: ${heroes}` : '',
    enemies ? `You disagree with: ${enemies}` : '',
    '',
    'Based on the following article, write exactly 2 "hot take" variations — opinionated, insightful commentary that adds value beyond what the article says.',
    '',
    `Article title: ${item.title}`,
    `Article author: ${item.author}`,
    `Article summary: ${item.fullText}`,
    '',
    'Requirements:',
    '- Each variation must be between 50 and 300 words',
    '- Each should have a distinct angle or perspective',
    '- Write in the specified tone',
    '- Be opinionated and insightful, not just a summary',
    '',
    'Respond with ONLY a JSON array of exactly 2 strings, no other text:',
    '["<variation 1 text>", "<variation 2 text>"]',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Build a corrective re-prompt when word count validation fails.
 */
export function buildReprompt(
  originalVariations: string[],
  invalidIndices: number[],
): string {
  const issues = invalidIndices
    .map((i) => {
      const text = originalVariations[i];
      const wc = text ? countWords(text) : 0;
      return `Variation ${i + 1} has ${wc} words (must be between 50 and 300)`;
    })
    .join('; ');

  return [
    `The following variations have invalid word counts: ${issues}.`,
    '',
    'Please rewrite ALL variations so that each is between 50 and 300 words.',
    'Respond with ONLY a JSON array of exactly 2 strings, no other text:',
    '["<variation 1 text>", "<variation 2 text>"]',
  ].join('\n');
}

/**
 * Parse the LLM response into an array of variation strings.
 * Returns an empty array on parse failure.
 */
export function parseHotTakeResponse(responseText: string): string[] {
  try {
    // Try to extract a JSON array from the response
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      logger.warn('No JSON array found in hot take response');
      return [];
    }

    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) {
      logger.warn('Parsed value is not an array');
      return [];
    }

    const strings = parsed.filter((v): v is string => typeof v === 'string');
    return strings;
  } catch (error: unknown) {
    logger.warn('Failed to parse hot take response', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Call Bedrock to generate hot take text, returning the raw variation strings.
 */
async function callBedrock(
  bedrockClient: BedrockRuntimeClient,
  messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }>,
): Promise<string> {
  const command = new ConverseCommand({
    modelId: SCORING_MODEL_ID,
    messages,
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.7,
    },
  });

  const response = await bedrockClient.send(command);
  return response.output?.message?.content?.[0]?.text ?? '';
}

/**
 * Generate hot takes for a ContentItem that has passed the relevance threshold.
 *
 * - Requests 2 variations via a single Bedrock call
 * - Validates word count (50–300 words each)
 * - Re-prompts once if any variation is outside the word count range
 * - Returns an array of `HotTake` objects ready for DynamoDB storage
 *
 * On Bedrock error: logs the error and returns an empty array (no crash).
 */
export async function generateHotTakes(
  item: ContentItem,
  persona: PersonaFile,
  bedrockClient: BedrockRuntimeClient,
): Promise<HotTake[]> {
  try {
    const prompt = buildHotTakePrompt(item, persona);

    const messages: Array<{
      role: 'user' | 'assistant';
      content: Array<{ text: string }>;
    }> = [{ role: 'user', content: [{ text: prompt }] }];

    // First attempt
    const firstResponse = await callBedrock(bedrockClient, messages);
    let variations = parseHotTakeResponse(firstResponse);

    if (variations.length < 2) {
      logger.warn('Hot take generation returned fewer than 2 variations', {
        count: variations.length,
      });
      return [];
    }

    // Take only the first 2
    variations = variations.slice(0, 2);

    // Validate word counts
    const invalidIndices = variations
      .map((v, i) => (validateWordCount(v) ? -1 : i))
      .filter((i) => i !== -1);

    // Re-prompt once if any variation has an invalid word count
    if (invalidIndices.length > 0) {
      logger.info('Re-prompting for word count correction', {
        invalidIndices: invalidIndices.join(','),
      });

      const reprompt = buildReprompt(variations, invalidIndices);
      messages.push(
        { role: 'assistant', content: [{ text: firstResponse }] },
        { role: 'user', content: [{ text: reprompt }] },
      );

      const secondResponse = await callBedrock(bedrockClient, messages);
      const retryVariations = parseHotTakeResponse(secondResponse);

      if (retryVariations.length >= 2) {
        variations = retryVariations.slice(0, 2);
      }
      // If retry also fails validation, we proceed with whatever we have
    }

    // Build HotTake records
    const now = new Date().toISOString();
    const hotTakes: HotTake[] = variations.map((text, index) => ({
      id: randomUUID(),
      contentItemId: item.id,
      text,
      wordCount: countWords(text),
      variationIndex: index,
      createdAt: now,
    }));

    logger.info('Generated hot takes', {
      contentItemId: item.id,
      count: hotTakes.length,
      wordCounts: hotTakes.map((h) => h.wordCount).join(','),
    });

    return hotTakes;
  } catch (error: unknown) {
    logger.error('Hot take generation failed', {
      contentItemId: item.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
