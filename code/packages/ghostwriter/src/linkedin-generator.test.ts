// ============================================================================
// LinkedIn Generator Tests — post generation, validation, re-prompt
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildLinkedInPrompt,
  buildLinkedInReprompt,
  validateLinkedInPost,
  generateLinkedInPost,
} from './linkedin-generator.js';

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

/** Generate a string of approximately the given character count */
function charsOfLength(count: number): string {
  const base = 'This is professional LinkedIn content about machine learning. ';
  let result = '';
  while (result.length < count) {
    result += base;
  }
  return result.slice(0, count);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildLinkedInPrompt', () => {
  it('includes persona tone, expertise, and article details', () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();
    const prompt = buildLinkedInPrompt(hotTake, item, persona);

    expect(prompt).toContain(persona.tone);
    expect(prompt).toContain('machine learning');
    expect(prompt).toContain(hotTake.text);
    expect(prompt).toContain(item.sourceUrl);
    expect(prompt).toContain('1300');
    expect(prompt).toContain('2000');
  });

  it('instructs to include hashtags when enabled', () => {
    const prompt = buildLinkedInPrompt(makeHotTake(), makeItem(), makePersona());
    expect(prompt).toContain('Include relevant hashtags');
    expect(prompt).not.toContain('Do NOT include any hashtags');
  });

  it('instructs to exclude hashtags when disabled', () => {
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 5, hashtags: true, emoji: false },
        linkedin: { hashtags: false, emoji: false },
      },
    });
    const prompt = buildLinkedInPrompt(makeHotTake(), makeItem(), persona);
    expect(prompt).toContain('Do NOT include any hashtags');
  });

  it('instructs to exclude emoji when disabled', () => {
    const prompt = buildLinkedInPrompt(makeHotTake(), makeItem(), makePersona());
    expect(prompt).toContain('Do NOT use any emoji');
  });

  it('instructs to include emoji when enabled', () => {
    const persona = makePersona({
      platformPreferences: {
        twitter: { maxThreadLength: 5, hashtags: true, emoji: false },
        linkedin: { hashtags: true, emoji: true },
      },
    });
    const prompt = buildLinkedInPrompt(makeHotTake(), makeItem(), persona);
    expect(prompt).toContain('Use emoji where they add value');
  });

  it('requires source attribution', () => {
    const item = makeItem({ sourceUrl: 'https://arxiv.org/abs/1234.5678' });
    const prompt = buildLinkedInPrompt(makeHotTake(), item, makePersona());
    expect(prompt).toContain('Source:');
    expect(prompt).toContain('https://arxiv.org/abs/1234.5678');
  });
});

describe('validateLinkedInPost', () => {
  it('returns valid for post within 1300-2000 characters', () => {
    const post = charsOfLength(1500);
    const result = validateLinkedInPost(post);
    expect(result.valid).toBe(true);
    expect(result.charCount).toBe(1500);
  });

  it('returns valid for post at exactly 1300 characters', () => {
    const post = charsOfLength(1300);
    const result = validateLinkedInPost(post);
    expect(result.valid).toBe(true);
  });

  it('returns valid for post at exactly 2000 characters', () => {
    const post = charsOfLength(2000);
    const result = validateLinkedInPost(post);
    expect(result.valid).toBe(true);
  });

  it('returns invalid for post below 1300 characters', () => {
    const post = charsOfLength(500);
    const result = validateLinkedInPost(post);
    expect(result.valid).toBe(false);
    expect(result.charCount).toBe(500);
  });

  it('returns invalid for post above 2000 characters', () => {
    const post = charsOfLength(2500);
    const result = validateLinkedInPost(post);
    expect(result.valid).toBe(false);
    expect(result.charCount).toBe(2500);
  });
});

describe('buildLinkedInReprompt', () => {
  it('indicates the post is too short when below minimum', () => {
    const post = charsOfLength(500);
    const reprompt = buildLinkedInReprompt(post, 500);
    expect(reprompt).toContain('too short');
    expect(reprompt).toContain('500 characters');
    expect(reprompt).toContain('1300');
  });

  it('indicates the post is too long when above maximum', () => {
    const post = charsOfLength(2500);
    const reprompt = buildLinkedInReprompt(post, 2500);
    expect(reprompt).toContain('too long');
    expect(reprompt).toContain('2500 characters');
    expect(reprompt).toContain('2000');
  });
});

describe('generateLinkedInPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a valid LinkedIn post within character bounds', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    const validPost = charsOfLength(1500);

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: validPost }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateLinkedInPost(hotTake, item, persona, client);

    expect(result.length).toBeGreaterThanOrEqual(1300);
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('re-prompts once when post is too short', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    const shortPost = charsOfLength(500);
    const correctedPost = charsOfLength(1500);

    // First call returns a post that's too short
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: shortPost }],
        },
      },
    });

    // Re-prompt returns a valid post
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: correctedPost }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateLinkedInPost(hotTake, item, persona, client);

    expect(result.length).toBe(1500);
    expect(mockSend).toHaveBeenCalledTimes(2); // Initial + re-prompt
  });

  it('re-prompts once when post is too long', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    const longPost = charsOfLength(2500);
    const correctedPost = charsOfLength(1800);

    // First call returns a post that's too long
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: longPost }],
        },
      },
    });

    // Re-prompt returns a valid post
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: correctedPost }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateLinkedInPost(hotTake, item, persona, client);

    expect(result.length).toBe(1800);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns empty string on Bedrock error without crashing', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockRejectedValueOnce(new Error('Bedrock 500'));

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateLinkedInPost(hotTake, item, persona, client);

    expect(result).toBe('');
  });

  it('returns empty string when response is empty', async () => {
    const hotTake = makeHotTake();
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: '' }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await generateLinkedInPost(hotTake, item, persona, client);

    expect(result).toBe('');
  });
});
