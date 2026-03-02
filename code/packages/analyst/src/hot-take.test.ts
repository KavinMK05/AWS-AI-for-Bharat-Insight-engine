// ============================================================================
// Hot Take Tests — generation, word count, re-prompt, parse logic
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  countWords,
  validateWordCount,
  buildHotTakePrompt,
  buildReprompt,
  parseHotTakeResponse,
  generateHotTakes,
} from './hot-take.js';

import type { ContentItem, PersonaFile } from '@insight-engine/core';

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
// Mock node:crypto
// ---------------------------------------------------------------------------
let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: () => `hot-take-${++uuidCounter}`,
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'item-001',
    title: 'Advances in Transformer Architecture',
    author: 'Dr. Attention',
    publicationDate: new Date().toISOString(),
    sourceUrl: 'https://example.com/transformers',
    fullText: 'This paper presents novel improvements to the transformer architecture for NLP tasks.',
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

/** Generate a string with approximately the given word count */
function wordsOfLength(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts words correctly', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('one two three four five')).toBe(5);
    expect(countWords('  spaced   out  ')).toBe(2);
    expect(countWords('')).toBe(0);
  });
});

describe('validateWordCount', () => {
  it('returns true for text within 50-300 words', () => {
    expect(validateWordCount(wordsOfLength(100))).toBe(true);
    expect(validateWordCount(wordsOfLength(50))).toBe(true);
    expect(validateWordCount(wordsOfLength(300))).toBe(true);
  });

  it('returns false for text below 50 words', () => {
    expect(validateWordCount(wordsOfLength(10))).toBe(false);
    expect(validateWordCount(wordsOfLength(49))).toBe(false);
  });

  it('returns false for text above 300 words', () => {
    expect(validateWordCount(wordsOfLength(301))).toBe(false);
    expect(validateWordCount(wordsOfLength(500))).toBe(false);
  });
});

describe('buildHotTakePrompt', () => {
  it('includes persona details and article summary', () => {
    const item = makeItem();
    const persona = makePersona();
    const prompt = buildHotTakePrompt(item, persona);

    expect(prompt).toContain(persona.tone);
    expect(prompt).toContain('machine learning');
    expect(prompt).toContain('Vaswani');
    expect(prompt).toContain('RNN Fan');
    expect(prompt).toContain(item.title);
    expect(prompt).toContain('exactly 2');
    expect(prompt).toContain('50 and 300 words');
  });
});

describe('buildReprompt', () => {
  it('includes the invalid word count details', () => {
    const variations = [wordsOfLength(10), wordsOfLength(100)];
    const reprompt = buildReprompt(variations, [0]);

    expect(reprompt).toContain('10 words');
    expect(reprompt).toContain('between 50 and 300');
  });
});

describe('parseHotTakeResponse', () => {
  it('parses a valid JSON array of strings', () => {
    const response = '["First hot take text here.", "Second hot take text here."]';
    const result = parseHotTakeResponse(response);

    expect(result).toEqual(['First hot take text here.', 'Second hot take text here.']);
  });

  it('extracts JSON array from wrapped text', () => {
    const response = 'Here are your hot takes:\n["Take one", "Take two"]\nDone.';
    const result = parseHotTakeResponse(response);

    expect(result).toEqual(['Take one', 'Take two']);
  });

  it('returns empty array on invalid JSON', () => {
    const result = parseHotTakeResponse('not json at all');
    expect(result).toEqual([]);
  });

  it('filters out non-string array elements', () => {
    const response = '["valid", 123, "also valid"]';
    const result = parseHotTakeResponse(response);

    expect(result).toEqual(['valid', 'also valid']);
  });
});

describe('generateHotTakes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  it('generates 2 hot takes with valid word counts', async () => {
    const item = makeItem();
    const persona = makePersona();

    const take1 = wordsOfLength(100);
    const take2 = wordsOfLength(150);

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify([take1, take2]) }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const hotTakes = await generateHotTakes(item, persona, client);

    expect(hotTakes).toHaveLength(2);
    expect(hotTakes[0]?.contentItemId).toBe('item-001');
    expect(hotTakes[0]?.variationIndex).toBe(0);
    expect(hotTakes[1]?.variationIndex).toBe(1);
    expect(hotTakes[0]?.wordCount).toBe(100);
    expect(hotTakes[1]?.wordCount).toBe(150);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('re-prompts once when word count is invalid', async () => {
    const item = makeItem();
    const persona = makePersona();

    const shortTake = wordsOfLength(10); // Too short
    const validTake = wordsOfLength(100);

    // First call returns an invalid variation
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify([shortTake, validTake]) }],
        },
      },
    });

    // Re-prompt returns two valid variations
    const corrected1 = wordsOfLength(120);
    const corrected2 = wordsOfLength(130);
    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify([corrected1, corrected2]) }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const hotTakes = await generateHotTakes(item, persona, client);

    expect(hotTakes).toHaveLength(2);
    expect(hotTakes[0]?.wordCount).toBe(120);
    expect(hotTakes[1]?.wordCount).toBe(130);
    expect(mockSend).toHaveBeenCalledTimes(2); // Initial + re-prompt
  });

  it('returns empty array on Bedrock error without crashing', async () => {
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockRejectedValueOnce(new Error('Bedrock 500'));

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const hotTakes = await generateHotTakes(item, persona, client);

    expect(hotTakes).toEqual([]);
  });

  it('returns empty array when fewer than 2 variations are returned', async () => {
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: '["only one variation"]' }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const hotTakes = await generateHotTakes(item, persona, client);

    expect(hotTakes).toEqual([]);
  });
});
