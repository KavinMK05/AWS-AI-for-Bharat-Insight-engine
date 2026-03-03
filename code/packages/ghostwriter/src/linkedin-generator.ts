// ============================================================================
// LinkedIn Post Generator — Bedrock-powered professional post creation
// Transforms a HotTake into a single LinkedIn post with character count
// validation and persona preference enforcement.
// ============================================================================

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from '@insight-engine/core';
import type { ContentItem, PersonaFile, HotTake } from '@insight-engine/core';

import { MODEL_ID } from './twitter-generator.js';

const logger = createLogger('Ghostwriter');

/** Minimum character count for a LinkedIn post */
const MIN_LINKEDIN_LENGTH = 1300;

/** Maximum character count for a LinkedIn post */
const MAX_LINKEDIN_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the LinkedIn post generation prompt.
 *
 * Instructs the model to produce a single professional LinkedIn post
 * between 1300 and 2000 characters. Persona preferences (hashtags, emoji)
 * are applied. Source attribution is appended at the end.
 */
export function buildLinkedInPrompt(
  hotTake: HotTake,
  contentItem: ContentItem,
  persona: PersonaFile,
): string {
  const prefs = persona.platformPreferences.linkedin;
  const topics = persona.expertiseTopics.join(', ');

  const hashtagLine = prefs.hashtags
    ? '- Include relevant hashtags at the end of the post'
    : '- Do NOT include any hashtags (no # symbols)';

  const emojiLine = prefs.emoji
    ? '- Use emoji where they add value'
    : '- Do NOT use any emoji characters';

  return [
    `You are a thought leader with a ${persona.tone} communication style.`,
    `Your areas of expertise: ${topics}`,
    '',
    'Write a professional LinkedIn post based on the following hot take.',
    '',
    `Hot take: ${hotTake.text}`,
    '',
    `Source article title: ${contentItem.title}`,
    `Source URL: ${contentItem.sourceUrl}`,
    '',
    'Requirements:',
    `- The post MUST be between ${MIN_LINKEDIN_LENGTH} and ${MAX_LINKEDIN_LENGTH} characters (this is a hard limit)`,
    '- Write in a professional, engaging tone suitable for LinkedIn',
    hashtagLine,
    emojiLine,
    `- End the post with source attribution: "Source: ${contentItem.sourceUrl}"`,
    '- Be insightful and thought-provoking, not just a summary',
    '- Use paragraph breaks for readability',
    '',
    'Respond with ONLY the LinkedIn post text. No JSON wrapping, no additional commentary.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that the LinkedIn post is within the required character count range.
 */
export function validateLinkedInPost(post: string): {
  valid: boolean;
  charCount: number;
} {
  const charCount = post.length;
  return {
    valid: charCount >= MIN_LINKEDIN_LENGTH && charCount <= MAX_LINKEDIN_LENGTH,
    charCount,
  };
}

/**
 * Build a corrective re-prompt when character count validation fails.
 */
export function buildLinkedInReprompt(post: string, charCount: number): string {
  const direction =
    charCount < MIN_LINKEDIN_LENGTH
      ? `too short (${charCount} characters, minimum is ${MIN_LINKEDIN_LENGTH})`
      : `too long (${charCount} characters, maximum is ${MAX_LINKEDIN_LENGTH})`;

  return [
    `The LinkedIn post is ${direction}.`,
    '',
    `Please rewrite the post so it is between ${MIN_LINKEDIN_LENGTH} and ${MAX_LINKEDIN_LENGTH} characters.`,
    charCount < MIN_LINKEDIN_LENGTH
      ? 'Add more detail, examples, or analysis to reach the minimum length.'
      : 'Condense the content while keeping the key insights.',
    '',
    'Respond with ONLY the LinkedIn post text. No JSON wrapping, no additional commentary.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Bedrock call
// ---------------------------------------------------------------------------

async function callBedrock(
  bedrockClient: BedrockRuntimeClient,
  messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }>,
): Promise<string> {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages,
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.7,
    },
  });

  const response = await bedrockClient.send(command);
  return response.output?.message?.content?.[1]?.text ?? '';
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a LinkedIn post from a HotTake.
 *
 * - Requests a professional post via a single Bedrock call
 * - Validates character count is between 1300 and 2000
 * - Re-prompts once if outside the range
 * - Returns the post text ready for storage
 *
 * On Bedrock error: logs the error and returns an empty string (no crash).
 */
export async function generateLinkedInPost(
  hotTake: HotTake,
  contentItem: ContentItem,
  persona: PersonaFile,
  bedrockClient: BedrockRuntimeClient,
): Promise<string> {
  try {
    const prompt = buildLinkedInPrompt(hotTake, contentItem, persona);

    const messages: Array<{
      role: 'user' | 'assistant';
      content: Array<{ text: string }>;
    }> = [{ role: 'user', content: [{ text: prompt }] }];

    // First attempt
    const firstResponse = await callBedrock(bedrockClient, messages);
    let post = firstResponse.trim();

    if (post.length === 0) {
      logger.warn('LinkedIn post generation returned empty response', {
        hotTakeId: hotTake.id,
      });
      return '';
    }

    // Validate character count
    const { valid, charCount } = validateLinkedInPost(post);

    // Re-prompt once if outside range
    if (!valid) {
      logger.info('Re-prompting for LinkedIn character count correction', {
        hotTakeId: hotTake.id,
        charCount,
      });

      const reprompt = buildLinkedInReprompt(post, charCount);
      messages.push(
        { role: 'assistant', content: [{ text: firstResponse }] },
        { role: 'user', content: [{ text: reprompt }] },
      );

      const secondResponse = await callBedrock(bedrockClient, messages);
      const retryPost = secondResponse.trim();

      if (retryPost.length > 0) {
        post = retryPost;
      }
      // If retry also fails validation, proceed with whatever we have
    }

    logger.info('Generated LinkedIn post', {
      hotTakeId: hotTake.id,
      charCount: post.length,
    });

    return post;
  } catch (error: unknown) {
    logger.error('LinkedIn post generation failed', {
      hotTakeId: hotTake.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
