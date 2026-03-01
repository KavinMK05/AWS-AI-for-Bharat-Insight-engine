// ============================================================================
// arXiv Monitor Tests — unit tests for arXiv API fetching and XML parsing
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Suppress logger output in tests
vi.mock('@insight-engine/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { fetchArxivItems, buildArxivUrl } from './arxiv-monitor.js';

// Sample arXiv Atom XML response with multiple entries
const SAMPLE_ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2602.12345v1</id>
    <title>Attention Is Still All You Need</title>
    <summary>We revisit the transformer architecture and show that
    attention mechanisms remain the dominant paradigm for NLP tasks.</summary>
    <published>2026-02-28T10:00:00Z</published>
    <updated>2026-02-28T10:00:00Z</updated>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <link href="http://arxiv.org/abs/2602.12345v1" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/2602.12345v1" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2602.67890v1</id>
    <title>Scaling Laws for Language Models</title>
    <summary>An empirical study of scaling laws.</summary>
    <published>2026-02-27T08:00:00Z</published>
    <updated>2026-02-27T08:00:00Z</updated>
    <author><name>Carol White</name></author>
    <link href="http://arxiv.org/abs/2602.67890v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

// Single-author, single-entry XML
const SINGLE_ENTRY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2602.11111v1</id>
    <title>Solo Author Paper</title>
    <summary>A paper with a single author.</summary>
    <published>2026-02-26T06:00:00Z</published>
    <updated>2026-02-26T06:00:00Z</updated>
    <author><name>Dave Solo</name></author>
    <link href="http://arxiv.org/abs/2602.11111v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

// Empty result XML
const EMPTY_RESULTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults>
</feed>`;

describe('buildArxivUrl', () => {
  it('builds correct URL with single category', () => {
    const url = buildArxivUrl(['cs.AI'], 10);
    expect(url).toBe(
      'http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=10&sortBy=submittedDate&sortOrder=descending',
    );
  });

  it('builds correct URL with multiple categories joined by OR', () => {
    const url = buildArxivUrl(['cs.AI', 'cs.LG', 'cs.CL'], 5);
    expect(url).toContain('cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL');
    expect(url).toContain('max_results=5');
  });
});

describe('fetchArxivItems', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses valid arXiv Atom XML into correct IngestionCandidate shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_ARXIV_XML),
      }),
    );

    const results = await fetchArxivItems(['cs.AI'], 10);

    expect(results).toHaveLength(2);
    const first = results[0];
    expect(first).toMatchObject({
      title: expect.stringContaining('Attention Is Still All You Need'),
      sourceUrl: 'http://arxiv.org/abs/2602.12345v1',
      publicationDate: '2026-02-28T10:00:00Z',
      source: 'arxiv',
    });
    expect(first?.fullText).toContain('transformer architecture');
  });

  it('handles multi-author entries by joining names with comma', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_ARXIV_XML),
      }),
    );

    const results = await fetchArxivItems(['cs.AI'], 10);

    const first = results[0];
    const second = results[1];
    // First entry has two authors
    expect(first?.author).toBe('Alice Smith, Bob Jones');
    // Second entry has one author
    expect(second?.author).toBe('Carol White');
  });

  it('handles single-entry responses (not wrapped in array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SINGLE_ENTRY_XML),
      }),
    );

    const results = await fetchArxivItems(['cs.AI'], 1);

    expect(results).toHaveLength(1);
    const entry = results[0];
    expect(entry?.author).toBe('Dave Solo');
    expect(entry?.title).toContain('Solo Author Paper');
  });

  it('returns empty array on API error without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    const results = await fetchArxivItems(['cs.AI'], 10);

    expect(results).toHaveLength(0);
  });

  it('returns empty array on network failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('Network error')),
    );

    const results = await fetchArxivItems(['cs.AI'], 10);

    expect(results).toHaveLength(0);
  });

  it('returns empty array when no categories are provided', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const results = await fetchArxivItems([], 10);

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty array when API returns zero results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(EMPTY_RESULTS_XML),
      }),
    );

    const results = await fetchArxivItems(['cs.AI'], 10);

    expect(results).toHaveLength(0);
  });

  it('includes maxResults parameter in the query URL', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(EMPTY_RESULTS_XML),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchArxivItems(['cs.AI'], 25);

    const firstCall = mockFetch.mock.calls[0] as unknown[];
    const calledUrl = firstCall[0] as string;
    expect(calledUrl).toContain('max_results=25');
  });
});
