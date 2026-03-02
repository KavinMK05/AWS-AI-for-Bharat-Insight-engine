// ============================================================================
// Twitter Generator Tests — tweet thread generation, validation, re-prompt
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildTwitterPrompt,
  buildTwitterReprompt,
  parseTwitterResponse,
  validateTweets,
  generateTwitterThread,
} from './twitter-generator.js';

import type { ContentItem, PersonaFile, HotTake } from '@insight-engine/core';

// ---------------------------------------------------------------------------
// Mock @insight-engine/core logger
// ---------------------------------------------------------------------------
vi.mock('@insight-engine/core', async () => {
  const actual = await vi.importActual<typeof import('@insight-engine/core')>(
    '@insight-engine/core',
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-bedrock-runtime
// ---------------------------------------------------------------------------
const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  ConverseCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeHotTake(overrides: Partial<HotTake> = {}): HotTake {
  return {
    id: 'ht-001',
    contentItemId: 'item-001',
    text: 'This is a hot take about advances in transformer architecture that challenges conventional wisdom about attention mechanisms.',
    wordCount: 18,
    variationIndex: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'item-001',
    title: 'Advances in Transformer Architecture',
    author: 'Dr. Attention',
    publicationDate: new Date().toISOString(),
    sourceUrl: 'https://example.com/transformers',
    fullText: 'This paper presents novel improvements to the transformer architecture.',
    source: 'arxiv',
    ingestedAt: new Date().toISOString(),
    isDuplicate: false,
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaFile> = {}): PersonaFile {
  return {
    tone: 'technical',
    expertiseTopics: ['machine learning', 'NLP', 'transformers'],
    heroes: [{ name: 'Vaswani', description: 'Attention is all you need' }],
    enemies: [{ name: 'RNN Fan', description: 'Insists RNNs are better' }],
    platformPreferences: {
      twitter: { maxThreadLength: 5, hashtags: true, emoji: false },
      linkedin: { hashtags: true, emoji: false },
    },
    relevanceThreshold: 60,
    digestSchedule: 'daily',
    monitoringInterval: 'hourly',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTwitterPrompt', () => {
  it('includes persona tone, expertise, and article details', () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();
    const prompt = buildTwitterPrompt(hotTake, item, persona);

    expect(prompt).toContain(persona.tone);
    expect(prompt).toContain('machine learning');
    expect(prompt).toContain(hotTake.text);
    expect(prompt).toContain(item.sourceUrl);
    expect(prompt).toContain('280 characters');
  });

  it('instructs to include hashtags when enabled', () => {
    const prompt = buildTwitterPrompt(makeHotTake(), makeItem(), makePersona());
    expect(prompt).toContain('Include relevant hashtags');
    expect(prompt).not.toContain('Do NOT include any hashtags');
  });

  it('instructs to exclude hashtags when disabled', () => {
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 5, hashtags: false, emoji: false },
        linkedin: { hashtags: true, emoji: false },
      },
    });
    const prompt = buildTwitterPrompt(makeHotTake(), makeItem(), persona);
    expect(prompt).toContain('Do NOT include any hashtags');
  });

  it('instructs to exclude emoji when disabled', () => {
    const prompt = buildTwitterPrompt(makeHotTake(), makeItem(), makePersona());
    expect(prompt).toContain('Do NOT use any emoji');
  });

  it('instructs to include emoji when enabled', () => {
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 5, hashtags: true, emoji: true },
        linkedin: { hashtags: true, emoji: false },
      },
    });
    const prompt = buildTwitterPrompt(makeHotTake(), makeItem(), persona);
    expect(prompt).toContain('Use emoji where they add value');
  });

  it('includes the max thread length from persona preferences', () => {
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 10, hashtags: true, emoji: false },
        linkedin: { hashtags: true, emoji: false },
      },
    });
    const prompt = buildTwitterPrompt(makeHotTake(), makeItem(), persona);
    expect(prompt).toContain('Maximum 10 tweets');
  });

  it('requires source URL in the last tweet', () => {
    const item = makeItem({ sourceUrl: 'https://arxiv.org/abs/1234.5678' });
    const prompt = buildTwitterPrompt(makeHotTake(), item, makePersona());
    expect(prompt).toContain('https://arxiv.org/abs/1234.5678');
    expect(prompt).toContain('LAST tweet');
  });
});

describe('parseTwitterResponse', () => {
  it('parses a valid JSON array of tweet strings', () => {
    const response = '["1/ First tweet", "2/ Second tweet", "3/ Third tweet"]';
    const result = parseTwitterResponse(response);
    expect(result).toEqual(['1/ First tweet', '2/ Second tweet', '3/ Third tweet']);
  });

  it('extracts JSON array from wrapped text', () => {
    const response = 'Here are the tweets:\n["1/ Tweet one", "2/ Tweet two"]\nDone.';
    const result = parseTwitterResponse(response);
    expect(result).toEqual(['1/ Tweet one', '2/ Tweet two']);
  });

  it('returns empty array on invalid JSON', () => {
    const result = parseTwitterResponse('not json at all');
    expect(result).toEqual([]);
  });

  it('filters out non-string elements', () => {
    const response = '["valid tweet", 123, "another tweet"]';
    const result = parseTwitterResponse(response);
    expect(result).toEqual(['valid tweet', 'another tweet']);
  });
});

describe('validateTweets', () => {
  it('returns empty array when all tweets are within 280 chars', () => {
    const tweets = ['Short tweet', 'Another short tweet'];
    expect(validateTweets(tweets)).toEqual([]);
  });

  it('returns indices of tweets exceeding 280 characters', () => {
    const longTweet = 'a'.repeat(281);
    const tweets = ['Short', longTweet, 'Also short', longTweet];
    expect(validateTweets(tweets)).toEqual([1, 3]);
  });

  it('allows tweets of exactly 280 characters', () => {
    const exactTweet = 'a'.repeat(280);
    expect(validateTweets([exactTweet])).toEqual([]);
  });
});

describe('buildTwitterReprompt', () => {
  it('includes the offending tweet lengths', () => {
    const tweets = ['Short tweet', 'a'.repeat(300)];
    const reprompt = buildTwitterReprompt(tweets, [1]);
    expect(reprompt).toContain('300 characters');
    expect(reprompt).toContain('max 280');
  });
});

describe('generateTwitterThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a valid tweet thread', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    const tweets = [
      '1/ This is a great insight about transformers.',
      '2/ The attention mechanism is key.',
      '3/ Read more: https://example.com/transformers',
    ];

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify(tweets) }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateTwitterThread(hotTake, item, persona, client);

    expect(result).toHaveLength(3);
    expect(result[0]).toContain('1/');
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('re-prompts once when a tweet exceeds 280 characters', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    const longTweet = '1/ ' + 'a'.repeat(280); // 283 chars, over limit
    const validTweet = '2/ Short tweet';

    // First call returns a tweet that's too long
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify([longTweet, validTweet]) }],
        },
      },
    });

    // Re-prompt returns valid tweets
    const corrected = ['1/ Fixed short tweet', '2/ Another fixed tweet'];
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify(corrected) }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateTwitterThread(hotTake, item, persona, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe('1/ Fixed short tweet');
    expect(mockSend).toHaveBeenCalledTimes(2); // Initial + re-prompt
  });

  it('enforces max thread length from persona preferences', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 2, hashtags: true, emoji: false },
        linkedin: { hashtags: true, emoji: false },
      },
    });

    const tweets = [
      '1/ First',
      '2/ Second',
      '3/ Third (should be trimmed)',
      '4/ Fourth (should be trimmed)',
    ];

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify(tweets) }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateTwitterThread(hotTake, item, persona, client);

    expect(result).toHaveLength(2);
  });

  it('returns empty array on Bedrock error without crashing', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockRejectedValueOnce(new Error('Bedrock 500'));

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateTwitterThread(hotTake, item, persona, client);

    expect(result).toEqual([]);
  });

  it('returns empty array when no tweets are returned', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: 'Sorry, I cannot generate that.' }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateTwitterThread(hotTake, item, persona, client);

    expect(result).toEqual([]);
  });
});
