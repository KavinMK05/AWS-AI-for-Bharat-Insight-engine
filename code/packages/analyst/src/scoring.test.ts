// ============================================================================
// Scoring Tests — prompt construction, recency decay, parse logic, error handling
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildScoringPrompt,
  applyRecencyDecay,
  parseScoreResponse,
  scoreContent,
  SCORING_MODEL_ID,
} from './scoring.js';

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
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'item-001',
    title: 'New Advances in Machine Learning',
    author: 'Dr. Smith',
    publicationDate: new Date().toISOString(),
    sourceUrl: 'https://example.com/ml-advances',
    fullText: 'This article discusses recent breakthroughs in deep learning...',
    source: 'rss',
    ingestedAt: new Date().toISOString(),
    isDuplicate: false,
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaFile> = {}): PersonaFile {
  return {
    tone: 'technical',
    expertiseTopics: ['machine learning', 'artificial intelligence', 'deep learning'],
    heroes: [{ name: 'Geoffrey Hinton', description: 'Pioneer of deep learning' }],
    enemies: [{ name: 'AI Skeptic', description: 'Dismisses AI progress' }],
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

describe('buildScoringPrompt', () => {
  it('includes expertise topics and article details in the prompt', () => {
    const item = makeItem();
    const persona = makePersona();
    const prompt = buildScoringPrompt(item, persona);

    expect(prompt).toContain('machine learning');
    expect(prompt).toContain('artificial intelligence');
    expect(prompt).toContain('deep learning');
    expect(prompt).toContain(item.title);
    expect(prompt).toContain(item.author);
    expect(prompt).toContain(item.fullText);
    expect(prompt).toContain('0 to 100');
    expect(prompt).toContain('JSON');
  });
});

describe('applyRecencyDecay', () => {
  it('does not apply decay for items less than 72 hours old', () => {
    const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
    const result = applyRecencyDecay(80, recentDate);

    expect(result.score).toBe(80);
    expect(result.recencyDecayApplied).toBe(false);
  });

  it('applies 0.7 decay multiplier for items older than 72 hours', () => {
    const oldDate = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(); // 96h ago
    const result = applyRecencyDecay(80, oldDate);

    expect(result.score).toBe(56); // Math.round(80 * 0.7) = 56
    expect(result.recencyDecayApplied).toBe(true);
  });

  it('handles boundary case exactly at 72 hours', () => {
    // Just over 72 hours
    const borderDate = new Date(Date.now() - 72 * 60 * 60 * 1000 - 1000).toISOString();
    const result = applyRecencyDecay(100, borderDate);

    expect(result.score).toBe(70); // Math.round(100 * 0.7)
    expect(result.recencyDecayApplied).toBe(true);
  });
});

describe('parseScoreResponse', () => {
  it('parses a valid JSON response', () => {
    const response = '{"score": 85, "reasoning": "Highly relevant to ML topics"}';
    const result = parseScoreResponse(response);

    expect(result.score).toBe(85);
    expect(result.reasoning).toBe('Highly relevant to ML topics');
  });

  it('extracts JSON from wrapped text', () => {
    const response = 'Here is my analysis:\n{"score": 72, "reasoning": "Somewhat relevant"}\nEnd.';
    const result = parseScoreResponse(response);

    expect(result.score).toBe(72);
    expect(result.reasoning).toBe('Somewhat relevant');
  });

  it('clamps score to 0-100 range', () => {
    const response = '{"score": 150, "reasoning": "Off the charts"}';
    const result = parseScoreResponse(response);

    expect(result.score).toBe(100);
  });

  it('returns score 0 on invalid JSON', () => {
    const result = parseScoreResponse('this is not json at all');

    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Failed to parse');
  });

  it('returns score 0 when JSON has no score field', () => {
    const response = '{"relevance": 85}';
    const result = parseScoreResponse(response);

    expect(result.score).toBe(0);
  });
});

describe('scoreContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Bedrock and returns parsed score with recency decay', async () => {
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: '{"score": 85, "reasoning": "Very relevant"}' }],
        },
      },
    });

    const { BedrockRuntimeClient } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await scoreContent(item, persona, client);

    expect(result.rawScore).toBe(85);
    expect(result.score).toBe(85); // Recent item, no decay
    expect(result.reasoning).toBe('Very relevant');
    expect(result.recencyDecayApplied).toBe(false);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns score 0 on Bedrock API error without crashing', async () => {
    const item = makeItem();
    const persona = makePersona();

    mockSend.mockRejectedValueOnce(new Error('Bedrock 500 Internal Server Error'));

    const { BedrockRuntimeClient } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

    const result = await scoreContent(item, persona, client);

    expect(result.score).toBe(0);
    expect(result.rawScore).toBe(0);
    expect(result.reasoning).toContain('Bedrock API error');
    expect(result.recencyDecayApplied).toBe(false);
  });
});
