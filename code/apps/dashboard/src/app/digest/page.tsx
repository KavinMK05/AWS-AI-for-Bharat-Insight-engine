// ============================================================================
// /digest — List view of all pending approval items
// ============================================================================

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ApprovalDigest } from '@/lib/types';
import { fetchDigest } from '@/lib/api';
import { DigestCard } from '@/components/digest-card';
import { Toast, useToast } from '@/components/toast';
import { AuthGuard } from '@/components/auth-guard';

function DigestContent() {
  const [digests, setDigests] = useState<ApprovalDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const loadDigest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDigest();
      setDigests(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load digest';
      setError(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDigest();
  }, [loadDigest]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Approval Digest
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Review and approve content drafts before publishing
          </p>
        </div>
        <button
          onClick={loadDigest}
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
            onClick={loadDigest}
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
