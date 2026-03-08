// ============================================================================
// /digest — List view of all pending approval items with pagination
// ============================================================================

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ApprovalDigest } from '@/lib/types';
import { fetchDigest } from '@/lib/api';
import { DigestCard } from '@/components/digest-card';
import { Toast, useToast } from '@/components/toast';
import { AuthGuard } from '@/components/auth-guard';

const PAGE_SIZE = 30;

function DigestContent() {
  const [digests, setDigests] = useState<ApprovalDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { toasts, addToast, removeToast } = useToast();

  const [sort, setSort] = useState<'desc' | 'asc'>('desc');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadDigest = useCallback(async (targetPage: number, targetSort: 'desc' | 'asc') => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDigest(targetPage, PAGE_SIZE, targetSort);
      setDigests(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load digest';
      setError(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDigest(1, sort);
  }, [loadDigest, sort]);

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      loadDigest(newPage, sort);
    }
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSort = e.target.value as 'desc' | 'asc';
    setSort(newSort);
    // When changing sort, reset to page 1
    loadDigest(1, newSort);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Approval Digest
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Review and approve content drafts before publishing
            {total > 0 && ` · ${total} pending`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sort}
            onChange={handleSortChange}
            disabled={loading}
            className="px-3 py-2 text-sm text-[var(--color-text)] bg-white border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>
          <button
            onClick={() => loadDigest(page, sort)}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-[var(--color-primary)] border border-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary)] hover:text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && digests.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-block w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-[var(--color-text-muted)]">Loading digest...</p>
        </div>
      )}

      {error && digests.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[var(--color-danger)] font-medium">{error}</p>
          <button
            onClick={() => loadDigest(page, sort)}
            className="mt-4 px-4 py-2 text-sm text-[var(--color-primary)] hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && digests.length === 0 && (
        <div className="text-center py-16 bg-white rounded-lg border border-[var(--color-border)]">
          <div className="text-4xl mb-4">&#10003;</div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            All caught up
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            No pending drafts to review. Check back later.
          </p>
        </div>
      )}

      {digests.length > 0 && (
        <div className="space-y-3">
          {digests.map((digest) => (
            <DigestCard key={digest.contentItem.id} digest={digest} />
          ))}
        </div>
      )}

      {/* Pagination controls */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-1.5 mt-8 mb-4">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &larr;
          </button>

          {(() => {
            const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
            if (totalPages <= 7) {
              for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push('ellipsis-start');
              const start = Math.max(2, page - 1);
              const end = Math.min(totalPages - 1, page + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              if (page < totalPages - 2) pages.push('ellipsis-end');
              pages.push(totalPages);
            }
            return pages.map((p) =>
              typeof p === 'string' ? (
                <span key={p} className="px-2 py-2 text-sm text-[var(--color-text-muted)]">
                  &hellip;
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  disabled={loading}
                  className={`min-w-[36px] px-2 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-40 ${
                    p === page
                      ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
                  }`}
                >
                  {p}
                </button>
              ),
            );
          })()}

          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &rarr;
          </button>
        </div>
      )}

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

export default function DigestPage() {
  return (
    <AuthGuard>
      <DigestContent />
    </AuthGuard>
  );
}
