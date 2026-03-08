// ============================================================================
// /history — Searchable publishing history (Phase 8)
// ============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { fetchHistory } from '@/lib/api';
import type { HistoryItem, HistoryResult, Platform } from '@/lib/types';

function PlatformBadge({ platform }: { platform: Platform }) {
  const colors = {
    twitter: 'bg-[var(--color-twitter)]',
    linkedin: 'bg-[var(--color-linkedin)]',
  };

  const labels = {
    twitter: 'Twitter / X',
    linkedin: 'LinkedIn',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${colors[platform]}`}
    >
      {labels[platform]}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function HistoryContent() {
  const [results, setResults] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const doSearch = useCallback(async (searchPage: number) => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchHistory({
        topic: topic || undefined,
        platform: (platform as Platform) || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        page: searchPage,
        limit,
      });
      setResults(data);
      setPage(searchPage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch history';
      setError(msg);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [topic, platform, fromDate, toDate]);

  // Load on mount
  useEffect(() => {
    doSearch(1);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(1);
  };

  const totalPages = results ? Math.ceil(results.total / limit) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">
        Publishing History
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Search and filter previously published content.
      </p>

      {/* Search & Filter Bar */}
      <form
        onSubmit={handleSearch}
        className="bg-white rounded-lg border border-[var(--color-border)] p-4 mb-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Topic Search */}
          <div className="lg:col-span-2">
            <label htmlFor="topic-search" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Search Topic
            </label>
            <input
              id="topic-search"
              type="text"
              placeholder="Search by topic..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
          </div>

          {/* Platform Filter */}
          <div>
            <label htmlFor="platform-filter" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Platform
            </label>
            <select
              id="platform-filter"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform | '')}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white"
            >
              <option value="">All Platforms</option>
              <option value="twitter">Twitter / X</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>

          {/* From Date */}
          <div>
            <label htmlFor="from-date" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              From Date
            </label>
            <input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
          </div>

          {/* To Date */}
          <div>
            <label htmlFor="to-date" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              To Date
            </label>
            <input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            type="button"
            onClick={() => {
              setTopic('');
              setPlatform('');
              setFromDate('');
              setToDate('');
              setPage(1);
              // Trigger search with cleared filters
              setTimeout(() => doSearch(1), 0);
            }}
            className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results Table */}
      {loading && !results ? (
        <div className="bg-white rounded-lg border border-[var(--color-border)] p-12 text-center">
          <div className="text-[var(--color-text-muted)]">Loading history...</div>
        </div>
      ) : results && results.results.length > 0 ? (
        <div className="bg-white rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-4 py-3">
                    Title
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-4 py-3">
                    Platform
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-4 py-3">
                    Published
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-4 py-3">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {results.results.map((item: HistoryItem) => (
                  <tr key={item.id} className="hover:bg-[var(--color-surface-alt)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {item.title || 'Untitled'}
                      </div>
                      {item.contentSnippet && (
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate max-w-md">
                          {item.contentSnippet}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PlatformBadge platform={item.platform} />
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
                      {formatDate(item.publishedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {item.platformUrl ? (
                        <a
                          href={item.platformUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[var(--color-primary)] hover:underline"
                        >
                          View Post &#8599;
                        </a>
                      ) : (
                        <span className="text-sm text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
              <div className="text-sm text-[var(--color-text-muted)]">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, results.total)} of{' '}
                {results.total} results
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => doSearch(page - 1)}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1 text-sm border border-[var(--color-border)] rounded-md hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pageNum = Math.max(1, page - 2) + i;
                  if (pageNum > totalPages) return null;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => doSearch(pageNum)}
                      disabled={loading}
                      className={`px-3 py-1 text-sm border rounded-md transition-colors ${
                        pageNum === page
                          ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                          : 'border-[var(--color-border)] hover:bg-white'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => doSearch(page + 1)}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1 text-sm border border-[var(--color-border)] rounded-md hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : results && results.results.length === 0 ? (
        <div className="bg-white rounded-lg border border-[var(--color-border)] p-12 text-center">
          <div className="text-4xl mb-4">📭</div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            No published content found
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-md mx-auto">
            {topic || platform || fromDate || toDate
              ? 'Try adjusting your search filters.'
              : 'Content published through the pipeline will appear here.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <AuthGuard>
      <HistoryContent />
    </AuthGuard>
  );
}
