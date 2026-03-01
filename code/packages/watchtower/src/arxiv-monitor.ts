// ============================================================================
// arXiv Monitor — Fetches recent papers from the arXiv API and parses
// the Atom XML response into IngestionCandidate objects.
// ============================================================================

import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '@insight-engine/core';
import type { IngestionCandidate } from './rss-monitor.js';

const logger = createLogger('Watchtower');

/** Shape of a single arXiv Atom entry after XML parsing */
interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author: ArxivAuthor | ArxivAuthor[];
  link: ArxivLink | ArxivLink[];
}

interface ArxivAuthor {
  name: string;
}

interface ArxivLink {
  '@_href': string;
  '@_type'?: string;
  '@_rel'?: string;
}

/** Shape of the parsed arXiv Atom feed */
interface ArxivFeed {
  feed: {
    entry?: ArxivEntry | ArxivEntry[];
    'opensearch:totalResults'?: number;
  };
}

/**
 * Build the arXiv API query URL.
 *
 * arXiv uses the Open Archives Initiative (OAI) query syntax.
 * Multiple categories are joined with `+OR+`.
 */
export function buildArxivUrl(categories: string[], maxResults: number): string {
  const catQuery = categories.map((c) => `cat:${c}`).join('+OR+');
  return `http://export.arxiv.org/api/query?search_query=${catQuery}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
}

/**
 * Extract the canonical URL from an arXiv entry's link field.
 * Prefers the "alternate" HTML link; falls back to the entry `id`.
 */
function extractUrl(entry: ArxivEntry): string {
  const links = Array.isArray(entry.link) ? entry.link : [entry.link];
  const htmlLink = links.find(
    (l) => l['@_type'] === 'text/html' || l['@_rel'] === 'alternate',
  );
  return htmlLink?.['@_href'] ?? entry.id;
}

/**
 * Join multiple arXiv authors into a single comma-separated string.
 */
function extractAuthors(authorField: ArxivAuthor | ArxivAuthor[]): string {
  if (Array.isArray(authorField)) {
    return authorField.map((a) => a.name).join(', ');
  }
  return authorField.name;
}

/**
 * Clean arXiv text fields — they often contain extra whitespace and newlines.
 */
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fetch recent papers from the arXiv API for the given categories.
 *
 * On any network or parsing error the function logs the error and returns
 * an empty array — it never throws.
 */
export async function fetchArxivItems(
  categories: string[],
  maxResults: number,
): Promise<IngestionCandidate[]> {
  if (categories.length === 0) {
    logger.info('No arXiv categories configured — skipping arXiv source');
    return [];
  }

  const url = buildArxivUrl(categories, maxResults);

  try {
    logger.info(`Fetching arXiv papers: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`arXiv API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });

    const parsed = parser.parse(xmlText) as ArxivFeed;

    if (!parsed.feed?.entry) {
      logger.info('arXiv API returned no entries');
      return [];
    }

    // Normalise: single entry → array
    const entries = Array.isArray(parsed.feed.entry)
      ? parsed.feed.entry
      : [parsed.feed.entry];

    const results: IngestionCandidate[] = entries.map((entry) => ({
      title: cleanText(typeof entry.title === 'string' ? entry.title : String(entry.title)),
      author: extractAuthors(entry.author),
      publicationDate: entry.published,
      sourceUrl: extractUrl(entry),
      fullText: cleanText(typeof entry.summary === 'string' ? entry.summary : String(entry.summary)),
      source: 'arxiv' as const,
    }));

    logger.info(`Parsed ${results.length} papers from arXiv`, {
      categories: categories.join(', '),
      count: results.length,
    });

    return results;
  } catch (error: unknown) {
    logger.error('Failed to fetch/parse arXiv API', {
      component: 'Watchtower',
      source: 'arxiv',
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
