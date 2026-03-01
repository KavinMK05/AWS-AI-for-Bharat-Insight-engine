// ============================================================================
// RSS Monitor Tests — unit tests for RSS feed fetching and parsing
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock rss-parser before importing the module under test
vi.mock('rss-parser', () => {
  const MockRssParser = vi.fn();
  MockRssParser.prototype.parseURL = vi.fn();
  return { default: MockRssParser };
});

// Suppress logger output in tests
vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import RssParser from 'rss-parser';
import { fetchRssItems } from './rss-monitor.js';

describe('fetchRssItems', () => {
  const mockParseURL = RssParser.prototype.parseURL as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid RSS feed into correct IngestionCandidate shape', async () => {
    mockParseURL.mockResolvedValueOnce({
      items: [
        {
          title: 'Test Article',
          creator: 'John Doe',
          isoDate: '2026-02-28T10:00:00Z',
          link: 'https://example.com/article-1',
          contentSnippet: 'This is a test article about AI.',
        },
      ],
    });

    const results = await fetchRssItems(['https://example.com/feed.xml']);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: 'Test Article',
      author: 'John Doe',
      publicationDate: '2026-02-28T10:00:00Z',
      sourceUrl: 'https://example.com/article-1',
      fullText: 'This is a test article about AI.',
      source: 'rss',
    });
  });

  it('handles multi-item feeds and returns all items', async () => {
    mockParseURL.mockResolvedValueOnce({
      items: [
        {
          title: 'Article 1',
          author: 'Author A',
          isoDate: '2026-02-28T10:00:00Z',
          link: 'https://example.com/1',
          contentSnippet: 'First article.',
        },
        {
          title: 'Article 2',
          creator: 'Author B',
          pubDate: 'Sat, 28 Feb 2026 12:00:00 GMT',
          link: 'https://example.com/2',
          content: 'Second article content.',
        },
        {
          title: 'Article 3',
          link: 'https://example.com/3',
          summary: 'Third article summary.',
        },
      ],
    });

    const results = await fetchRssItems(['https://example.com/feed.xml']);

    expect(results).toHaveLength(3);

    const first = results[0];
    const second = results[1];
    const third = results[2];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(first?.title).toBe('Article 1');
    expect(first?.author).toBe('Author A');
    expect(second?.title).toBe('Article 2');
    expect(second?.author).toBe('Author B');
    expect(second?.fullText).toBe('Second article content.');
    expect(third?.author).toBe('Unknown');
    expect(third?.fullText).toBe('Third article summary.');
  });

  it('skips items with missing link field', async () => {
    mockParseURL.mockResolvedValueOnce({
      items: [
        {
          title: 'Has Link',
          link: 'https://example.com/valid',
          contentSnippet: 'Valid item.',
        },
        {
          title: 'No Link',
          contentSnippet: 'Item without a link — should be skipped.',
        },
        {
          title: 'Also Has Link',
          link: 'https://example.com/also-valid',
          contentSnippet: 'Another valid item.',
        },
      ],
    });

    const results = await fetchRssItems(['https://example.com/feed.xml']);

    expect(results).toHaveLength(2);
    expect(results[0]?.sourceUrl).toBe('https://example.com/valid');
    expect(results[1]?.sourceUrl).toBe('https://example.com/also-valid');
  });

  it('logs error for broken feed and returns items from other feeds', async () => {
    // First feed fails
    mockParseURL.mockRejectedValueOnce(new Error('Network timeout'));
    // Second feed succeeds
    mockParseURL.mockResolvedValueOnce({
      items: [
        {
          title: 'Good Article',
          link: 'https://good-site.com/article',
          contentSnippet: 'Content from working feed.',
        },
      ],
    });

    const results = await fetchRssItems([
      'https://broken-site.com/feed.xml',
      'https://good-site.com/feed.xml',
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.sourceUrl).toBe('https://good-site.com/article');
  });

  it('returns empty array when no feed URLs are provided', async () => {
    const results = await fetchRssItems([]);

    expect(results).toHaveLength(0);
    expect(mockParseURL).not.toHaveBeenCalled();
  });

  it('uses fallback values for missing optional fields', async () => {
    mockParseURL.mockResolvedValueOnce({
      items: [
        {
          link: 'https://example.com/minimal',
          // No title, no author, no date, no content
        },
      ],
    });

    const results = await fetchRssItems(['https://example.com/feed.xml']);

    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item).toBeDefined();
    expect(item?.title).toBe('Untitled');
    expect(item?.author).toBe('Unknown');
    expect(item?.fullText).toBe('');
    // publicationDate should be a valid ISO string (fallback to now)
    expect(() => new Date(item?.publicationDate ?? '')).not.toThrow();
  });
});
