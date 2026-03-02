// ============================================================================
// Navbar — Top navigation bar with logo and sign out
// ============================================================================

'use client';

import Link from 'next/link';

export function Navbar() {
  return (
    <nav className="bg-[var(--color-text)] text-white px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/digest" className="text-xl font-bold tracking-tight">
          Insight Engine
        </Link>
        <div className="flex gap-4 text-sm">
          <Link
            href="/digest"
            className="text-gray-300 hover:text-white transition-colors"
          >
            Digest
          </Link>
          <Link
            href="/history"
            className="text-gray-300 hover:text-white transition-colors"
          >
            History
          </Link>
        </div>
      </div>
      <div className="text-sm text-gray-400">
        Dashboard
      </div>
    </nav>
  );
}
