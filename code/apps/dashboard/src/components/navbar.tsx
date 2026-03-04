// ============================================================================
// Navbar — Top navigation bar with logo and auth controls
// ============================================================================

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function Navbar() {
  const { user, signOut, isLoading } = useAuth();
  const router = useRouter();

  const handleSignOut = () => {
    signOut();
    router.push('/login');
  };

  return (
    <nav className="bg-[var(--color-text)] text-white px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/digest" className="text-xl font-bold tracking-tight">
          Insight Engine
        </Link>
        {user && (
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
            <Link
              href="/settings"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Settings
            </Link>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        {isLoading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : user ? (
          <>
            <span className="text-sm text-gray-300">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-300 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="text-sm text-gray-300 hover:text-white transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
