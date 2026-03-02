// ============================================================================
// Twitter/X Thread Generator — Bedrock-powered tweet thread creation
// Transforms a HotTake into a numbered Twitter thread with per-tweet
// character validation and persona preference enforcement.
// ============================================================================

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from '@insight-engine/core';
import type { ContentItem, PersonaFile, HotTake } from '@insight-engine/core';

const logger = createLogger('Ghostwriter');

/** Bedrock model ID — same as Analyst for consistency */
export const MODEL_ID = 'moonshotai.kimi-k2.5';

/** Maximum characters per tweet */
const MAX_TWEET_LENGTH = 280;

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the Twitter thread generation prompt.
 *
 * Instructs the model to produce a numbered tweet thread where each tweet
 * is ≤ 280 characters. Persona preferences (hashtags, emoji) are applied.
 * The final tweet must include the source URL.
 */
export function buildTwitterPrompt(
  hotTake: HotTake,
  contentItem: ContentItem,
  persona: PersonaFile,
): string {
  const prefs = persona.platformPreferences.twitter;
  const topics = persona.expertiseTopics.join(', ');

  const hashtagLine = prefs.hashtags
    ? '- Include relevant hashtags where appropriate'
    : '- Do NOT include any hashtags (no # symbols)';

  const emojiLine = prefs.emoji
    ? '- Use emoji where they add value'
    : '- Do NOT use any emoji characters';

  return [
    `You are a thought leader with a ${persona.tone} communication style.`,
    `Your areas of expertise: ${topics}`,
    '',
    'Transform the following hot take into a numbered Twitter/X thread.',
    '',
    `Hot take: ${hotTake.text}`,
    '',
    `Source article title: ${contentItem.title}`,
    `Source URL: ${contentItem.sourceUrl}`,
    '',
    'Requirements:',
    `- Each tweet MUST be 280 characters or fewer (this is a hard limit)`,
    `- Number each tweet (e.g. 1/, 2/, 3/)`,
    `- Maximum ${prefs.maxThreadLength} tweets in the thread`,
    hashtagLine,
    emojiLine,
    `- The LAST tweet in the thread must include this exact source URL: ${contentItem.sourceUrl}`,
    '- Be engaging and opinionated, not just a summary',
    '',
    'Respond with ONLY a JSON array of strings, where each string is one tweet. No other text:',
    '["1/ First tweet text...", "2/ Second tweet text...", "3/ Final tweet with source URL"]',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing and validation
// ---------------------------------------------------------------------------

/**
 * Parse the LLM response into an array of tweet strings.
 * Returns an empty array on parse failure.
 */
export function parseTwitterResponse(responseText: string): string[] {
  try {
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      logger.warn('No JSON array found in Twitter response');
      return [];
    }

    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) {
      logger.warn('Parsed value is not an array');
      return [];
    }

    return parsed.filter((v): v is string => typeof v === 'string');
  } catch (error: unknown) {
    logger.warn('Failed to parse Twitter response', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Validate that every tweet is within the 280-character limit.
 * Returns the indices of tweets that exceed the limit.
 */
export function validateTweets(tweets: string[]): number[] {
  return tweets
    .map((tweet, i) => (tweet.length <= MAX_TWEET_LENGTH ? -1 : i))
    .filter((i) => i !== -1);
}

/**
 * Build a corrective re-prompt when tweet length validation fails.
 */
export function buildTwitterReprompt(
  tweets: string[],
  invalidIndices: number[],
): string {
  const issues = invalidIndices
    .map((i) => {
      const tweet = tweets[i];
      const len = tweet ? tweet.length : 0;
      return `Tweet ${i + 1} has ${len} characters (max 280)`;
    })
    .join('; ');

  return [
    `The following tweets exceed the 280-character limit: ${issues}.`,
    '',
    'Please rewrite the ENTIRE thread so that every tweet is 280 characters or fewer.',
    'Keep the same number of tweets and the same content structure.',
    '',
    'Respond with ONLY a JSON array of strings, no other text:',
    '["1/ First tweet...", "2/ Second tweet...", ...]',
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
  return response.output?.message?.content?.[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a Twitter/X thread from a HotTake.
 *
 * - Requests a numbered tweet thread via a single Bedrock call
 * - Validates each tweet is ≤ 280 characters
 * - Re-prompts once if any tweet exceeds the limit
 * - Returns an array of tweet strings ready for storage
 *
 * On Bedrock error: logs the error and returns an empty array (no crash).
 */
export async function generateTwitterThread(
  hotTake: HotTake,
  contentItem: ContentItem,
  persona: PersonaFile,
  bedrockClient: BedrockRuntimeClient,
): Promise<string[]> {
  try {
    const prompt = buildTwitterPrompt(hotTake, contentItem, persona);

    const messages: Array<{
      role: 'user' | 'assistant';
      content: Array<{ text: string }>;
    }> = [{ role: 'user', content: [{ text: prompt }] }];

    // First attempt
    const firstResponse = await callBedrock(bedrockClient, messages);
    let tweets = parseTwitterResponse(firstResponse);

    if (tweets.length === 0) {
      logger.warn('Twitter thread generation returned no tweets', {
        hotTakeId: hotTake.id,
      });
      return [];
    }

    // Enforce max thread length
    const maxLen = persona.platformPreferences.twitter.maxThreadLength;
    tweets = tweets.slice(0, maxLen);

    // Validate tweet lengths
    const invalidIndices = validateTweets(tweets);

    // Re-prompt once if any tweet exceeds the limit
    if (invalidIndices.length > 0) {
      logger.info('Re-prompting for tweet length correction', {
        hotTakeId: hotTake.id,
        invalidIndices: invalidIndices.join(','),
      });

      const reprompt = buildTwitterReprompt(tweets, invalidIndices);
      messages.push(
        { role: 'assistant', content: [{ text: firstResponse }] },
        { role: 'user', content: [{ text: reprompt }] },
      );

      const secondResponse = await callBedrock(bedrockClient, messages);
      const retryTweets = parseTwitterResponse(secondResponse);

      if (retryTweets.length > 0) {
        tweets = retryTweets.slice(0, maxLen);
      }
      // If retry also fails, proceed with whatever we have
    }

    logger.info('Generated Twitter thread', {
      hotTakeId: hotTake.id,
      tweetCount: tweets.length,
      charCounts: tweets.map((t) => t.length).join(','),
    });

    return tweets;
  } catch (error: unknown) {
    logger.error('Twitter thread generation failed', {
      hotTakeId: hotTake.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
