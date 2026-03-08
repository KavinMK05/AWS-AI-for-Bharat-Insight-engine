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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadDigest = useCallback(async (targetPage: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDigest(targetPage, PAGE_SIZE);
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
    loadDigest(1);
  }, [loadDigest]);

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      loadDigest(newPage);
    }
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
        <button
          onClick={() => loadDigest(page)}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-[var(--color-primary)] border border-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary)] hover:text-white transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
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
            onClick={() => loadDigest(page)}
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
        <div className="flex items-center justify-center gap-3 mt-8 mb-4">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &larr; Previous
          </button>

          <span className="px-3 py-2 text-sm font-medium text-[var(--color-text)]">
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next &rarr;
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
