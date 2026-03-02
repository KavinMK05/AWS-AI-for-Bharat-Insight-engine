// ============================================================================
// Trend Detection Tests — keyword extraction, Jaccard similarity, clustering
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  extractKeywords,
  jaccardSimilarity,
  detectTrend,
} from './trend-detection.js';

import type { ContentItem } from '@insight-engine/core';

// ---------------------------------------------------------------------------
// Mock @insight-engine/core
// ---------------------------------------------------------------------------
const mockQueryByIndex = vi.fn();

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
    DynamoDBClientWrapper: vi.fn().mockImplementation(() => ({
      queryByIndex: mockQueryByIndex,
    })),
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'item-current',
    title: 'Machine Learning Advances in Healthcare',
    author: 'Dr. Test',
    publicationDate: new Date().toISOString(),
    sourceUrl: 'https://example.com/ml-health',
    fullText: 'Deep learning models are revolutionizing medical diagnostics and treatment planning.',
    source: 'rss',
    ingestedAt: new Date().toISOString(),
    isDuplicate: false,
    ...overrides,
  };
}

function makeRecentItem(id: string, title: string, fullText: string): ContentItem {
  return {
    id,
    title,
    author: 'Author',
    publicationDate: new Date().toISOString(),
    sourceUrl: `https://example.com/${id}`,
    fullText,
    source: 'rss',
    ingestedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12h ago
    isDuplicate: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('extracts significant words and filters stop words', () => {
    const keywords = extractKeywords('The quick brown fox jumps over the lazy dog');

    expect(keywords.has('quick')).toBe(true);
    expect(keywords.has('brown')).toBe(true);
    expect(keywords.has('fox')).toBe(true);
    expect(keywords.has('jumps')).toBe(true);
    expect(keywords.has('lazy')).toBe(true);
    expect(keywords.has('dog')).toBe(true);
    // Stop words should be filtered
    expect(keywords.has('the')).toBe(false);
    expect(keywords.has('over')).toBe(false);
  });

  it('lowercases all words', () => {
    const keywords = extractKeywords('Machine Learning Advances');

    expect(keywords.has('machine')).toBe(true);
    expect(keywords.has('learning')).toBe(true);
    expect(keywords.has('advances')).toBe(true);
    expect(keywords.has('Machine')).toBe(false);
  });

  it('filters out short tokens (<=2 chars)', () => {
    const keywords = extractKeywords('AI is a big deal in ML');

    expect(keywords.has('big')).toBe(true);
    expect(keywords.has('deal')).toBe(true);
    // 'AI', 'is', 'a', 'in', 'ML' are all <=2 chars or stop words
    expect(keywords.has('ai')).toBe(false);
    expect(keywords.has('ml')).toBe(false);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const set = new Set(['machine', 'learning']);
    expect(jaccardSimilarity(set, set)).toBe(1);
  });

  it('returns 0 for completely disjoint sets', () => {
    const a = new Set(['machine', 'learning']);
    const b = new Set(['cooking', 'recipes']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns correct value for partially overlapping sets', () => {
    const a = new Set(['machine', 'learning', 'deep']);
    const b = new Set(['machine', 'learning', 'fast']);
    // intersection=2, union=4, similarity=0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe('detectTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when no recent items exist', async () => {
    mockQueryByIndex.mockResolvedValueOnce([]);

    const { DynamoDBClientWrapper } = await import('@insight-engine/core');
    const db = new DynamoDBClientWrapper(null as never, 'dev-');

    const item = makeItem();
    const result = await detectTrend(item, db, 'dev-');

    expect(result).toBe(false);
  });

  it('returns false when fewer than 3 items overlap', async () => {
    // Only 1 overlapping item (need 2 overlapping + current = 3 for trending)
    mockQueryByIndex.mockResolvedValueOnce([
      makeRecentItem('item-1', 'Machine Learning in Finance', 'ML applied to stock trading'),
    ]);

    const { DynamoDBClientWrapper } = await import('@insight-engine/core');
    const db = new DynamoDBClientWrapper(null as never, 'dev-');

    const item = makeItem();
    const result = await detectTrend(item, db, 'dev-');

    expect(result).toBe(false);
  });

  it('returns true when 3 or more items share topic overlap', async () => {
    // 3 overlapping items (all about machine learning healthcare) + current = cluster of 4
    mockQueryByIndex.mockResolvedValueOnce([
      makeRecentItem(
        'item-1',
        'Machine Learning Healthcare Diagnostics',
        'Deep learning models healthcare diagnostics treatment',
      ),
      makeRecentItem(
        'item-2',
        'Healthcare Machine Learning Treatment Planning',
        'Machine learning revolutionizing healthcare treatment planning',
      ),
      makeRecentItem(
        'item-3',
        'Deep Learning Healthcare Advances',
        'Machine learning advances healthcare diagnostics deep learning',
      ),
    ]);

    const { DynamoDBClientWrapper } = await import('@insight-engine/core');
    const db = new DynamoDBClientWrapper(null as never, 'dev-');

    const item = makeItem();
    const result = await detectTrend(item, db, 'dev-');

    expect(result).toBe(true);
  });

  it('returns false gracefully on DynamoDB error', async () => {
    mockQueryByIndex.mockRejectedValueOnce(new Error('DynamoDB timeout'));

    const { DynamoDBClientWrapper } = await import('@insight-engine/core');
    const db = new DynamoDBClientWrapper(null as never, 'dev-');

    const item = makeItem();
    const result = await detectTrend(item, db, 'dev-');

    expect(result).toBe(false);
  });
});
