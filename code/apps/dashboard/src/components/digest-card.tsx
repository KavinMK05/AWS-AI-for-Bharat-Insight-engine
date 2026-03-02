// ============================================================================
// DigestCard — Card showing title, source, relevance score, platform badges
// ============================================================================

import Link from 'next/link';
import type { ApprovalDigest } from '@/lib/types';
import { PlatformBadge } from './status-badge';

interface DigestCardProps {
  digest: ApprovalDigest;
}

export function DigestCard({ digest }: DigestCardProps) {
  const { contentItem, drafts } = digest;

  const sourceLabel: Record<string, string> = {
    rss: 'RSS',
    arxiv: 'arXiv',
    twitter: 'Twitter/X',
  };

  const timeAgo = getTimeAgo(contentItem.ingestedAt);

  return (
    <Link
      href={`/digest/${contentItem.id}`}
      className="block bg-white rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:shadow-md transition-all duration-200 p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-[var(--color-text)] truncate">
            {contentItem.title}
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {contentItem.author} &middot; {sourceLabel[contentItem.source] ?? contentItem.source} &middot; {timeAgo}
          </p>
        </div>

        {contentItem.relevanceScore !== undefined && (
          <div className="flex-shrink-0 text-center">
            <div
              className={`text-2xl font-bold ${
                contentItem.relevanceScore >= 80
                  ? 'text-green-600'
                  : contentItem.relevanceScore >= 60
                    ? 'text-amber-600'
                    : 'text-red-600'
              }`}
            >
              {contentItem.relevanceScore}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">Score</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        {drafts.map((draft) => (
          <PlatformBadge key={draft.id} platform={draft.platform} />
        ))}

        {contentItem.isTrending && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
            Trending
          </span>
        )}

        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'} pending
        </span>
      </div>
    </Link>
  );
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
