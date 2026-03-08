// ============================================================================
// /digest/[contentItemId] — Detail view with article summary, hot take,
// and side-by-side Twitter/LinkedIn preview panels with approval actions
// ============================================================================

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ApprovalDigest, DraftContent } from '@/lib/types';
import { fetchDigest } from '@/lib/api';
import { TwitterPreview } from '@/components/twitter-preview';
import { LinkedInPreview } from '@/components/linkedin-preview';
import { ApprovalActions } from '@/components/approval-actions';
import { PlatformBadge, StatusBadge } from '@/components/status-badge';
import { Toast, useToast } from '@/components/toast';
import { AuthGuard } from '@/components/auth-guard';

function DigestDetailContent() {
  const params = useParams();
  const router = useRouter();
  const contentItemId = params.contentItemId as string;

  const [digest, setDigest] = useState<ApprovalDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [removedDraftIds, setRemovedDraftIds] = useState<Set<string>>(new Set());
  const { toasts, addToast, removeToast } = useToast();

  const loadDigest = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchDigest(1, 1000); // Fetch enough to find the item
      const found = result.items.find((d) => d.contentItem.id === contentItemId);
      setDigest(found ?? null);
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : 'Failed to load digest',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [contentItemId]);

  useEffect(() => {
    loadDigest();
  }, [loadDigest]);

  const handleAction = (draftId: string, action: 'approved' | 'rejected') => {
    setRemovedDraftIds((prev) => new Set(prev).add(draftId));
    addToast(
      `Draft ${action === 'approved' ? 'approved and queued for publishing' : 'rejected'}`,
      'success',
    );

    // If all drafts are handled, redirect back to digest list after a brief delay
    if (digest) {
      const remainingDrafts = digest.drafts.filter(
        (d) => !removedDraftIds.has(d.id) && d.id !== draftId,
      );
      if (remainingDrafts.length === 0) {
        setTimeout(() => router.push('/digest'), 1500);
      }
    }
  };

  const handleError = (message: string) => {
    addToast(message, 'error');
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-[var(--color-text-muted)]">Loading content...</p>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--color-text-muted)]">Content item not found or no pending drafts.</p>
        <button
          onClick={() => router.push('/digest')}
          className="mt-4 px-4 py-2 text-sm text-[var(--color-primary)] hover:underline"
        >
          Back to digest
        </button>
      </div>
    );
  }

  const { contentItem, hotTake, drafts } = digest;
  const twitterDraft = drafts.find(
    (d) => d.platform === 'twitter' && !removedDraftIds.has(d.id),
  );
  const linkedinDraft = drafts.find(
    (d) => d.platform === 'linkedin' && !removedDraftIds.has(d.id),
  );

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => router.push('/digest')}
        className="text-sm text-[var(--color-primary)] hover:underline mb-6 inline-block"
      >
        &larr; Back to digest
      </button>

      {/* Article summary */}
      <div className="bg-white rounded-lg border border-[var(--color-border)] p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">
              {contentItem.title}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              By {contentItem.author} &middot; {contentItem.source.toUpperCase()} &middot;{' '}
              {new Date(contentItem.publicationDate).toLocaleDateString()}
            </p>
          </div>
          {contentItem.relevanceScore !== undefined && (
            <div className="flex-shrink-0 text-center px-4">
              <div
                className={`text-3xl font-bold ${
                  contentItem.relevanceScore >= 80
                    ? 'text-green-600'
                    : contentItem.relevanceScore >= 60
                      ? 'text-amber-600'
                      : 'text-red-600'
                }`}
              >
                {contentItem.relevanceScore}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">Relevance</div>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <a
            href={contentItem.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            View original source &rarr;
          </a>
        </div>

        {/* Full text / summary */}
        <div className="mt-4 p-4 bg-[var(--color-surface-alt)] rounded-lg">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">
            Article Summary
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">
            {contentItem.fullText.length > 500
              ? contentItem.fullText.slice(0, 500) + '...'
              : contentItem.fullText}
          </p>
        </div>
      </div>

      {/* Hot take */}
      <div className="bg-white rounded-lg border border-[var(--color-border)] p-6 mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-3">
          Hot Take
        </h2>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {hotTake.text}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-2">
          {hotTake.wordCount} words &middot; Variation {hotTake.variationIndex + 1}
        </p>
      </div>

      {/* Side-by-side draft previews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Twitter panel */}
        <DraftPanel
          title="Twitter/X Thread"
          draft={twitterDraft}
          onAction={handleAction}
          onError={handleError}
        >
          {twitterDraft && <TwitterPreview content={twitterDraft.content} />}
        </DraftPanel>

        {/* LinkedIn panel */}
        <DraftPanel
          title="LinkedIn Post"
          draft={linkedinDraft}
          onAction={handleAction}
          onError={handleError}
        >
          {linkedinDraft && <LinkedInPreview content={linkedinDraft.content} />}
        </DraftPanel>
      </div>

      {/* Toast notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

export default function DigestDetailPage() {
  return (
    <AuthGuard>
      <DigestDetailContent />
    </AuthGuard>
  );
}

// ---------------------------------------------------------------------------
// DraftPanel — wrapper for each platform draft preview with actions
// ---------------------------------------------------------------------------

function DraftPanel({
  title,
  draft,
  onAction,
  onError,
  children,
}: {
  title: string;
  draft: DraftContent | undefined;
  onAction: (draftId: string, action: 'approved' | 'rejected') => void;
  onError: (message: string) => void;
  children: React.ReactNode;
}) {
  if (!draft) {
    return (
      <div className="bg-white rounded-lg border border-[var(--color-border)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
          {title}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
          No draft available or already processed.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[var(--color-border)] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
        <div className="flex gap-2">
          <PlatformBadge platform={draft.platform} />
          <StatusBadge status={draft.status} />
        </div>
      </div>

      <div className="mb-4">{children}</div>

      <ApprovalActions draft={draft} onAction={onAction} onError={onError} />
    </div>
  );
}
