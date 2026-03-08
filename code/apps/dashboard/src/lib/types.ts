// ============================================================================
// Dashboard Shared Types
// Re-declares the subset of @insight-engine/core types needed by the frontend.
// Core is a Node.js package with AWS SDK deps that cannot be imported in browser.
// ============================================================================

export type Platform = 'twitter' | 'linkedin';

export type ContentItemStatus = 'ingested' | 'scored' | 'filtered' | 'processing';

export type DraftContentStatus = 'pending_approval' | 'approved' | 'rejected';

export type ContentSource = 'rss' | 'arxiv' | 'twitter';

export interface ContentItem {
  id: string;
  title: string;
  author: string;
  publicationDate: string;
  sourceUrl: string;
  fullText: string;
  source: ContentSource;
  ingestedAt: string;
  isDuplicate: boolean;
  relevanceScore?: number;
  status?: ContentItemStatus;
  isTrending?: boolean;
}

export interface HotTake {
  id: string;
  contentItemId: string;
  text: string;
  wordCount: number;
  variationIndex: number;
  createdAt: string;
}

export interface DraftContent {
  id: string;
  hotTakeId: string;
  contentItemId: string;
  platform: Platform;
  content: string;
  status: DraftContentStatus;
  createdAt: string;
}

export interface ApprovalDigest {
  contentItem: ContentItem;
  hotTake: HotTake;
  drafts: DraftContent[];
}

// ============================================================================
// History & Search (Phase 8)
// ============================================================================

export interface HistoryQueryParams {
  topic?: string;
  platform?: Platform;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  platform: Platform;
  platformUrl: string;
  publishedAt: string;
  contentItemId: string;
  contentSnippet: string;
}

export interface HistoryResult {
  total: number;
  page: number;
  results: HistoryItem[];
}
