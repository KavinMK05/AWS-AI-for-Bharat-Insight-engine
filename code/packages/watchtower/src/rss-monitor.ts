// ============================================================================
// RSS Monitor — Fetches and parses RSS feeds into IngestionCandidate objects.
// Each feed is wrapped in its own try/catch so one broken feed never blocks
// the others.
// ============================================================================

import RssParser from 'rss-parser';
import { createLogger } from '@insight-engine/core';
import type { ContentSource } from '@insight-engine/core';

const logger = createLogger('Watchtower');

/**
 * A candidate content item extracted from an external source, before
 * deduplication and persistence. Internal to watchtower — not shared.
 */
export interface IngestionCandidate {
  title: string;
  author: string;
  publicationDate: string;
  sourceUrl: string;
  fullText: string;
  source: ContentSource;
}

/**
 * Fetch and parse multiple RSS feed URLs, returning an array of candidates.
 *
 * Each feed is fetched independently. If a single feed fails (network error,
 * malformed XML, etc.) the error is logged and remaining feeds are still
 * processed.
 *
 * Items without a `link` field are skipped — we cannot deduplicate without
 * a source URL.
 */
export async function fetchRssItems(feedUrls: string[]): Promise<IngestionCandidate[]> {
  if (feedUrls.length === 0) {
    logger.info('No RSS feed URLs configured — skipping RSS source');
    return [];
  }

  const parser = new RssParser({
    timeout: 15_000,
  });

  const results: IngestionCandidate[] = [];

  for (const url of feedUrls) {
    try {
      logger.info(`Fetching RSS feed: ${url}`);
      const feed = await parser.parseURL(url);

      for (const item of feed.items) {
        // Skip items without a link — cannot deduplicate
        if (!item.link) {
          logger.debug('Skipping RSS item without link', {
            feedUrl: url,
            title: item.title ?? 'untitled',
          });
          continue;
        }

        const candidate: IngestionCandidate = {
          title: item.title ?? 'Untitled',
          author: item.creator ?? item['author'] ?? 'Unknown',
          publicationDate: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          sourceUrl: item.link,
          fullText: item.contentSnippet ?? item.content ?? item['summary'] ?? '',
          source: 'rss',
        };

        results.push(candidate);
      }

      logger.info(`Parsed ${feed.items.length} items from RSS feed`, {
        feedUrl: url,
        itemsParsed: feed.items.length,
      });
    } catch (error: unknown) {
      logger.error(`Failed to fetch/parse RSS feed: ${url}`, {
        component: 'Watchtower',
        source: 'rss',
        feedUrl: url,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to next feed — per-source isolation
    }
  }

  return results;
}
