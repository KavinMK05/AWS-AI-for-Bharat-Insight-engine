// ============================================================================
// /history — Stub placeholder for Phase 8 (searchable history table)
// ============================================================================

export default function HistoryPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">
        Publishing History
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-8">
        Search and filter previously published content.
      </p>

      <div className="bg-white rounded-lg border border-[var(--color-border)] p-12 text-center">
        <div className="text-4xl mb-4">&#128218;</div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Coming in Phase 8
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-md mx-auto">
          Full-text search, platform filtering, and date range queries across all published content
          will be available once the RDS PostgreSQL database is enabled.
        </p>
      </div>
    </div>
  );
}
