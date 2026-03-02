// ============================================================================
// StatusBadge — Colored badge for draft status and platform
// ============================================================================

import type { DraftContentStatus, Platform } from '@/lib/types';

interface StatusBadgeProps {
  status: DraftContentStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<DraftContentStatus, string> = {
    pending_approval:
      'bg-amber-100 text-amber-800 border-amber-200',
    approved:
      'bg-green-100 text-green-800 border-green-200',
    rejected:
      'bg-red-100 text-red-800 border-red-200',
  };

  const labels: Record<DraftContentStatus, string> = {
    pending_approval: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

interface PlatformBadgeProps {
  platform: Platform;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const styles: Record<Platform, string> = {
    twitter: 'bg-sky-100 text-sky-800 border-sky-200',
    linkedin: 'bg-blue-100 text-blue-800 border-blue-200',
  };

  const labels: Record<Platform, string> = {
    twitter: 'Twitter/X',
    linkedin: 'LinkedIn',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[platform]}`}
    >
      {labels[platform]}
    </span>
  );
}
